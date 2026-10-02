import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { acquireAiRequestLease, AiRequestPolicyError } from "@/lib/ai/requestPolicy";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

// OpenAI-shaped function-calling tool definitions, forwarded as-is to
// providers that speak that protocol (see OPENAI_COMPATIBLE_PROVIDERS below).
type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// Providers whose API already speaks the OpenAI chat-completions shape,
// and their default base URL when the user hasn't set a custom endpoint.
// "custom" and "local" have no default — they always rely on the user's endpoint.
const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  "xai",
  "groq",
  "openai",
  "openrouter",
  "custom",
]);

const OLLAMA_PROVIDERS = new Set(["ollama", "local"]);

const OPENAI_COMPATIBLE_DEFAULT_ENDPOINTS: Record<string, string> = {
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

function encoderChunk(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

// Anthropic's Messages API speaks a different shape (separate `system` field,
// "assistant"/"user" roles only, its own SSE event types). Translate its
// stream into the same OpenAI-style `choices[0].delta.content` chunks the
// frontend already knows how to consume.
function anthropicStreamToOpenAI(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();

      if (done) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event = JSON.parse(data);

          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            controller.enqueue(encoder.encode(encoderChunk(event.delta.text)));
          }
        } catch {
          // Ignore malformed/partial SSE lines.
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

// Gemini's streamGenerateContent (alt=sse) sends whole GenerateContentResponse
// objects, not deltas — extract the incremental text piece from each one and
// re-emit it in the OpenAI shape.
function googleStreamToOpenAI(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();

      if (done) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event = JSON.parse(data);
          const text = event?.candidates?.[0]?.content?.parts?.[0]?.text;

          if (typeof text === "string" && text.length > 0) {
            controller.enqueue(encoder.encode(encoderChunk(text)));
          }
        } catch {
          // Ignore malformed/partial SSE lines.
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

function ollamaStreamToOpenAI(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();

      if (done) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;

        try {
          const event = JSON.parse(text);
          const chunkText = typeof event?.message?.content === "string" ? event.message.content : "";

          if (chunkText.length > 0) {
            controller.enqueue(encoder.encode(encoderChunk(chunkText)));
          }
        } catch {
          // Ollama streams newline-delimited JSON chunks; ignore partial data.
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`Request timed out after ${timeoutMs / 1000}s.`);
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);

      if (attempt === maxAttempts || ![408, 429, 500, 502, 503, 504].includes(response.status)) {
        return response;
      }

      await response.body?.cancel();

      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8_000, 1_000 * 2 ** (attempt - 1));

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw error;
      if (attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 1_000 * 2 ** (attempt - 1))));
    }
  }

  throw new Error("AI provider request failed after retries.");
}

function releaseAfterStream(
  body: ReadableStream<Uint8Array>,
  release: () => void,
  onComplete: (status: "completed" | "failed") => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          releaseOnce();
          onComplete("completed");
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        releaseOnce();
        onComplete("failed");
        controller.error(error);
      }
    },
    cancel() {
      releaseOnce();
      onComplete("failed");
      return reader.cancel();
    },
  });
}

function splitSystemPrompt(messages: ChatMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const conversation = messages.filter((message) => message.role !== "system");

  return { system, conversation };
}

async function callAnthropic(apiKey: string, model: string, messages: ChatMessage[]) {
  const { system, conversation } = splitSystemPrompt(messages);

  return fetchWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: conversation.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
        stream: true,
      }),
    },
  );
}

async function callGoogle(apiKey: string, model: string, messages: ChatMessage[]) {
  const { system, conversation } = splitSystemPrompt(messages);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  return fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: conversation.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      }),
    },
  );
}

