import type { Tool } from "../types";
import { truncateOutput } from "../executor/Guardrails";
import { getDevServerStatus } from "../runtime/DevServer";

const LOG_TAIL_CHARS = 6_000;

export const CheckDevServerTool: Tool = {
  requiresApproval: false,
  definition: {
    name: "check_dev_server",
    description:
      "Check the server started with start_dev_server: whether it's still running, its latest output (compile errors, request logs, crashes), and any errors the page threw in the live preview (uncaught exceptions, console.error) since the last check. Use it after starting the server and after each change to verify the app actually works.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async execute(context) {
    const status = getDevServerStatus(context.webcontainer);

    if (!status.command) {
      return { success: true, output: "No dev server has been started with start_dev_server." };
    }

    const state = status.running
      ? `Running: ${status.command}${status.url ? ` at ${status.url}` : " (no port open yet)"}`
      : `Not running: ${status.command} exited with code ${status.exitCode}`;

    const logs = status.logs
      ? status.logs.length > LOG_TAIL_CHARS
        ? `…${status.logs.slice(-LOG_TAIL_CHARS)}`
        : status.logs
      : "(no output)";

    const errors = status.previewErrors.length
      ? status.previewErrors.map((error, index) => `${index + 1}. ${error}`).join("\n")
      : "None reported. (Errors are only captured while the live preview is open.)";

    return {
      success: true,
      output: truncateOutput(`${state}\n\nLatest server output:\n${logs}\n\nPreview page errors since last check:\n${errors}`),
    };
  },
};
