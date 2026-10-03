import type { WebContainer } from "@webcontainer/api";

// --- Tool schema (wire format is the OpenAI function-calling shape, which
// Groq/xAI/OpenAI/OpenRouter/custom/local all speak natively) -------------

export type JSONSchemaProperty = {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
};

export type ToolParameterSchema = {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
};

// --- Guardrails ------------------------------------------------------------

export type ApprovalRequest = {
  toolName: string;
  args: Record<string, unknown>;
  /** Human-readable description of what's about to happen, shown to the user. */
  reason: string;
};

export type ApprovalCallback = (request: ApprovalRequest) => Promise<boolean>;

// --- Tools -------------------------------------------------------------

export type ToolContext = {
  webcontainer: WebContainer;
  /** Project root within the WebContainer FS. Almost always ".". */
  projectRoot: string;
  requestApproval: ApprovalCallback;
};

export type ToolResult = {
  success: boolean;
  /** Human/LLM-readable summary of what happened — fed back to the model as the tool's output. */
  output: string;
  error?: string;
};

export type Tool = {
  definition: ToolDefinition;
  /** Hard-to-reverse tools (delete, run arbitrary commands) must be confirmed before running. */
  requiresApproval: boolean;
  /**
   * Optional pre-check, run before asking for approval: throw a
   * GuardrailViolationError for calls that can't work, so the user isn't
   * asked to approve them.
   */
  validate?(args: Record<string, unknown>): void;
  execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
};

// --- Conversation ------------------------------------------------------

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };

// --- Streaming events (what the UI subscribes to) -----------------------

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool-call"; call: ToolCallRequest }
  | { type: "tool-result"; call: ToolCallRequest; result: ToolResult }
  | { type: "approval-needed"; request: ApprovalRequest }
  | { type: "approval-resolved"; request: ApprovalRequest; approved: boolean }
  | { type: "error"; message: string }
  | { type: "done"; finalText: string };

export type AgentEventHandler = (event: AgentEvent) => void;

export type ProviderConfig = {
  provider: string;
  model: string;
};

export type AgentOptions = {
  webcontainer: WebContainer;
  provider: ProviderConfig;
  projectRoot?: string;
  onEvent?: AgentEventHandler;
  requestApproval?: ApprovalCallback;
  /** Safety cap on think-act-observe iterations, in case the model loops. */
  maxIterations?: number;
  /** Aborting stops the current run (the UI's Stop button). */
  signal?: AbortSignal;
};
