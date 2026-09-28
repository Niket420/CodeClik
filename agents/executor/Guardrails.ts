// Everything the agent is and isn't allowed to touch, and which actions need
// a human to confirm first. Kept as one file deliberately: these policies are
// small and related enough that splitting them into a directory would be
// premature structure for what's here today.

// Paths the agent may never read, write, or delete — even inside the project
// root. Secrets and VCS/dependency internals should never be touched by an
// LLM-driven tool call.
const BLOCKED_PATH_SEGMENTS = [".git", "node_modules", ".env"];

const MAX_READ_BYTES = 200_000; // ~200KB — enough for any real source file, not a whole video asset.
const MAX_COMMAND_OUTPUT_CHARS = 20_000;
const COMMAND_TIMEOUT_MS = 60_000;

// Tools that mutate the filesystem in a way that's hard or impossible to
// undo, or that run arbitrary code, require explicit user approval before
// executing. Reading/listing is always safe; writing/creating stays
// unapproved too since it's easy to review afterward (Editor shows the diff)
// and easy to just delete a wrongly-created file — deleting and running
// commands are the two genuinely hard-to-reverse actions here.
const APPROVAL_REQUIRED_TOOLS = new Set(["delete_file", "run_command", "start_dev_server"]);

export function requiresApproval(toolName: string): boolean {
  return APPROVAL_REQUIRED_TOOLS.has(toolName);
}

export class GuardrailViolationError extends Error {}

/**
 * Normalizes a path relative to the project root and throws if it tries to
 * escape the project or touch a blocked path (.git, node_modules, .env*).
 * Returns the normalized, safe path to actually use.
 */
export function guardPath(rawPath: string, projectRoot: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new GuardrailViolationError("A file path is required.");
  }

  const normalizedRoot = projectRoot === "." ? "" : projectRoot.replace(/^\.\/+/, "").replace(/\/+$/, "");
  const cleaned = rawPath.trim().replace(/^\.\/+/, "");

  const segments = cleaned.split("/").filter((segment) => segment.length > 0);
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) {
        throw new GuardrailViolationError(`Path "${rawPath}" escapes the project root.`);
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  for (const segment of resolved) {
    if (BLOCKED_PATH_SEGMENTS.some((blocked) => segment === blocked || segment.startsWith(".env"))) {
      throw new GuardrailViolationError(`Path "${rawPath}" touches a protected location (${segment}).`);
    }
  }

  const finalPath = resolved.join("/");
  return normalizedRoot ? `${normalizedRoot}/${finalPath}` : finalPath || ".";
}

// Patterns that are almost never what you want an autonomous agent to run
// unattended, even inside an isolated WebContainer sandbox — mainly to stop
// it from nuking the whole workspace or fetching+executing arbitrary remote
// scripts, not because the sandbox itself is at risk.
const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+(\/|\.\.|~)(\s|$)/i, // rm -rf / or -rf .. or -rf ~
  /\bcurl\b[^|]*\|\s*(sh|bash|zsh)\b/i, // curl ... | sh
  /\bwget\b[^|]*\|\s*(sh|bash|zsh)\b/i,
  /\bgit\s+push\b.*--force\b/i,
  /\bgit\s+reset\b.*--hard\b/i,
];

export function guardCommand(command: string): void {
  if (!command || typeof command !== "string") {
    throw new GuardrailViolationError("A command is required.");
  }

  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new GuardrailViolationError(`Command blocked by guardrails: "${command}"`);
    }
  }
}

export function truncateOutput(text: string, limit: number = MAX_COMMAND_OUTPUT_CHARS): string {
  if (text.length <= limit) return text;

  const keep = Math.max(400, Math.floor(limit / 2));
  const head = text.slice(0, keep);
  const tail = text.slice(-keep);
  const omitted = text.length - head.length - tail.length;

  return `${head}\n… (truncated, ${omitted} characters omitted)\n${tail}`;
}

export const Limits = {
  MAX_READ_BYTES,
  MAX_COMMAND_OUTPUT_CHARS,
  COMMAND_TIMEOUT_MS,
};
