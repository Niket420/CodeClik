import type { ToolCallRequest, ToolContext, ToolResult } from "../types";
import { getTool } from "../tools";
import { GuardrailViolationError } from "./Guardrails";

function describeCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "delete_file":
      return `Delete "${args.path}"`;
    case "run_command":
      return `Run "${args.command}${Array.isArray(args.args) ? " " + args.args.join(" ") : ""}"`;
    case "start_dev_server":
      return `Start server "${args.command}${Array.isArray(args.args) ? " " + args.args.join(" ") : ""}" and keep it running`;
    default:
      return `Run ${name}(${JSON.stringify(args)})`;
  }
}

/**
 * Runs one tool call: looks it up, gates it behind approval if required,
 * executes it, and always returns a ToolResult — never throws, so the agent
 * loop can keep going and let the model see and react to failures.
 */
export async function executeToolCall(
  call: ToolCallRequest,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = getTool(call.name);

  if (!tool) {
    return { success: false, output: "", error: `Unknown tool "${call.name}".` };
  }

  // Reject impossible calls before bothering the user with an approval.
  try {
    tool.validate?.(call.arguments);
  } catch (error) {
    if (error instanceof GuardrailViolationError) {
      return { success: false, output: "", error: error.message };
    }
    throw error;
  }

  if (tool.requiresApproval) {
    const approved = await context.requestApproval({
      toolName: call.name,
      args: call.arguments,
      reason: describeCall(call.name, call.arguments),
    });

    if (!approved) {
      return { success: false, output: "", error: "The user did not approve this action." };
    }
  }

  try {
    return await tool.execute(context, call.arguments);
  } catch (error) {
    if (error instanceof GuardrailViolationError) {
      return { success: false, output: "", error: error.message };
    }
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Tool execution failed.",
    };
  }
}
