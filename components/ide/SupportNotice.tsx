"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import type { FileTreeNode } from "@/types/file-tree";

// The workspace runs Node.js inside the browser (WebContainer), so only the
// JavaScript ecosystem can actually run. Other languages can be edited but
// have no runtime here.
const SUPPORTED = [
  "HTML, CSS & JavaScript",
  "TypeScript",
  "React, Vite & Next.js",
  "Node.js & Express",
  "npm packages",
];

const UNSUPPORTED_LANGUAGES: Record<string, string> = {
  py: "Python",
  java: "Java",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  cs: "C#",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  dart: "Dart",
  r: "R",
  lua: "Lua",
  pl: "Perl",
};

// Remembered per Clerk session: every new sign-in is a new session, so the
// card shows again after each sign-in but not on every reload.
const seenKey = (sessionId: string) => `support-notice-seen:${sessionId}`;

function readSeen(sessionId: string): boolean {
  try {
    return localStorage.getItem(seenKey(sessionId)) === "1";
  } catch {
    return false;
  }
}

function markSeen(sessionId: string) {
  try {
    localStorage.setItem(seenKey(sessionId), "1");
  } catch {
    // Storage blocked (private mode etc.) — the notice just shows again next time.
  }
}

function collectFilePaths(nodes: FileTreeNode[], into: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    if (node.type === "file") into.add(node.path);
    if (node.children) collectFilePaths(node.children, into);
  }
  return into;
}

function unsupportedLanguageFor(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  if (!name.includes(".")) return null;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return UNSUPPORTED_LANGUAGES[extension] ?? null;
}

type UnsupportedWarning = { language: string; fileName: string };

/**
 * After each sign-in: a card listing what the workspace can run.
 * Whenever a file in an unsupported language appears (created from the
 * explorer, the terminal, or the AI agent): a warning card that stays until
 * "Got it" is clicked — once per language per session, so it informs without
 * nagging.
 */
export default function SupportNotice({ fileTree }: { fileTree: FileTreeNode[] }) {
  const { sessionId } = useAuth();
  const [dismissedSession, setDismissedSession] = useState<string | null>(null);
  const open = Boolean(sessionId) && dismissedSession !== sessionId && !readSeen(sessionId!);

  // The first tree is whatever already existed (the IDE only mounts after it's
  // loaded) — only files that appear after that are checked. Tracked as
  // "previous tree" state so new files are detected during render.
  const [previousTree, setPreviousTree] = useState(fileTree);
  const [knownPaths, setKnownPaths] = useState(() => collectFilePaths(fileTree));
  const [warnedLanguages, setWarnedLanguages] = useState<Set<string>>(() => new Set());
  const [warnings, setWarnings] = useState<UnsupportedWarning[]>([]);

  if (fileTree !== previousTree) {
    setPreviousTree(fileTree);
    const paths = collectFilePaths(fileTree);
    const nextWarned = new Set(warnedLanguages);
    const newWarnings: UnsupportedWarning[] = [];

    for (const path of paths) {
      if (knownPaths.has(path)) continue;
      const language = unsupportedLanguageFor(path);
      if (language && !nextWarned.has(language)) {
        nextWarned.add(language);
        newWarnings.push({ language, fileName: path.split("/").pop() ?? path });
      }
    }

    setKnownPaths(paths);
    if (newWarnings.length > 0) {
      setWarnedLanguages(nextWarned);
      setWarnings((current) => [...current, ...newWarnings]);
    }
  }

  function dismiss() {
    if (sessionId) {
      markSeen(sessionId);
      setDismissedSession(sessionId);
    }
  }

  return (
    <>
      {open && <WelcomeCard onDismiss={dismiss} />}
      {warnings.length > 0 && <UnsupportedCard warnings={warnings} onDismiss={() => setWarnings([])} />}
    </>
  );
}

/** Stays until "Got it" — deliberately no auto-close and no close button. */
function UnsupportedCard({ warnings, onDismiss }: { warnings: UnsupportedWarning[]; onDismiss: () => void }) {
  const languages = warnings.map((warning) => warning.language).join(", ");

  return (
    <div
      role="alertdialog"
      aria-labelledby="unsupported-title"
      className="fixed bottom-10 right-4 z-[150] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[#262626] border-l-2 border-l-[#e3b341] bg-[#0a0a0a] p-4 shadow-2xl shadow-black/60"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={15} className="shrink-0 text-[#e3b341]" />
        <h2 id="unsupported-title" className="text-sm font-semibold text-white">
          {`${languages} can't run here`}
        </h2>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[#8b949e]">
        You can edit {warnings.map((warning) => warning.fileName).join(", ")}, but this workspace only runs
        JavaScript and TypeScript projects (Node.js in your browser).
      </p>
      <button
        type="button"
        autoFocus
        onClick={onDismiss}
        className="mt-4 w-full rounded-md bg-white py-2 text-xs font-semibold text-black transition hover:bg-[#d4d4d4]"
      >
        Got it
      </button>
    </div>
  );
}

function WelcomeCard({ onDismiss: dismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-[150] grid place-items-center bg-black/60 px-4" onClick={dismiss}>
      <div
        role="dialog"
        aria-labelledby="support-notice-title"
        className="w-full max-w-sm rounded-xl border border-[#262626] bg-[#0a0a0a] p-5 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[#58a6ff]/15 text-[#58a6ff]">
              <Info size={15} />
            </span>
            <h2 id="support-notice-title" className="text-sm font-semibold text-white">
              What runs in this workspace
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            className="grid h-6 w-6 place-items-center rounded text-[#8b949e] transition hover:bg-[#1a1a1a] hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <ul className="mt-4 space-y-1.5">
          {SUPPORTED.map((item) => (
            <li key={item} className="flex items-center gap-2 text-[12.5px] text-[#c9d1d9]">
              <Check size={13} className="shrink-0 text-[#3fb950]" />
              {item}
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[11.5px] leading-5 text-[#8b949e]">
          Python, Java, C/C++, Go, Rust, PHP and other languages can be edited but not run — the
          workspace runs Node.js inside your browser.
        </p>

        <button
          type="button"
          autoFocus
          onClick={dismiss}
          className="mt-5 w-full rounded-md bg-white py-2 text-xs font-semibold text-black transition hover:bg-[#d4d4d4]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
