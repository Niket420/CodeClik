"use client";

import { ShieldAlert } from "lucide-react";
import type { ApprovalRequest } from "@/agents";

export type PendingApproval = {
  request: ApprovalRequest;
  /** Short action summary, e.g. "Running npm install lodash". */
  detail: string;
};

type AIApprovalCardProps = {
  approval: PendingApproval;
  onDecision: (approved: boolean) => void;
};

export default function AIApprovalCard({ approval, onDecision }: AIApprovalCardProps) {
  return (
    <div className="mx-3 my-2 overflow-hidden rounded-lg border border-[#d29922]/40 bg-[#121212]">
      <div className="flex items-center gap-2 border-b border-[#262626] px-3 py-2 text-[11.5px] font-medium text-[#d29922]">
        <ShieldAlert size={13} />
        Allow this action?
      </div>

      <div className="space-y-1.5 px-3 py-2">
        <code className="block break-all rounded bg-[#0a0a0a] px-2 py-1.5 font-mono text-[11.5px] text-[#e6edf3]">
          {approval.detail}
        </code>
        {approval.request.reason && (
          <p className="text-[11.5px] leading-5 text-[#8b949e]">{approval.request.reason}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-[#262626] px-3 py-2">
        <button
          type="button"
          onClick={() => onDecision(false)}
          className="rounded-md border border-[#262626] px-3 py-1 text-[11.5px] text-[#8b949e] transition hover:border-[#333333] hover:text-[#e6edf3]"
        >
          Deny
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => onDecision(true)}
          className="rounded-md bg-white px-3 py-1 text-[11.5px] font-medium text-black transition hover:bg-[#e6edf3]"
        >
          Allow
        </button>
      </div>
    </div>
  );
}
