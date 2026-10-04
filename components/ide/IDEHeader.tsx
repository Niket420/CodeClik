"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import {
  CornerDownLeft,
  FileCode2,
  Globe2,
  PanelBottom,
  PanelRight,
  Search,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import type { FileTreeNode } from "@/types/file-tree";
import BrandMark, { BRAND_NAME } from "@/components/brand/BrandMark";

type ActivityItem = {
  id: string;
  label: string;
  icon: typeof FileCode2;
};

type IDEHeaderProps = {
  fileTree: FileTreeNode[];
  activityItems: ActivityItem[];
  onSelectActivity: (id: string) => void;
  aiOpen: boolean;
  onToggleAI: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onOpenFile: (path: string) => void;
};

type PaletteItem = {
  id: string;
  label: string;
  sublabel?: string;
  icon: typeof FileCode2;
  onRun: () => void;
};

function flattenFiles(nodes: FileTreeNode[], acc: { path: string; name: string }[] = []) {
  for (const node of nodes) {
    if (node.name === "node_modules") continue;
    if (node.type === "file") {
      acc.push({ path: node.path, name: node.name });
    } else if (node.children) {
      flattenFiles(node.children, acc);
    }
  }
  return acc;
}

export default function IDEHeader({
  fileTree,
  activityItems,
  onSelectActivity,
  aiOpen,
  onToggleAI,
  terminalOpen,
  onToggleTerminal,
  previewOpen,
  onTogglePreview,
  onOpenFile,
}: IDEHeaderProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const files = useMemo(() => flattenFiles(fileTree), [fileTree]);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  const results = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();

    const commands: PaletteItem[] = [
      {
        id: "cmd-ai",
        label: aiOpen ? "Close AI Assistant" : "Open AI Assistant",
        icon: Sparkles,
        onRun: onToggleAI,
      },
      {
        id: "cmd-terminal",
        label: terminalOpen ? "Close Terminal" : "Open Terminal",
        icon: TerminalSquare,
        onRun: onToggleTerminal,
      },
      {
        id: "cmd-preview",
        label: previewOpen ? "Close Preview" : "Open Preview",
        icon: Globe2,
        onRun: onTogglePreview,
      },
    ];

    const views: PaletteItem[] = activityItems.map((item) => ({
      id: `view-${item.id}`,
      label: item.label,
      sublabel: "View",
      icon: item.icon,
      onRun: () => onSelectActivity(item.id),
    }));

    const matchedFiles: PaletteItem[] = (q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files)
      .slice(0, 30)
      .map((file) => ({
        id: `file-${file.path}`,
        label: file.name,
        sublabel: file.path,
        icon: FileCode2,
        onRun: () => onOpenFile(file.path),
      }));

    const filteredCommands = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    const filteredViews = q ? views.filter((v) => v.label.toLowerCase().includes(q)) : views;

    return [...filteredCommands, ...filteredViews, ...matchedFiles].slice(0, 40);
  }, [
    query,
    files,
    activityItems,
    aiOpen,
    onToggleAI,
    terminalOpen,
    previewOpen,
    onToggleTerminal,
    onTogglePreview,
    onSelectActivity,
    onOpenFile,
  ]);

  function runResult(item: PaletteItem) {
    item.onRun();
    setPaletteOpen(false);
  }

  return (
    <div className="relative flex h-full items-center gap-3 bg-[#000000] px-3 text-[#c9d1d9]">
      <div className="flex min-w-0 items-center gap-2">
        <BrandMark size={24} />
        <span className="hidden text-[13px] font-semibold tracking-tight text-white sm:inline">
          {BRAND_NAME}
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-24">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search files and commands"
          className="pointer-events-auto flex h-7 w-full max-w-sm items-center justify-between rounded-md border border-[#262626] bg-[#000000] px-2.5 text-[11px] text-[#6e7681] transition hover:border-[#333333] hover:text-[#aeb8c2]"
        >
          <span className="flex items-center gap-2">
            <Search size={12} />
            Search files, jump to a view…
          </span>
          <span className="hidden items-center gap-0.5 rounded border border-[#262626] px-1 text-[10px] sm:flex">
            <span>⌘</span>K
          </span>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          title="AI Assistant"
          aria-label="Toggle AI Assistant"
          aria-pressed={aiOpen}
          onClick={onToggleAI}
          className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition ${
            aiOpen
              ? "bg-[#1a1a1a] text-[#e6edf3]"
              : "text-[#8b949e] hover:bg-[#1a1a1a] hover:text-white"
          }`}
        >
          <BrandMark size={16} className="shadow-none" />
          <span className="hidden sm:inline">AI</span>
        </button>

        <button
          type="button"
          title="Terminal"
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
          onClick={onToggleTerminal}
          className={`grid h-7 w-7 place-items-center rounded-md transition ${
            terminalOpen
              ? "bg-[#1a1a1a] text-[#e6edf3]"
              : "text-[#8b949e] hover:bg-[#1a1a1a] hover:text-white"
          }`}
        >
          <PanelBottom size={15} />
        </button>
        <button
          type="button"
          title="Preview"
          aria-label="Toggle preview"
          aria-pressed={previewOpen}
          onClick={onTogglePreview}
          className={`grid h-7 w-7 place-items-center rounded-md transition ${
            previewOpen
              ? "bg-[#1a1a1a] text-[#e6edf3]"
              : "text-[#8b949e] hover:bg-[#1a1a1a] hover:text-white"
          }`}
        >
          <PanelRight size={15} />
        </button>

        <div className="ml-1.5 grid h-6 w-6 place-items-center">
          <UserButton
            appearance={{
              elements: { avatarBox: "h-6 w-6" },
            }}
          />
        </div>
      </div>

      {paletteOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center bg-black/60 pt-[12vh]"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="cf-dropdown w-full max-w-lg overflow-hidden rounded-md border border-[#262626] bg-[#0a0a0a] shadow-2xl shadow-black/50"
          >
            <div className="flex items-center gap-2 border-b border-[#262626] px-3 py-2.5">
              <Search size={14} className="shrink-0 text-[#6e7681]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setPaletteOpen(false);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedIndex((index) => Math.min(index + 1, results.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedIndex((index) => Math.max(index - 1, 0));
                  } else if (event.key === "Enter" && results[selectedIndex]) {
                    runResult(results[selectedIndex]);
                  }
                }}
                placeholder="Search files, jump to a view, or run a command…"
                className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-[#e6edf3] outline-none placeholder:text-[#6e7681]"
              />
              <span className="hidden shrink-0 items-center gap-0.5 rounded border border-[#262626] px-1 text-[10px] text-[#6e7681] sm:flex">
                Esc
              </span>
            </div>

            <div className="max-h-80 overflow-auto py-1">
              {results.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-[#6e7681]">No matches found.</p>
              ) : (
                results.map((item, index) => {
                  const Icon = item.icon;
                  const isSelected = index === selectedIndex;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => runResult(item)}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition ${
                        isSelected ? "bg-[#1a1a1a] text-[#e6edf3]" : "text-[#c9d1d9]"
                      }`}
                    >
                      <Icon size={13} className="shrink-0 text-[#8b949e]" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="shrink-0 truncate text-[10.5px] text-[#6e7681]">{item.sublabel}</span>
                      )}
                      {isSelected && <CornerDownLeft size={11} className="shrink-0 text-[#6e7681]" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
