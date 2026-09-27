import type { AgentEventHandler, AgentMessage, ToolContext, ToolCallRequest } from "../types";
import { runModelTurn, RateLimitError } from "../llm/AgentModelClient";
import { executeToolCall } from "../executor/ToolExecutor";

// High enough that real multi-file builds (write, install, build, fix, repeat)
// finish in one run. Runaway loops are caught by the stuck detector and the
// user's Stop button rather than by a low step count.
const DEFAULT_MAX_ITERATIONS = 200;

// The same call failing this many times in a row means the model is stuck.
const MAX_REPEATED_FAILURES = 3;

// Rate-limit (429) retries per model turn before giving up.
const MAX_RATE_LIMIT_RETRIES = 5;

// Every turn resends the whole conversation, so older tool output and old
// write_file contents are shortened to keep long runs within the context
// window. The most recent messages are always sent in full.
const KEEP_RECENT_MESSAGES = 12;
const COMPACT_MAX_CHARS = 1_500;

export type AgentLoopParams = {
  provider: string;
  model: string;
  /** Full initial message list — system prompt + any history + the user's task. */
  messages: AgentMessage[];
  toolContext: ToolContext;
  onEvent?: AgentEventHandler;
  maxIterations?: number;
  /** Aborting stops the loop before its next model turn or tool call. */
  signal?: AbortSignal;
};

function shorten(text: string): string {
  if (text.length <= COMPACT_MAX_CHARS) return text;
  return `${text.slice(0, COMPACT_MAX_CHARS)}\n…[${text.length - COMPACT_MAX_CHARS} more characters trimmed from an earlier step — re-read the file if you need it]`;
}

function compactArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, typeof value === "string" ? shorten(value) : value]),
  );
}

/** Copy of the conversation with old tool output/arguments trimmed. */
function compactForModel(messages: AgentMessage[]): AgentMessage[] {
  const cutoff = messages.length - KEEP_RECENT_MESSAGES;

  return messages.map((message, index) => {
    if (index >= cutoff) return message;

    if (message.role === "tool") {
      return { ...message, content: shorten(message.content) };
    }

    if (message.role === "assistant" && message.toolCalls) {
      return {
        ...message,
        toolCalls: message.toolCalls.map((call) => ({ ...call, arguments: compactArgs(call.arguments) })),
      };
    }

    return message;
  });
}

function callSignature(call: ToolCallRequest): string {
  return `${call.name}:${JSON.stringify(call.arguments)}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * The think-act-observe loop: ask the model for the next step, and if it
 * responds with tool calls instead of a final answer, run them, feed the
 * results back as messages, and ask again — until the model gives a plain
 * answer, the user stops it, it gets stuck repeating a failing call, or the
 * (generous) iteration cap is hit.
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<string> {
  const { provider, model, toolContext, onEvent, signal } = params;
  const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const messages: AgentMessage[] = [...params.messages];

  const stopped = () => {
    const message = "Stopped by user.";
    onEvent?.({ type: "text", delta: `\n\n_${message}_` });
    return message;
  };

  let lastFailedSignature: string | null = null;
  let repeatedFailures = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) return stopped();

    let turn;
    for (let attempt = 0; ; attempt++) {
      try {
        turn = await runModelTurn({
          provider,
          model,
          messages: compactForModel(messages),
          signal,
          onTextDelta: (delta) => onEvent?.({ type: "text", delta }),
        });
        break;
      } catch (error) {
        if (signal?.aborted) return stopped();

        if (error instanceof RateLimitError && attempt < MAX_RATE_LIMIT_RETRIES) {
          onEvent?.({ type: "text", delta: `\n\n_Rate limited — retrying in ${error.retryAfterSeconds}s…_` });
          await sleep(error.retryAfterSeconds * 1000, signal);
          continue;
        }

        const message = error instanceof Error ? error.message : "Model request failed.";
        onEvent?.({ type: "error", message });
        return message;
      }
    }

    if (turn.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: turn.content });
      onEvent?.({ type: "done", finalText: turn.content });
      return turn.content;
    }

    messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });

    for (const call of turn.toolCalls) {
      // Every tool call id must get a result message, or the provider rejects
      // the next request — so after an abort, answer the rest as skipped.
      if (signal?.aborted) {
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: "Skipped: stopped by user." });
        continue;
      }

      onEvent?.({ type: "tool-call", call });

      const result = await executeToolCall(call, toolContext);

      onEvent?.({ type: "tool-result", call, result });

      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: result.success ? result.output : `Error: ${result.error ?? "Tool failed."}`,
      });

      if (result.success) {
        lastFailedSignature = null;
        repeatedFailures = 0;
        continue;
      }

      const signature = callSignature(call);
      repeatedFailures = signature === lastFailedSignature ? repeatedFailures + 1 : 1;
      lastFailedSignature = signature;
    }

    if (signal?.aborted) return stopped();

    if (repeatedFailures >= MAX_REPEATED_FAILURES) {
      const message = `Stopped: the same action failed ${repeatedFailures} times in a row, so the agent looks stuck. Check the error above, then say "continue" with any hints.`;
      onEvent?.({ type: "error", message });
      return message;
    }
  }

  const message = `Paused after ${maxIterations} steps. Say "continue" to keep going.`;
  onEvent?.({ type: "error", message });
  return message;
}
