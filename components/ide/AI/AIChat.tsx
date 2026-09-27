"use client";

import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import AIMessage from "./AIMessage";
import AIApprovalCard, { type PendingApproval } from "./AIApprovalCard";
import type { ChatMessage } from "./types";

type AIChatProps = {
  messages: ChatMessage[];
  isGenerating: boolean;
  pendingApproval?: PendingApproval | null;
  onApprovalDecision?: (approved: boolean) => void;
  modelLabel: string;
  onSuggestion: (prompt: string) => void;
};

const SUGGESTIONS = [
  "Explain what this file does",
  "Find potential bugs in the current file",
  "Write unit tests for the selected code",
  "Suggest a refactor for readability",
];

export default function AIChat({
  messages,
  isGenerating,
  pendingApproval,
  onApprovalDecision,
  modelLabel,
  onSuggestion,
}: AIChatProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, isGenerating, pendingApproval]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-[#262626] bg-[#121212] text-[#a371f7] shadow-lg shadow-black/20">
          <Sparkles size={20} />
        </span>
        <p className="mt-4 text-sm font-medium text-[#e6edf3]">Ask CodeForge AI anything</p>
        <p className="mt-1 max-w-xs text-xs leading-5 text-[#6e7681]">
          Connected to {modelLabel}. Start a conversation about your code, or try a suggestion below.
        </p>

        <div className="mt-5 flex w-full max-w-xs flex-col gap-1.5">
          {SUGGESTIONS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSuggestion(prompt)}
              className="rounded-md border border-[#262626] bg-[#121212] px-3 py-2 text-left text-[11.5px] text-[#8b949e] transition hover:border-[#333333] hover:text-[#e6edf3]"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      {messages.map((message) => (
        <AIMessage key={message.id} message={message} />
      ))}

      {pendingApproval && onApprovalDecision ? (
        <AIApprovalCard approval={pendingApproval} onDecision={onApprovalDecision} />
      ) : isGenerating && (
        <div className="flex items-center gap-2.5 px-3 py-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#a371f7]/15 text-[#a371f7]">
            <Sparkles size={13} />
          </span>
          <span className="flex items-center gap-1 text-[12px] text-[#8b949e]">
            Thinking
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-[#8b949e] [animation-delay:-0.2s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-[#8b949e] [animation-delay:-0.1s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-[#8b949e]" />
            </span>
          </span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
