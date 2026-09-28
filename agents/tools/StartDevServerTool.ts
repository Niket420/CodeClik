import type { Tool } from "../types";
import { guardCommand, truncateOutput } from "../executor/Guardrails";
import { startDevServer } from "../runtime/DevServer";

const STARTUP_LOG_CHARS = 4_000;

export const StartDevServerTool: Tool = {
  // Runs arbitrary code like run_command, so it's confirmed the same way.
  requiresApproval: true,
  definition: {
    name: "start_dev_server",
    description:
      "Start a long-running server (e.g. \"npm run dev\", \"node server.js\") and leave it running in the background so the app shows in the live preview. Waits until the server is listening, then returns its URL and startup output. Replaces any server previously started with this tool. Use this — not run_command — for anything that never exits on its own. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The executable to run, e.g. \"npm\".",
        },
        args: {
          type: "array",
          description: "Arguments to pass, e.g. [\"run\", \"dev\"].",
          items: { type: "string" },
        },
      },
      required: ["command"],
    },
  },
  async execute(context, args) {
    const command = String(args.command ?? "");
    const commandArgs = Array.isArray(args.args) ? args.args.map(String) : [];

    try {
      guardCommand([command, ...commandArgs].join(" "));

      const result = await startDevServer(
        context.webcontainer,
        command,
        commandArgs,
        context.projectRoot !== "." ? context.projectRoot : undefined,
      );
      const logs = truncateOutput(result.logs, STARTUP_LOG_CHARS) || "(no output)";

      switch (result.status) {
        case "ready":
          return {
            success: true,
            output: `Server is running at ${result.url} (port ${result.port}) and is shown in the live preview.\nStartup output:\n${logs}\n\nUse check_dev_server to see new server output and any errors from the preview page.`,
          };
        case "exited":
          return {
            success: false,
            output: logs,
            error: `The server exited with code ${result.exitCode} before it started listening. See the output for the cause.`,
          };
        case "timeout":
          return {
            success: false,
            output: logs,
            error: "The process is still running but hasn't opened a port yet. It may still be compiling — call check_dev_server to look again, or fix the error shown in the output.",
          };
      }
    } catch (error) {
      return { success: false, output: "", error: error instanceof Error ? error.message : String(error) };
    }
  },
};