export async function POST(request: Request) {
  let releaseLease: (() => void) | undefined;
  let usageEventId: string | undefined;
  let usageStartedAt = 0;

  try {
    // 1. Identify the logged-in CodeClik user
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    // 2. Get the request sent by the AI UI
    const body = await request.json();

    const {
      provider,
      model,
      messages,
      tools,
    }: {
      provider?: string;
      model?: string;
      messages?: ChatMessage[];
      tools?: ToolDefinition[];
    } = body;

    if (!provider) {
      return NextResponse.json(
        { error: "Provider is required." },
        { status: 400 }
      );
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages are required." },
        { status: 400 }
      );
    }

    releaseLease = await acquireAiRequestLease(userId);

    // 3. Find this user's saved provider configuration
    const connection = await prisma.aIProviderConnection.findUnique({
      where: {
        clerkUserId_provider: {
          clerkUserId: userId,
          provider,
        },
      },
    });

    if (!connection) {
      return NextResponse.json(
        { error: "This AI provider is not configured." },
        { status: 404 }
      );
    }

    // 4. Decrypt the API key ONLY on the server. Local models may have no key at all.
    // Trim defensively in case the key was saved before input trimming.
    const apiKey = connection.encryptedApiKey
      ? decrypt(connection.encryptedApiKey).trim()
      : "";

    // 5. Determine which model to use
    const selectedModel = model?.trim() || connection.model;
    usageStartedAt = Date.now();

    try {
      const usageEvent = await prisma.aIUsageEvent.create({
        data: {
          clerkUserId: userId,
          provider,
          model: selectedModel,
          status: "started",
        },
        select: { id: true },
      });
      usageEventId = usageEvent.id;
    } catch (error) {
      console.error("AI usage event could not be recorded:", error);
    }

    const completeUsage = (status: "completed" | "failed") => {
      if (!usageEventId) return;
      void prisma.aIUsageEvent.update({
        where: { id: usageEventId },
        data: { status, durationMs: Date.now() - usageStartedAt },
      }).catch((error) => {
        console.error("AI usage event could not be updated:", error);
      });
    };

    let providerResponse: Response;
    let toOpenAIStream: (body: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array> = (body) => body;

    if (OLLAMA_PROVIDERS.has(provider)) {
      const endpoint = (connection.endpoint?.trim() || "http://localhost:11434").replace(/\/+$/, "");
      const ollamaUrl = `${endpoint}/api/chat`;

      providerResponse = await fetchWithRetry(
        ollamaUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            messages,
            stream: true,
            ...(tools && tools.length > 0 ? { tools } : {}),
          }),
        },
      );

      toOpenAIStream = ollamaStreamToOpenAI;
    } else if (OPENAI_COMPATIBLE_PROVIDERS.has(provider)) {
      // 6. Use the user's custom endpoint if provided, otherwise the provider's default.
      const endpoint = connection.endpoint?.trim() || OPENAI_COMPATIBLE_DEFAULT_ENDPOINTS[provider];

      if (!endpoint) {
        return NextResponse.json(
          { error: `No endpoint configured for provider "${provider}".` },
          { status: 400 }
        );
      }

      providerResponse = await fetchWithRetry(
        `${endpoint}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: selectedModel,
            messages,
            stream: true,
            // Only meaningful for this OpenAI-shaped group — Anthropic/Google
            // below use structurally different tool-call formats this route
            // doesn't translate yet, so tools are intentionally not forwarded there.
            ...(tools && tools.length > 0 ? { tools } : {}),
          }),
        },
      );
    } else if (provider === "anthropic") {
      providerResponse = await callAnthropic(apiKey, selectedModel, messages);
      toOpenAIStream = anthropicStreamToOpenAI;
    } else if (provider === "google") {
      providerResponse = await callGoogle(apiKey, selectedModel, messages);
      toOpenAIStream = googleStreamToOpenAI;
    } else {
      return NextResponse.json(
        { error: `Provider "${provider}" is not implemented yet.` },
        { status: 400 }
      );
    }

    // 7. Handle provider errors
    if (!providerResponse.ok) {
      releaseLease?.();
      releaseLease = undefined;
      completeUsage("failed");
      const errorText = await providerResponse.text();

      console.error(
        `${provider} API error:`,
        providerResponse.status,
        errorText
      );

      const providerError =
        providerResponse.status === 401 || providerResponse.status === 403
          ? "The API key is invalid or expired. Please reconfigure this provider with a fresh key."
          : providerResponse.status === 429
            ? "The provider rate limit was hit. Please wait and try again."
            : "AI provider request failed.";

      return NextResponse.json(
        {
          error: providerError,
          providerStatus: providerResponse.status,
        },
        { status: 502 }
      );
    }

    // 8. Make sure the provider returned a stream
    if (!providerResponse.body) {
      releaseLease?.();
      releaseLease = undefined;
      completeUsage("failed");
      return NextResponse.json(
        {
          error: "AI provider returned no response stream.",
        },
        { status: 502 }
      );
    }

    // 9. Forward the (possibly translated) stream to the browser
    const stream = releaseAfterStream(
      toOpenAIStream(providerResponse.body),
      releaseLease,
      completeUsage,
    );
    releaseLease = undefined;

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    releaseLease?.();
    if (usageEventId) {
      void prisma.aIUsageEvent.update({
        where: { id: usageEventId },
        data: { status: "failed", durationMs: Date.now() - usageStartedAt },
      }).catch((updateError) => {
        console.error("AI usage event could not be updated:", updateError);
      });
    }

    if (error instanceof AiRequestPolicyError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }

    // 10. Handle unexpected server errors
    console.error("AI chat error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to process AI request.",
      },
      { status: 500 }
    );
  }
}
