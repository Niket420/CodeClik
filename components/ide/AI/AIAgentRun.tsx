"use client";

import { useState } from "react";
import { Ban, Check, ChevronRight, Loader2, X } from "lucide-react";
import type { AgentRun, AgentStep } from "./types";

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function StepIcon({ status }: { status: AgentStep["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 size={12} className="shrink-0 animate-spin text-[#a371f7]" />;
    case "done":
      return <Check size={12} className="shrink-0 text-[#3fb950]" />;
    case "failed":
      return <X size={12} className="shrink-0 text-[#f85149]" />;
    case "denied":
      return <Ban size={12} className="shrink-0 text-[#6e7681]" />;
  }
}

/**
 * The agent's work log: tool steps and in-between notes, styled apart from
 * normal replies. Open while working; collapses to one line when done.
 */
export default function AIAgentRun({ run }: { run: AgentRun }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? !run.done;

  const toolSteps = run.steps.filter((step) => step.kind === "tool");
  const failures = toolSteps.filter((step) => step.status === "failed").length;

  const summary = !run.done
    ? "Working…"
    : run.endedAt
      ? `Worked for ${formatDuration(run.endedAt - run.startedAt)}`
      : "Done";

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-[#262626] bg-[#0d0d0d]">
      <button
        type="button"
        onClick={() => setToggled(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-[#8b949e] transition hover:bg-[#141414]"
      >
        {run.done ? (
          <ChevronRight size={12} className={`shrink-0 transition ${expanded ? "rotate-90" : ""}`} />
        ) : (
          <Loader2 size={12} className="shrink-0 animate-spin text-[#a371f7]" />
        )}
        <span className={run.done ? "" : "text-[#c9d1d9]"}>{summary}</span>
        {toolSteps.length > 0 && (
          <span className="text-[#6e7681]">
            · {toolSteps.length} step{toolSteps.length === 1 ? "" : "s"}
            {failures > 0 && <span className="text-[#f85149]"> · {failures} failed</span>}
          </span>
        )}
      </button>

      {expanded && (run.steps.length > 0 || run.thinking) && (
        <div className="max-h-64 space-y-1 overflow-y-auto border-t border-[#1f1f1f] px-2.5 py-2">
          {run.steps.map((step) =>
            step.kind === "note" ? (
              <p key={step.id} className="whitespace-pre-wrap break-words text-[11.5px] italic leading-5 text-[#6e7681]">
                {step.label}
              </p>
            ) : (
              <div key={step.id}>
                <div className="flex items-center gap-2 font-mono text-[11px] text-[#8b949e]">
                  <StepIcon status={step.status} />
                  <span className={`truncate ${step.status === "denied" ? "line-through" : ""}`}>{step.label}</span>
                </div>
                {step.detail && (
                  <p className="ml-5 break-words font-mono text-[10.5px] text-[#f85149]/80">{step.detail}</p>
                )}
              </div>
            ),
          )}

          {run.thinking && (
            <p className="whitespace-pre-wrap break-words text-[11.5px] italic leading-5 text-[#6e7681]">
              {run.thinking}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
