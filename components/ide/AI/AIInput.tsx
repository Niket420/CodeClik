"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Code2, CornerDownLeft, Files, FileCode2, FolderTree, Send, Square } from "lucide-react";
import type { ContextMode } from "./types";

type AIInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isGenerating: boolean;
  contextMode: ContextMode;
  onContextModeChange: (mode: ContextMode) => void;
  contextLabel: string;
  focusToken?: number;
};

const CONTEXT_OPTIONS: { id: ContextMode; label: string; icon: typeof FileCode2 }[] = [
  { id: "current-file", label: "Current file", icon: FileCode2 },
  { id: "selected-code", label: "Selected code", icon: Code2 },
  { id: "open-files", label: "Open files", icon: Files },
  { id: "workspace", label: "Workspace", icon: FolderTree },
];

export default function AIInput({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
  contextMode,
  onContextModeChange,
  contextLabel,
  focusToken,
}: AIInputProps) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeContext = CONTEXT_OPTIONS.find((option) => option.id === contextMode) ?? CONTEXT_OPTIONS[0];
  const ActiveIcon = activeContext.icon;

  useEffect(() => {
    if (focusToken !== undefined) textareaRef.current?.focus();
  }, [focusToken]);

  function handleSend() {
    if (isGenerating || !value.trim()) return;
    onSend();
  }

  return (
    <div className="border-t border-[#262626] p-2.5">
      <div className="relative mb-1.5">
        <button
          type="button"
          onClick={() => setContextMenuOpen((open) => !open)}
          className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-[#8b949e] transition hover:bg-[#1a1a1a] hover:text-[#c9d1d9]"
        >
          <ActiveIcon size={12} />
          <span>
            Context: <span className="text-[#aeb8c2]">{contextLabel}</span>
          </span>
          <ChevronDown size={11} className="text-[#6e7681]" />
        </button>

        {contextMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContextMenuOpen(false)} />
            <div className="cf-dropdown absolute bottom-full left-0 z-50 mb-1 w-52 overflow-hidden rounded-md border border-[#262626] bg-[#121212] py-1 shadow-xl shadow-black/40">
              {CONTEXT_OPTIONS.map((option) => {
                const OptionIcon = option.icon;
                const isActive = option.id === contextMode;

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onContextModeChange(option.id);
                      setContextMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-[#1a1a1a]"
                  >
                    <OptionIcon size={13} className="text-[#8b949e]" />
                    <span className={isActive ? "font-medium text-white" : "text-[#c9d1d9]"}>
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="rounded border border-[#262626] bg-[#000000] transition focus-within:border-[#525252]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask MightGuy AI… (Shift+Enter for a new line)"
          rows={3}
          className="h-16 w-full resize-none bg-transparent p-2 text-xs text-[#e6edf3] outline-none placeholder:text-[#6e7681]"
        />

        <div className="flex items-center justify-between px-2 pb-1.5">
          <span className="flex items-center gap-1 text-[10px] text-[#484f58]">
            <CornerDownLeft size={11} />
            to send
          </span>

          {isGenerating ? (
            <button
              type="button"
              title="Stop generating"
              onClick={onStop}
              className="flex h-6 items-center gap-1.5 rounded bg-[#262626] px-2.5 text-[11px] font-medium text-[#e6edf3] transition hover:bg-[#333333]"
            >
              <Square size={11} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              title="Send message"
              disabled={!value.trim()}
              onClick={handleSend}
              className="grid h-6 w-6 place-items-center rounded bg-white text-black transition hover:bg-[#d4d4d4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
