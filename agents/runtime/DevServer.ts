import type { PreviewMessage, WebContainer, WebContainerProcess } from "@webcontainer/api";
import { truncateOutput } from "../executor/Guardrails";

// Unlike run_command, a dev server is meant to keep running — so it's started
// here, left alive in the background, and tracked in module state so the
// agent can check its output later (and so starting a new one replaces the
// old one instead of fighting it for the port).

const READY_TIMEOUT_MS = 90_000;
const MAX_LOG_CHARS = 20_000;
const MAX_PREVIEW_ERRORS = 50;

// Terminal color/cursor escape codes — noise for the model.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");

type DevServerState = {
  process: WebContainerProcess;
  command: string;
  logs: string;
  url: string | null;
  port: number | null;
  exitCode: number | null;
};

let current: DevServerState | null = null;
let previewErrors: string[] = [];
const listenedContainers = new WeakSet<WebContainer>();

function formatPreviewMessage(message: PreviewMessage): string {
  const where = message.pathname || "/";

  if ("args" in message) {
    const text = message.args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    return `console.error on ${where}: ${text}`;
  }

  return `Uncaught error on ${where}: ${message.message}${message.stack ? `\n${message.stack}` : ""}`;
}

/**
 * Collect errors the preview page throws or logs (needs the container booted
 * with `forwardPreviewErrors`, and the preview actually open in the IDE).
 */
function ensurePreviewErrorListener(webcontainer: WebContainer): void {
  if (listenedContainers.has(webcontainer)) return;
  listenedContainers.add(webcontainer);

  webcontainer.on("preview-message", (message) => {
    previewErrors.push(truncateOutput(formatPreviewMessage(message), 2_000));
    if (previewErrors.length > MAX_PREVIEW_ERRORS) {
      previewErrors = previewErrors.slice(-MAX_PREVIEW_ERRORS);
    }
  });
}

function appendLog(state: DevServerState, chunk: string): void {
  state.logs += chunk.replace(ANSI_PATTERN, "");
  if (state.logs.length > MAX_LOG_CHARS) {
    state.logs = state.logs.slice(-MAX_LOG_CHARS);
  }
}

export function stopDevServer(): void {
  current?.process.kill();
  current = null;
}

export type StartResult =
  | { status: "ready"; url: string; port: number; logs: string }
  | { status: "exited"; exitCode: number; logs: string }
  | { status: "timeout"; logs: string };

export async function startDevServer(
  webcontainer: WebContainer,
  command: string,
  args: string[],
  cwd?: string,
): Promise<StartResult> {
  ensurePreviewErrorListener(webcontainer);
  stopDevServer();
  previewErrors = [];

  // Subscribe before spawning so a fast server can't become ready unseen.
  let resolveReady: (value: { port: number; url: string }) => void = () => {};
  const ready = new Promise<{ port: number; url: string }>((resolve) => {
    resolveReady = resolve;
  });
  const unsubscribe = webcontainer.on("server-ready", (port, url) => resolveReady({ port, url }));

  try {
    const process = await webcontainer.spawn(command, args, { cwd });
    const state: DevServerState = {
      process,
      command: [command, ...args].join(" "),
      logs: "",
      url: null,
      port: null,
      exitCode: null,
    };
    current = state;

    // Keep draining output for the server's whole lifetime — the stream is
    // also what check_dev_server reads later.
    void process.output.pipeTo(
      new WritableStream({ write: (chunk) => appendLog(state, chunk) }),
    ).catch(() => {});

    void process.exit.then((code) => {
      state.exitCode = code;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      ready.then((info) => ({ kind: "ready" as const, ...info })),
      process.exit.then((code) => ({ kind: "exited" as const, code })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), READY_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);

    if (outcome.kind === "ready") {
      state.url = outcome.url;
      state.port = outcome.port;
      return { status: "ready", url: outcome.url, port: outcome.port, logs: state.logs };
    }

    // An exited server stays as `current` so check_dev_server can still
    // show why it died.
    if (outcome.kind === "exited") {
      return { status: "exited", exitCode: outcome.code, logs: state.logs };
    }

    // Still running but never opened a port — leave it alive; it may just be
    // slow (first compile), and check_dev_server can look again.
    return { status: "timeout", logs: state.logs };
  } finally {
    unsubscribe();
  }
}

export type DevServerStatus = {
  running: boolean;
  command: string | null;
  url: string | null;
  exitCode: number | null;
  logs: string;
  /** Preview errors since the last check (cleared once read). */
  previewErrors: string[];
};

export function getDevServerStatus(webcontainer: WebContainer): DevServerStatus {
  ensurePreviewErrorListener(webcontainer);

  const errors = previewErrors;
  previewErrors = [];

  return {
    running: current !== null && current.exitCode === null,
    command: current?.command ?? null,
    url: current?.url ?? null,
    exitCode: current?.exitCode ?? null,
    logs: current?.logs ?? "",
    previewErrors: errors,
  };
}
