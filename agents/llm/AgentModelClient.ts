import type { AgentMessage, ToolCallRequest } from "../types";
import { getToolSchemas } from "../tools";

// Tool-calling is only wired up for providers that speak the OpenAI
// chat-completions function-calling shape natively. Anthropic and Google use
// structurally different tool-call formats (content blocks / functionCall
// parts) that app/api/ai/chat/route.ts doesn't translate yet — rather than
// silently mis-behaving, this client refuses those providers outright.
const TOOL_CALLING_PROVIDERS = new Set(["xai", "groq", "openai", "openrouter", "custom", "ollama", "local"]);

export function supportsToolCalling(provider: string): boolean {
  return TOOL_CALLING_PROVIDERS.has(provider);
}

/** Thrown on HTTP 429 so the agent loop can wait and retry instead of failing. */
export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ModelTurn = {
  content: string;
  toolCalls: ToolCallRequest[];
};

type WireMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    }
  | { role: "tool"; content: string; tool_call_id: string };

function toWireMessages(messages: AgentMessage[]): WireMessage[] {
  return messages.map((message): WireMessage => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      };
    }

    if (message.role === "tool") {
      return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
    }

    return { role: message.role, content: message.content };
  });
}

type StreamToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: StreamToolCallDelta[];
    };
  }>;
};

type PendingToolCall = { id?: string; name?: string; argsText: string };

/**
 * Sends one turn of the conversation to the model and streams back the
 * result: accumulated text (via onTextDelta as it arrives) plus any
 * completed tool calls once the stream ends.
 */
export async function runModelTurn(params: {
  provider: string;
  model: string;
  messages: AgentMessage[];
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<ModelTurn> {
  if (!supportsToolCalling(params.provider)) {
    throw new Error(
      `Tool-calling isn't available for provider "${params.provider}" yet — only Groq, xAI, OpenAI, OpenRouter, and custom/local (OpenAI-compatible) endpoints support it right now.`,
    );
  }

  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: params.provider,
      model: params.model,
      messages: toWireMessages(params.messages),
      tools: getToolSchemas(),
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new RateLimitError(
        data?.error || "Rate limited.",
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 10,
      );
    }
    throw new Error(data?.error || `AI request failed (${response.status}).`);
  }

  if (!response.body) {
    throw new Error("AI response has no stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let content = "";
  const pendingCalls = new Map<number, PendingToolCall>();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;

      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;

      let parsed: StreamChunk;
      try {
        parsed = JSON.parse(data) as StreamChunk;
      } catch {
        continue;
      }

      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === "string" && delta.content.length > 0) {
        content += delta.content;
        params.onTextDelta?.(delta.content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index ?? 0;
          const existing = pendingCalls.get(index) ?? { argsText: "" };

          if (toolCallDelta.id) existing.id = toolCallDelta.id;
          if (toolCallDelta.function?.name) existing.name = toolCallDelta.function.name;
          if (typeof toolCallDelta.function?.arguments === "string") {
            existing.argsText += toolCallDelta.function.arguments;
          }

          pendingCalls.set(index, existing);
        }
      }
    }
  }

  const toolCalls: ToolCallRequest[] = Array.from(pendingCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([index, call]): ToolCallRequest => {
      let args: Record<string, unknown> = {};
      try {
        args = call.argsText ? JSON.parse(call.argsText) : {};
      } catch {
        // Model produced malformed JSON arguments. Proceed with empty args —
        // the tool will report a clear validation error the model can see
        // and correct on its next turn, rather than the loop crashing here.
      }

      return { id: call.id ?? `call_${index}`, name: call.name ?? "", arguments: args };
    })
    .filter((call) => call.name.length > 0);

  return { content, toolCalls };
}
