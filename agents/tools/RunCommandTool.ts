import type { Tool } from "../types";
import { guardCommand, guardEnvironmentCommand, Limits, truncateOutput } from "../executor/Guardrails";

export const RunCommandTool: Tool = {
  // Arbitrary command execution — always confirmed by the user first, even
  // though it's sandboxed inside the WebContainer VM rather than the user's
  // real machine. See executor/Guardrails.ts.
  requiresApproval: true,
  validate(args) {
    const command = String(args.command ?? "");
    const commandArgs = Array.isArray(args.args) ? args.args.map(String) : [];
    guardCommand([command, ...commandArgs].join(" "));
    guardEnvironmentCommand(command, commandArgs);
  },
  definition: {
    name: "run_command",
    description:
      "Run one program that finishes (e.g. npm install, npm run build, node script.js) in the in-browser WebContainer. Not a shell: no bash, pipes (|), redirects (>) or chaining (&&, ;). Only Node.js tools exist (node, npm, npx). Waits for the program to exit; killed after 60 seconds. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "A single program name, e.g. \"npm\", \"npx\" or \"node\" — nothing else.",
        },
        args: {
          type: "array",
          description: "Arguments to pass, e.g. [\"install\", \"lodash\"].",
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

      const process = await context.webcontainer.spawn(command, commandArgs, {
        cwd: context.projectRoot !== "." ? context.projectRoot : undefined,
      });

      let output = "";
      const reader = process.output.getReader();

      const readLoop = (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          output += value;
        }
      })();

      const timeout = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), Limits.COMMAND_TIMEOUT_MS);
      });

      const result = await Promise.race([process.exit.then((code) => ({ code })), timeout]);

      if (result === "timeout") {
        process.kill();
        return {
          success: false,
          output: truncateOutput(output),
          error: `Command timed out after ${Limits.COMMAND_TIMEOUT_MS / 1000}s and was killed.`,
        };
      }

      await readLoop;

      const truncated = truncateOutput(output);
      return result.code === 0
        ? { success: true, output: truncated || "(no output)" }
        : { success: false, output: truncated, error: `Exited with code ${result.code}.` };
    } catch (error) {
      return { success: false, output: "", error: error instanceof Error ? error.message : String(error) };
    }
  },
};
