"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Info, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
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

const SEEN_KEY = "support-notice-seen";

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
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

/**
 * First visit: a one-time card listing what the workspace can run.
 * Afterwards: a toast whenever a file in an unsupported language appears
 * (created from the explorer, the terminal, or the AI agent) — once per
 * language per session, so it informs without nagging.
 */
export default function SupportNotice({ fileTree }: { fileTree: FileTreeNode[] }) {
  const { push: pushToast } = useToast();
  // Only ever rendered client-side (the playground mounts it after the
  // WebContainer boots), so localStorage can be read up front.
  const [open, setOpen] = useState(() => !readSeen());

  const knownPaths = useRef<Set<string> | null>(null);
  const warnedLanguages = useRef(new Set<string>());

  useEffect(() => {
    const paths = collectFilePaths(fileTree);

    // The first tree is whatever already existed (the IDE only mounts after
    // it's loaded) — only warn about files that appear after that.
    if (knownPaths.current === null) {
      knownPaths.current = paths;
      return;
    }

    for (const path of paths) {
      if (knownPaths.current.has(path)) continue;

      const language = unsupportedLanguageFor(path);
      if (language && !warnedLanguages.current.has(language)) {
        warnedLanguages.current.add(language);
        pushToast({
          tone: "info",
          title: `${language} can't run here`,
          description: `You can edit ${path.split("/").pop()}, but this workspace only runs JavaScript and TypeScript projects (Node.js in your browser).`,
        });
      }
    }

    knownPaths.current = paths;
  }, [fileTree, pushToast]);

  function dismiss() {
    markSeen();
    setOpen(false);
  }

  if (!open) return null;

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
