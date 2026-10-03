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

// The WebContainer isn't a Linux box: its shell is jsh, and only Node.js
// tooling exists. Models default to bash habits (bash -lc "sed … | grep …"),
// which fail with exit code 127 and waste a step plus an approval click.
// Rejecting them up front, with the right alternative, gets the model back on
// track immediately.
const UNAVAILABLE_PROGRAMS: Record<string, string> = {
  bash: "There's no bash (the shell is jsh). Run the program directly, e.g. command \"npm\", args [\"run\", \"build\"].",
  sh: "There's no sh (the shell is jsh). Run the program directly, e.g. command \"npm\", args [\"run\", \"build\"].",
  zsh: "There's no zsh (the shell is jsh). Run the program directly.",
  sed: "sed isn't available. Use read_file to read a file, and write_file to change it.",
  awk: "awk isn't available. Use read_file to read a file.",
  grep: "grep isn't available. Use read_file, or list_directory to find files.",
  egrep: "egrep isn't available. Use read_file, or list_directory to find files.",
  head: "head isn't available. Use read_file.",
  tail: "tail isn't available. Use read_file.",
  cat: "Use read_file to read a file, and write_file to create one.",
  less: "Use read_file to read a file.",
  find: "find isn't available. Use list_directory.",
  xargs: "xargs isn't available. Use the file tools.",
  touch: "Use write_file to create a file.",
  rm: "Use delete_file to delete a file.",
  mkdir: "Use create_directory to create a folder.",
  mv: "mv isn't available. Read the file with read_file, write it to the new path with write_file, then delete_file the old one.",
  cp: "cp isn't available. Read the file with read_file and write the copy with write_file.",
  python: "Python isn't available — only Node.js runs here. Write the script in JavaScript and run it with node.",
  python3: "Python isn't available — only Node.js runs here. Write the script in JavaScript and run it with node.",
  pip: "pip isn't available — only Node.js runs here. Use npm packages instead.",
  pip3: "pip isn't available — only Node.js runs here. Use npm packages instead.",
  git: "The git command isn't available. The user commits and pushes from the Source Control panel.",
  curl: "curl isn't available. Use fetch() in a small Node script if you need an HTTP request.",
  wget: "wget isn't available. Use fetch() in a small Node script if you need an HTTP request.",
  sudo: "sudo isn't available and isn't needed.",
  apt: "System packages can't be installed. Use npm packages.",
  "apt-get": "System packages can't be installed. Use npm packages.",
  brew: "System packages can't be installed. Use npm packages.",
  docker: "Docker isn't available. Databases and services can't run here — use in-memory data or JSON files.",
};

// Arguments that only mean something to a shell. Commands run as one program
// with arguments (no shell), so these would be passed through literally.
const SHELL_OPERATORS = new Set(["|", "||", "&&", "&", ";", ">", ">>", "<", "2>", "2>&1", "&>"]);

/**
 * Throws a GuardrailViolationError, with the alternative to use, when a
 * command can't work in the WebContainer.
 */
export function guardEnvironmentCommand(command: string, args: string[]): void {
  const program = command.trim();

  if (/\s/.test(program)) {
    throw new GuardrailViolationError(
      `"command" must be a single program name. Put the rest in "args", e.g. command "npm", args ["install", "react"].`,
    );
  }

  const name = program.split("/").pop()!.toLowerCase();
  const hint = UNAVAILABLE_PROGRAMS[name];
  if (hint) {
    throw new GuardrailViolationError(`"${name}" doesn't work here. ${hint}`);
  }

  const operator = args.find((arg) => SHELL_OPERATORS.has(arg.trim()));
  if (operator) {
    throw new GuardrailViolationError(
      `"${operator}" doesn't work: commands run as a single program, not through a shell, so pipes, redirects and chaining aren't supported. Run one command per call.`,
    );
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
