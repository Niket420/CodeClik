"use client";

import { Sparkles, User, Copy, Check } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { ChatMessage } from "./types";

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AIMessage({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="px-3 py-2">
        <div className="rounded-md border border-[#262626] bg-[#121212] p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-[#6e7681]">
            <User size={11} />
            <span className="font-medium text-[#8b949e]">You</span>
            <span>{formatTime(message.createdAt)}</span>
          </div>

          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#e6edf3]">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  const markdownComponents: Components = {
    h1: ({ children }) => (
      <h1 className="mb-3 mt-4 text-lg font-semibold text-[#f0f6fc] first:mt-0">
        {children}
      </h1>
    ),

    h2: ({ children }) => (
      <h2 className="mb-2 mt-4 text-base font-semibold text-[#f0f6fc] first:mt-0">
        {children}
      </h2>
    ),

    h3: ({ children }) => (
      <h3 className="mb-2 mt-3 text-sm font-semibold text-[#f0f6fc]">
        {children}
      </h3>
    ),

    p: ({ children }) => (
      <p className="mb-3 text-[13px] leading-6 text-[#c9d1d9] last:mb-0">
        {children}
      </p>
    ),

    strong: ({ children }) => (
      <strong className="font-semibold text-[#f0f6fc]">
        {children}
      </strong>
    ),

    em: ({ children }) => (
      <em className="text-[#d0d7de]">{children}</em>
    ),

    ul: ({ children }) => (
      <ul className="mb-3 ml-5 list-disc space-y-1 text-[13px] leading-5 text-[#c9d1d9]">
        {children}
      </ul>
    ),

    ol: ({ children }) => (
      <ol className="mb-3 ml-5 list-decimal space-y-1 text-[13px] leading-5 text-[#c9d1d9]">
        {children}
      </ol>
    ),

    li: ({ children }) => (
      <li className="pl-1">{children}</li>
    ),

    blockquote: ({ children }) => (
      <blockquote className="mb-3 border-l-2 border-[#444] pl-3 text-[#8b949e]">
        {children}
      </blockquote>
    ),

    hr: () => (
      <hr className="my-4 border-[#262626]" />
    ),

    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#58a6ff] underline decoration-[#58a6ff]/40 underline-offset-2 hover:decoration-[#58a6ff]"
      >
        {children}
      </a>
    ),

    code: ({ className, children, ...props }) => {
      const isBlock = Boolean(className);

      if (!isBlock) {
        return (
          <code
            {...props}
            className="rounded bg-[#1f1f1f] px-1.5 py-0.5 font-mono text-[12px] text-[#e6edf3]"
          >
            {children}
          </code>
        );
      }

      return (
        <CodeBlock className={className}>
          {String(children).replace(/\n$/, "")}
        </CodeBlock>
      );
    },

    pre: ({ children }) => (
      <div className="mb-3 overflow-hidden rounded-lg border border-[#303030] bg-[#0d1117]">
        {children}
      </div>
    ),

    table: ({ children }) => (
      <div className="mb-3 overflow-x-auto rounded-md border border-[#303030]">
        <table className="w-full border-collapse text-left text-[12px]">
          {children}
        </table>
      </div>
    ),

    thead: ({ children }) => (
      <thead className="bg-[#161b22] text-[#e6edf3]">
        {children}
      </thead>
    ),

    th: ({ children }) => (
      <th className="border-b border-[#303030] px-3 py-2 font-semibold">
        {children}
      </th>
    ),

    td: ({ children }) => (
      <td className="border-b border-[#262626] px-3 py-2 text-[#c9d1d9]">
        {children}
      </td>
    ),
  };

  return (
    <div className="flex gap-2.5 px-3 py-2">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#a371f7]/15 text-[#a371f7]">
        <Sparkles size={13} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-[#6e7681]">
          <span className="font-medium text-[#8b949e]">
            MightGuy AI
          </span>
          <span>{formatTime(message.createdAt)}</span>
        </div>

        <div className="break-words text-[13px] leading-relaxed text-[#c9d1d9]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const language = className?.match(/language-(\w+)/)?.[1] ?? "code";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch (error) {
      console.error("Failed to copy code:", error);
    }
  }

  return (
    <div className="overflow-hidden">
      <div className="flex h-8 items-center justify-between border-b border-[#303030] bg-[#161b22] px-3">
        <span className="font-mono text-[10px] text-[#8b949e]">
          {language}
        </span>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[10px] text-[#8b949e] transition hover:bg-[#21262d] hover:text-[#e6edf3]"
        >
          {copied ? (
            <>
              <Check size={11} />
              Copied
            </>
          ) : (
            <>
              <Copy size={11} />
              Copy
            </>
          )}
        </button>
      </div>

      <pre className="overflow-x-auto p-3">
        <code className="font-mono text-[12px] leading-5 text-[#c9d1d9]">
          {children}
        </code>
      </pre>
    </div>
  );
}