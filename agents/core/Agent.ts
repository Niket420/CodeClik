import type { WebContainer } from "@webcontainer/api";
import type {
  AgentEventHandler,
  AgentMessage,
  AgentOptions,
  ApprovalCallback,
  ToolContext,
} from "../types";
import { buildSystemPrompt } from "../prompts/AgentPrompt";
import { runAgentLoop } from "./AgentLoop";

/**
 * The public entry point: configure once per session (provider, webcontainer,
 * how to ask the user for approval), then call `run()` per task. Mirrors how
 * a professional coding agent is actually used — one long-lived agent,
 * many turns/tasks against the same workspace.
 */
export class Agent {
  private readonly webcontainer: WebContainer;
  private readonly provider: string;
  private readonly model: string;
  private readonly projectRoot: string;
  private readonly onEvent?: AgentEventHandler;
  private readonly maxIterations?: number;
  private readonly signal?: AbortSignal;
  private readonly requestApproval: ApprovalCallback;

  constructor(options: AgentOptions) {
    this.webcontainer = options.webcontainer;
    this.provider = options.provider.provider;
    this.model = options.provider.model;
    this.projectRoot = options.projectRoot ?? ".";
    this.onEvent = options.onEvent;
    this.maxIterations = options.maxIterations;
    this.signal = options.signal;

    // Deny-by-default if the caller didn't wire up an approval UI — an
    // agent that can delete files and run commands must never fall back to
    // "just do it" when nobody's actually there to confirm.
    const userApproval = options.requestApproval ?? (async () => false);

    this.requestApproval = async (request) => {
      this.onEvent?.({ type: "approval-needed", request });
      const approved = await userApproval(request);
      this.onEvent?.({ type: "approval-resolved", request, approved });
      return approved;
    };
  }

  /**
   * Runs one task to completion (or until the iteration cap / an error stops
   * it). `contextBlock` is typically the context engine's retrieval result
   * for this specific task — pass it fresh each call, since relevant context
   * depends on what's being asked.
   */
  async run(task: string, contextBlock?: string, history: AgentMessage[] = []): Promise<string> {
    const toolContext: ToolContext = {
      webcontainer: this.webcontainer,
      projectRoot: this.projectRoot,
      requestApproval: this.requestApproval,
    };

    const messages: AgentMessage[] = [
      { role: "system", content: buildSystemPrompt(contextBlock) },
      ...history,
      { role: "user", content: task },
    ];

    return runAgentLoop({
      provider: this.provider,
      model: this.model,
      messages,
      toolContext,
      onEvent: this.onEvent,
      maxIterations: this.maxIterations,
      signal: this.signal,
    });
  }
}
