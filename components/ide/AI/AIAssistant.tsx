"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WebContainer } from "@webcontainer/api";
import {
  Bot,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Plug,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Unplug,
} from "lucide-react";
import AIProviderSelector from "./AIProviderSelector";
import AIProviderSettings from "./AIProviderSettings";
import AIChat from "./AIChat";
import AIInput from "./AIInput";
import { AI_PROVIDERS, type ChatMessage, type ContextMode, type ProviderConfig } from "./types";
import { gatherContext, type OpenFile } from "./contextGather";
import { useToast } from "@/components/ui/toast";
import type { FileTreeNode } from "@/types/file-tree";
import { Agent, supportsToolCalling, type AgentEvent, type ToolCallRequest, type ToolResult } from "@/agents";
import type { PendingApproval } from "./AIApprovalCard";

type AIAssistantProps = {
  activeFilePath?: string;
  webcontainer?: WebContainer | null;
  openedFiles?: OpenFile[];
  fileTree?: FileTreeNode[];
  selectedCode?: string;
  onWorkspaceChange?: () => Promise<void>;
};

let messageCounter = 0;
function nextMessageId() {
  messageCounter += 1;
  return `msg-${Date.now()}-${messageCounter}`;
}

function describeToolCall(call: ToolCallRequest): string {
  const args = call.arguments;

  switch (call.name) {
    case "read_file":
      return `Reading ${String(args.path ?? "")}`;
    case "write_file":
      return `Writing ${String(args.path ?? "")}`;
    case "delete_file":
      return `Deleting ${String(args.path ?? "")}`;
    case "create_directory":
      return `Creating directory ${String(args.path ?? "")}`;
    case "list_directory":
      return `Listing ${String(args.path ?? ".")}`;
    case "run_command": {
      const cmdArgs = Array.isArray(args.args) ? args.args.join(" ") : "";
      return `Running ${String(args.command ?? "")} ${cmdArgs}`.trim();
    }
    case "start_dev_server": {
      const cmdArgs = Array.isArray(args.args) ? args.args.join(" ") : "";
      return `Starting server ${String(args.command ?? "")} ${cmdArgs}`.trim();
    }
    case "check_dev_server":
      return "Checking server output and preview errors";
    default:
      return call.name;
  }
}

function contextLabel(mode: ContextMode, activeFilePath?: string, selectedCode?: string) {
  switch (mode) {
    case "current-file":
      return activeFilePath ? activeFilePath.split("/").pop()! : "No file open";
    case "selected-code":
      return selectedCode && selectedCode.trim()
        ? `${selectedCode.trim().split("\n").length} line(s) selected`
        : "No selection";
    case "open-files":
      return "All open files";
    case "workspace":
      return "Entire workspace";
  }
}

export default function AIAssistant({
  activeFilePath,
  webcontainer = null,
  openedFiles = [],
  fileTree = [],
  selectedCode = "",
  onWorkspaceChange,
}: AIAssistantProps) {
  const { push: pushToast } = useToast();
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [savedConnections, setSavedConnections] = useState<ProviderConfig[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>("current-file");
  const [inputFocusToken, setInputFocusToken] = useState(0);
  const [agentMode, setAgentMode] = useState(false);

  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  // Resolver for the agent's in-flight approval promise — kept in a ref so the
  // Allow/Deny buttons and clearMessages always settle the current one.
  const approvalResolver = useRef<((approved: boolean) => void) | null>(null);

  // Cancels the in-flight request / agent run when the user hits Stop.
  const abortController = useRef<AbortController | null>(null);

  const replyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (replyTimeout.current) clearTimeout(replyTimeout.current);
  }, []);

  // Provider connections are already persisted server-side (encrypted) once configured —
  // hydrate from there so a page refresh doesn't drop back to the empty state.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/ai/providers");
        const data = await response.json();

        if (cancelled) return;

        if (!response.ok || !data.success) {
          throw new Error(data?.error || "Failed to load saved AI providers.");
        }

        if (Array.isArray(data.providers)) {
          const connections: ProviderConfig[] = data.providers.map(
            (entry: { provider: string; model: string; endpoint: string | null }) => ({
              providerId: entry.provider as ProviderConfig["providerId"],
              model: entry.model,
              endpoint: entry.endpoint ?? undefined,
            }),
          );

          setSavedConnections(connections);
          if (connections.length > 0) setConfig(connections[0]);
        }
      } catch (error) {
        if (cancelled) return;

        console.error("Failed to load saved AI providers:", error);
        pushToast({
          tone: "error",
          title: "Couldn't load saved providers",
          description:
            error instanceof Error
              ? error.message
              : "Your saved AI provider connections could not be loaded. Refresh to try again.",
        });
      } finally {
        if (!cancelled) setLoadingConnections(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  const currentProvider = config ? AI_PROVIDERS.find((p) => p.id === config.providerId) : undefined;
  const agentCapable = config ? supportsToolCalling(config.providerId) : false;

  useEffect(() => {
    if (!agentCapable) setAgentMode(false);
  }, [agentCapable]);

  const pendingProvider = pendingProviderId
    ? AI_PROVIDERS.find((p) => p.id === pendingProviderId)
    : undefined;
  const unconfiguredProviders = useMemo(
    () => AI_PROVIDERS.filter((p) => !savedConnections.some((c) => c.providerId === p.id)),
    [savedConnections],
  );

  function clearMessages() {
    if (replyTimeout.current) {
      clearTimeout(replyTimeout.current);
      replyTimeout.current = null;
    }
    // Stop any running agent and deny anything still waiting so it doesn't hang.
    abortController.current?.abort();
    resolveApproval(false);
    setIsGenerating(false);
    setMessages([]);
  }

  function requestApprovalInChat(request: PendingApproval["request"], detail: string): Promise<boolean> {
    resolveApproval(false);
    return new Promise((resolve) => {
      approvalResolver.current = resolve;
      setPendingApproval({ request, detail });
    });
  }

  function resolveApproval(approved: boolean) {
    const resolve = approvalResolver.current;
    approvalResolver.current = null;
    setPendingApproval(null);
    resolve?.(approved);
  }

  function handleNewConversation() {
    clearMessages();
    setContextMode("current-file");
    setMoreMenuOpen(false);
  }

  function handleDisconnect() {
    clearMessages();
    setConfig(null);
    setMoreMenuOpen(false);
  }

  function handleProviderConnected(providerId: string, model: string, endpoint?: string) {
    const newConfig: ProviderConfig = { providerId: providerId as ProviderConfig["providerId"], model, endpoint };
    setConfig(newConfig);
    setSavedConnections((previous) => [
      ...previous.filter((connection) => connection.providerId !== newConfig.providerId),
      newConfig,
    ]);
    setPendingProviderId(null);
    setPickerOpen(false);
  }

async function handleSend() {
  const text = draft.trim();

  if (!text || isGenerating || !config) return;

  const userMessage: ChatMessage = {
    id: nextMessageId(),
    role: "user",
    content: text,
    createdAt: Date.now(),
  };

  const updatedMessages = [...messages, userMessage];

  setMessages(updatedMessages);
  setDraft("");
  setIsGenerating(true);

  const controller = new AbortController();
  abortController.current = controller;

  // Create an empty assistant message immediately.
  const assistantId = nextMessageId();

  setMessages((previous) => [
    ...previous,
    {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    },
  ]);

  try {
    const contextContent = await gatherContext(contextMode, {
      webcontainer,
      openedFiles,
      fileTree,
      activeFilePath,
      selectedCode,
      query: text,
    });

    if (agentMode) {
      if (!webcontainer) throw new Error("Workspace isn't ready yet.");

      let transcript = "";
      const appendToTranscript = (fragment: string) => {
        transcript += fragment;
        setMessages((previous) =>
          previous.map((message) => (message.id === assistantId ? { ...message, content: transcript } : message)),
        );
      };

      const agent = new Agent({
        webcontainer,
        provider: { provider: config.providerId, model: config.model },
        signal: controller.signal,
        onEvent: (event: AgentEvent) => {
          switch (event.type) {
            case "text":
              appendToTranscript(event.delta);
              break;
            case "tool-call":
              appendToTranscript(`\n\n> ${describeToolCall(event.call)}`);
              break;
            case "approval-resolved":
              appendToTranscript(event.approved ? " (approved)" : " (denied)");
              break;
            case "tool-result": {
              const result: ToolResult = event.result;
              if (result.success) {
                appendToTranscript(" — done");
                if (["write_file", "delete_file", "create_directory"].includes(event.call.name)) {
                  void onWorkspaceChange?.();
                }
              } else if (result.error !== "The user did not approve this action.") {
                appendToTranscript(` — failed: ${result.error ?? "unknown error"}`);
              }
              break;
            }
            case "error":
              appendToTranscript(`\n\nError: ${event.message}`);
              break;
          }
        },
        requestApproval: (request) =>
          requestApprovalInChat(
            request,
            describeToolCall({ id: "", name: request.toolName, arguments: request.args }),
          ),
      });

      // Send the full prior conversation, same as chat mode, so follow-ups
      // like "yes" or "now add tax" have something to refer to. Tool-call
      // back-and-forth from earlier runs isn't replayed — the loop rebuilds
      // that per task.
      const history = messages
        .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
        .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

      await agent.run(text, contextContent || undefined, history);
      return;
    }

    const requestMessages = [
      ...(contextContent
        ? [
            {
              role: "system" as const,
              content: `Use the following project context to help answer the user's request. Only rely on it when it's relevant.\n${contextContent}`,
            },
          ]
        : []),
      ...updatedMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: config.providerId,
        model: config.model,
        messages: requestMessages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("AI request failed.");
    }

    if (!response.body) {
      throw new Error("AI response has no stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let accumulatedText = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      const chunk = decoder.decode(value, {
        stream: true,
      });

      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6).trim();

        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);

          const content =
            parsed?.choices?.[0]?.delta?.content;

          if (!content) continue;

          accumulatedText += content;

          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: accumulatedText,
                  }
                : message
            )
          );
        } catch {
          // Ignore incomplete SSE chunks.
        }
      }
    }
  } catch (error) {
    // Stop pressed mid-stream in chat mode: keep whatever text already arrived.
    if (controller.signal.aborted) return;

    console.error("AI request error:", error);

    setMessages((previous) =>
      previous.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content:
                error instanceof Error
                  ? `Error: ${error.message}`
                  : "Sorry, the AI request failed.",
            }
          : message
      )
    );
  } finally {
    if (abortController.current === controller) abortController.current = null;
    setIsGenerating(false);
  }
}

  function handleStop() {
    if (replyTimeout.current) {
      clearTimeout(replyTimeout.current);
      replyTimeout.current = null;
    }
    abortController.current?.abort();
    // An agent waiting on the Allow card would otherwise stay blocked.
    resolveApproval(false);
    setIsGenerating(false);
  }

  return (
    <aside className="flex h-full min-w-0 flex-col bg-[#0a0a0a] text-[#c9d1d9]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#262626] px-3">
        <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em]">
          <Sparkles size={13} className="text-[#a371f7]" />
          CODEFORGE AI
        </span>

        {config && !pendingProviderId && !pickerOpen && (
          <div className="flex items-center gap-0.5 text-[#8b949e]">
            <button
              type="button"
              title={
                agentCapable
                  ? agentMode
                    ? "Agent mode on — can edit files and run commands"
                    : "Turn on Agent mode (can edit files and run commands)"
                  : "Agent mode isn't available for this provider yet"
              }
              aria-pressed={agentMode}
              disabled={!agentCapable}
              onClick={() => setAgentMode((mode) => !mode)}
              className={`grid h-6 w-6 place-items-center rounded transition disabled:cursor-not-allowed disabled:opacity-30 ${
                agentMode ? "bg-[#1a1a1a] text-[#e6edf3]" : "hover:bg-[#262626] hover:text-white"
              }`}
            >
              <Bot size={14} />
            </button>
            <button
              type="button"
              title="New conversation"
              onClick={handleNewConversation}
              className="grid h-6 w-6 place-items-center rounded transition hover:bg-[#262626] hover:text-white"
            >
              <MessageSquarePlus size={14} />
            </button>
            <button
              type="button"
              title="Configure provider"
              onClick={() => setPendingProviderId(config.providerId)}
              className="grid h-6 w-6 place-items-center rounded transition hover:bg-[#262626] hover:text-white"
            >
              <Settings2 size={14} />
            </button>
            <div className="relative">
              <button
                type="button"
                title="More actions"
                onClick={() => setMoreMenuOpen((open) => !open)}
                className="grid h-6 w-6 place-items-center rounded transition hover:bg-[#262626] hover:text-white"
              >
                <MoreHorizontal size={14} />
              </button>

              {moreMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-md border border-[#262626] bg-[#121212] py-1 shadow-xl shadow-black/40">
                    <button
                      type="button"
                      disabled={messages.length === 0}
                      onClick={() => {
                        clearMessages();
                        setMoreMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a] disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                      Clear Conversation
                    </button>
                    <div className="my-1 h-px bg-[#262626]" />
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#ff7b72] transition hover:bg-[#1a1a1a]"
                    >
                      <Unplug size={13} />
                      Disconnect Provider
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {loadingConnections ? (
        <div className="grid flex-1 place-items-center text-[#6e7681]">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : pendingProviderId && pendingProvider ? (
        <AIProviderSettings
          provider={pendingProvider}
          initialModel={config?.providerId === pendingProvider.id ? config.model : undefined}
          initialEndpoint={config?.providerId === pendingProvider.id ? config.endpoint : undefined}
          onBack={() => setPendingProviderId(null)}
          onCancel={() => setPendingProviderId(null)}
          onConnect={({ model, endpoint }) => handleProviderConnected(pendingProvider.id, model, endpoint)}
        />
      ) : pickerOpen ? (
        <AIProviderSelector
          providers={config ? unconfiguredProviders : AI_PROVIDERS}
          heading={config ? "Add another provider" : "Choose an AI provider"}
          subheading={
            config
              ? "Connect an additional provider to switch between them from the chat header."
              : "Connect a provider to start chatting with CodeForge AI."
          }
          onSelect={(provider) => {
            setPickerOpen(false);
            setPendingProviderId(provider.id);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      ) : !config ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-[#262626] bg-[#121212] text-[#a371f7] shadow-lg shadow-black/20">
            <Sparkles size={20} />
          </span>
          <p className="mt-4 text-sm font-medium text-[#e6edf3]">Configure your AI model</p>
          <p className="mt-1 max-w-[240px] text-xs leading-5 text-[#6e7681]">
            Connect an AI provider to start using CodeForge AI inside your workspace.
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="mt-5 flex h-8 items-center gap-2 rounded-md bg-white px-4 text-xs font-semibold text-black transition hover:bg-[#d4d4d4]"
          >
            <Plug size={13} />
            Configure AI
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex h-9 shrink-0 items-center border-b border-[#262626] px-2">
            <button
              type="button"
              onClick={() => setSwitcherOpen((open) => !open)}
              className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-xs transition hover:bg-[#1a1a1a]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
              {currentProvider && <currentProvider.icon size={13} className="shrink-0 text-[#e6edf3]" />}
              <span className="truncate font-medium text-[#e6edf3]">{currentProvider?.name}</span>
              <span className="truncate text-[#6e7681]">· {config.model}</span>
              <ChevronDown size={12} className="shrink-0 text-[#6e7681]" />
            </button>

            {switcherOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSwitcherOpen(false)} />
                <div className="cf-dropdown absolute left-2 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-[#262626] bg-[#121212] shadow-xl shadow-black/40">
                  <div className="max-h-64 overflow-auto py-1">
                    {savedConnections.map((connection) => {
                      const provider = AI_PROVIDERS.find((p) => p.id === connection.providerId);
                      if (!provider) return null;

                      const isActive =
                        config.providerId === connection.providerId && config.model === connection.model;

                      return (
                        <button
                          key={connection.providerId}
                          type="button"
                          onClick={() => {
                            setConfig(connection);
                            setSwitcherOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-[#1a1a1a]"
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-[#3fb950]" : "bg-transparent"}`}
                          />
                          <provider.icon size={13} className="shrink-0 text-[#e6edf3]" />
                          <span className={isActive ? "font-medium text-[#e6edf3]" : "text-[#c9d1d9]"}>
                            {provider.name}
                          </span>
                          <span className="ml-auto min-w-0 truncate text-[#6e7681]">{connection.model}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="my-1 h-px bg-[#262626]" />
                  <button
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      setPickerOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-white transition hover:bg-[#1a1a1a]"
                  >
                    <Plus size={13} />
                    Configure provider
                  </button>
                </div>
              </>
            )}
          </div>

          <AIChat
            messages={messages}
            isGenerating={isGenerating}
            pendingApproval={pendingApproval}
            onApprovalDecision={resolveApproval}
            modelLabel={`${currentProvider?.name ?? "your provider"} · ${config.model}`}
            onSuggestion={(prompt) => {
              setDraft(prompt);
              setInputFocusToken((token) => token + 1);
            }}
          />

          <AIInput
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            onStop={handleStop}
            isGenerating={isGenerating}
            contextMode={contextMode}
            onContextModeChange={setContextMode}
            contextLabel={contextLabel(contextMode, activeFilePath, selectedCode)}
            focusToken={inputFocusToken}
          />
        </>
      )}
    </aside>
  );
}
