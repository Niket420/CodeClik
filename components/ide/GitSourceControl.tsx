"use client";

import { useEffect, useState } from "react";
import GitHubRepositories from "@/components/ide/GitHubRepositories";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  GitCommit,
  GitFork,
  GitMerge,
  History,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { getWebContainer } from "@/lib/webcontainer";
import {
  initGit,
  cloneRepository,
  getGitStatus,
  stageFile,
  stageAll,
  unstageFile,
  unstageAll,
  commitChanges,
  getGitLog,
  getBranches,
  getCurrentBranch,
  checkoutBranch,
  createBranch,
  deleteBranch,
  getRemotes,
  addRemote,
  deleteRemote,
  getTags,
  createTag,
  fetchRemote,
  pullRemote,
  pushRemote,
  mergeBranch,
  startFreshHistory,
  MergeBlockedError,
  type GitLogEntry,
} from "@/lib/git";

type GitStatusRow = [string, number, number, number];
type Tone = "info" | "success" | "error";
type MoreView = "root" | "merge-branch" | "delete-branch" | "remotes" | "tags";

/** Turns git/network errors from fetch, pull and push into something actionable. */
function remoteErrorMessage(action: string, error: unknown): string {
  const code = (error as { code?: string })?.code;
  // GitHub's own explanation, captured by pushRemote — the most precise reason.
  const remoteMessage = (error as { remoteMessage?: string })?.remoteMessage;
  if (remoteMessage && /did not receive expected object|shallow update not allowed/i.test(remoteMessage)) {
    return `${action} failed: this project's history is incomplete (it was cloned without full history), so it can't go to a different repository. Use ⋯ → Push as New Project.`;
  }
  if (remoteMessage) {
    return `${action} failed. GitHub says: ${remoteMessage.slice(0, 300)}`;
  }
  const status = (error as { data?: { statusCode?: number } })?.data?.statusCode;

  if (code === "MissingParameterError" || code === "NotFoundError") {
    return `${action} failed: this project has no remote. Add one in ⋯ → Remotes (name "origin", your GitHub repo URL).`;
  }
  if (status === 401 || status === 403) {
    return `${action} failed: GitHub refused access. Check that the CodeClik GitHub App can access this repository with read & write permission.`;
  }
  if (status === 404) {
    return `${action} failed: repository not found. Check the remote URL, and that the CodeClik GitHub App has access to it.`;
  }
  if (code === "PushRejectedError" || code === "GitPushError") {
    return `${action} failed: the GitHub repository has commits this project doesn't have. Pull first, push to a new branch, or use ⋯ → Force Push to overwrite GitHub's version.`;
  }
  return `${action} failed.`;
}

type GitSourceControlProps = {
  onRefreshExplorer?: () => Promise<void>;
  onOpenDiff?: (entry: GitLogEntry, filepath: string) => void;
  /** Number of files with changes (staged, unstaged or new) — for the activity-bar badge. */
  onChangeCount?: (count: number) => void;
};


// Mirrors isomorphic-git's statusMatrix table: [HEAD, WORKDIR, STAGE] each 0/1/2(/3).
function unstagedBadge(head: number, workdir: number) {
  if (head === 0 && workdir === 2) return { letter: "U", className: "text-[#3fb950]" };
  if (head === 1 && workdir === 2) return { letter: "M", className: "text-[#e3b341]" };
  if (head === 1 && workdir === 0) return { letter: "D", className: "text-[#f85149]" };
  return null;
}

function stagedBadge(head: number, stage: number) {
  if (head === 0) return { letter: "A", className: "text-[#3fb950]" };
  if (head === 1 && stage === 0) return { letter: "D", className: "text-[#f85149]" };
  if (head === 1) return { letter: "M", className: "text-[#e3b341]" };
  return null;
}

// commit.changes tuples are [newOid, oldOid, filepath]; an added/removed file
// has a null old/new oid respectively.
function changeBadge(newOid: string | null, oldOid: string | null) {
  if (newOid === null) return { letter: "D", className: "text-[#f85149]" };
  if (oldOid === null) return { letter: "A", className: "text-[#3fb950]" };
  return { letter: "M", className: "text-[#e3b341]" };
}

function splitPath(path: string) {
  const parts = path.split("/");
  return { name: parts.pop()!, dir: parts.join("/") };
}

function relativeTime(unixSeconds: number) {
  const minutes = Math.floor((Date.now() - unixSeconds * 1000) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function GitSourceControl({ onRefreshExplorer, onOpenDiff, onChangeCount }: GitSourceControlProps) {
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [status, setStatus] = useState<GitStatusRow[]>([]);
  const [history, setHistory] = useState<GitLogEntry[]>([]);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [currentBranch, setCurrentBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<Tone>("info");

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreView, setMoreView] = useState<MoreView>("root");
  const [remotes, setRemotes] = useState<{ remote: string; url: string }[]>([]);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [newRemoteUrl, setNewRemoteUrl] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [githubPickerOpen, setGithubPickerOpen] = useState(false);
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);

  const { push: pushToast } = useToast();

  function notify(text: string, nextTone: Tone = "info") {
    setMessage(text);
    setTone(nextTone);

    if (nextTone === "error") {
      pushToast({ tone: "error", title: text });
    }
  }

  async function fetchGithubToken() {
    const response = await fetch("/api/github/token");
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to get GitHub token");
    }

    return data.token as string;
  }

  async function refreshGit() {
    try {
      const result = await getGitStatus();
      setStatus(result as GitStatusRow[]);
      setInitialized(true);

      try {
        setCurrentBranch((await getCurrentBranch()) || "");
      } catch {
        setCurrentBranch("");
      }

      try {
        setBranches(await getBranches());
      } catch {
        setBranches([]);
      }

      try {
        setHistory(await getGitLog(20));
      } catch {
        setHistory([]);
      }
    } catch {
      setInitialized(false);
    }
  }

  async function checkGithubStatus() {
    try {
      const response = await fetch("/api/github/status");
      const data = await response.json();
      setGithubConnected(response.ok && data.success ? !!data.connected : null);
    } catch {
      setGithubConnected(null);
    }
  }

  function handleConnectGithub() {
    window.open("/api/github/install", "_blank", "noopener,noreferrer");
  }

  // The GitHub App install flow opens in a new tab (it ends on /api/github/callback,
  // outside this SPA), so re-check connection status whenever the user tabs back in.
  useEffect(() => {
    checkGithubStatus();

    function onFocus() {
      checkGithubStatus();
    }

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Initial load, plus a live filesystem watch so edits made in the Editor,
  // Terminal, or File Explorer show up under Changes without a manual refresh.
  useEffect(() => {
    refreshGit();

    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let watcher: { close(): void } | undefined;

    (async () => {
      const wc = await getWebContainer();
      if (cancelled) return;

      watcher = wc.fs.watch(".", { recursive: true }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => void refreshGit(), 400);
      });
    })();

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      watcher?.close();
    };
  }, []);

  async function handleInitGit() {
    try {
      setInitializing(true);
      await initGit();
      await refreshGit();
    } catch (error) {
      console.error("Git init error:", error);
      notify("Git initialization failed.", "error");
    } finally {
      setInitializing(false);
    }
  }

function handleClone() {
  setGithubPickerOpen(true);
}
  async function handleStage(path: string) {
    try {
      await stageFile(path);
      await refreshGit();
    } catch (error) {
      console.error("Stage error:", error);
      notify(`Could not stage ${path}`, "error");
    }
  }

  async function handleUnstage(path: string) {
    try {
      await unstageFile(path);
      await refreshGit();
    } catch (error) {
      console.error("Unstage error:", error);
      notify(`Could not unstage ${path}`, "error");
    }
  }

  async function handleStageAll() {
    try {
      setLoading(true);
      await stageAll();
      await refreshGit();
      notify("Staged all changes.", "success");
    } catch (error) {
      console.error("Stage all error:", error);
      notify("Could not stage all changes.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnstageAll() {
    try {
      setLoading(true);
      await unstageAll();
      await refreshGit();
      notify("Unstaged all changes.", "success");
    } catch (error) {
      console.error("Unstage all error:", error);
      notify("Could not unstage all changes.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!commitMessage.trim()) {
      notify("Enter a commit message first.");
      return;
    }

    try {
      setLoading(true);

      await commitChanges(commitMessage.trim(), {
        name: "Niket",
        email: "niket@example.com",
      });

      setCommitMessage("");
      notify("Commit created.", "success");

      await refreshGit();
      await onRefreshExplorer?.();
    } catch (error) {
      console.error("Commit error:", error);
      notify("Commit failed.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleFetch() {
    try {
      setLoading(true);
      const token = await fetchGithubToken();
      await fetchRemote("origin", token);
      notify("Fetch completed.", "success");
      await refreshGit();
    } catch (error) {
      console.error("Fetch error:", error);
      notify(remoteErrorMessage("Fetch", error), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handlePull() {
    try {
      setLoading(true);
      const token = await fetchGithubToken();
      await pullRemote("origin", undefined, token, { name: "Niket", email: "niket@example.com" });
      notify("Pull completed.", "success");
      await refreshGit();
      await onRefreshExplorer?.();
    } catch (error) {
      console.error("Pull error:", error);
      notify(remoteErrorMessage("Pull", error), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handlePush() {
    try {
      setLoading(true);
      const token = await fetchGithubToken();
      await pushRemote("origin", undefined, token);
      notify("Push completed.", "success");
    } catch (error) {
      console.error("Push error:", error);
      notify(remoteErrorMessage("Push", error), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleForcePush() {
    closeMoreMenu();
    const branch = currentBranch || "this branch";
    if (
      !confirm(
        `Force push "${branch}"?\n\nThis replaces "${branch}" on GitHub with your local version. Any commits on GitHub that aren't in this project will be permanently deleted.`
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      const token = await fetchGithubToken();
      await pushRemote("origin", undefined, token, true);
      notify("Force push completed.", "success");
    } catch (error) {
      console.error("Force push error:", error);
      notify(remoteErrorMessage("Force push", error), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handlePushAsNewProject() {
    closeMoreMenu();
    const branch = currentBranch || "this branch";
    if (
      !confirm(
        `Push as a new project?\n\nYour current files become one new first commit on "${branch}" (the old history is dropped here), then replace "${branch}" on GitHub. Any commits on GitHub's "${branch}" will be permanently deleted.\n\nUse this to push cloned code to your own repository.`
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      await startFreshHistory(commitMessage.trim() || "Initial commit", { name: "Niket", email: "niket@example.com" });
      setCommitMessage("");
      const token = await fetchGithubToken();
      await pushRemote("origin", undefined, token, true);
      await refreshGit();
      notify("Pushed as a new project.", "success");
    } catch (error) {
      console.error("Push as new project error:", error);
      notify(remoteErrorMessage("Push as new project", error), "error");
      await refreshGit();
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckout(branch: string) {
    setBranchMenuOpen(false);

    try {
      setLoading(true);
      await checkoutBranch(branch);
      await refreshGit();
      await onRefreshExplorer?.();
      notify(`Switched to ${branch}.`, "success");
    } catch (error) {
      console.error("Checkout error:", error);
      notify(`Could not switch to ${branch}.`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateBranch() {
    const name = newBranchName.trim();
    if (!name) return;

    try {
      setCreatingBranch(true);
      await createBranch(name);
      await checkoutBranch(name);
      setNewBranchName("");
      setBranchMenuOpen(false);
      await refreshGit();
      notify(`Created ${name}. Push to publish it to origin.`, "success");
    } catch (error) {
      console.error("Create branch error:", error);
      notify(`Could not create branch "${name}".`, "error");
    } finally {
      setCreatingBranch(false);
    }
  }

  async function handleMerge(branch: string) {
    if (!confirm(`Merge "${branch}" into "${currentBranch}"?`)) return;

    try {
      setLoading(true);
      closeMoreMenu();
      const outcome = await mergeBranch(branch, { name: "Niket", email: "niket@example.com" });
      await refreshGit();
      await onRefreshExplorer?.();
      notify(
        outcome === "already-up-to-date"
          ? `${currentBranch} already has everything from ${branch}.`
          : `Merged ${branch} into ${currentBranch}. Push to publish it.`,
        "success"
      );
    } catch (error) {
      console.error("Merge error:", error);
      notify(error instanceof MergeBlockedError ? error.message : `Could not merge ${branch}.`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteBranch(branch: string) {
    if (!confirm(`Delete branch "${branch}"? This cannot be undone.`)) return;

    try {
      await deleteBranch(branch);
      await refreshGit();
      notify(`Deleted ${branch}.`, "success");
    } catch (error) {
      console.error("Delete branch error:", error);
      notify(`Could not delete ${branch}.`, "error");
    }
  }

  async function loadRemotes() {
    try {
      setRemotes(await getRemotes());
    } catch {
      setRemotes([]);
    }
  }

  async function handleAddRemote() {
    const name = newRemoteName.trim();
    const url = newRemoteUrl.trim();
    if (!name || !url) return;

    try {
      await addRemote(name, url);
      setNewRemoteName("");
      setNewRemoteUrl("");
      await loadRemotes();
      notify(`Added remote "${name}".`, "success");
    } catch (error) {
      console.error("Add remote error:", error);
      notify(`Could not add remote "${name}".`, "error");
    }
  }

  async function handleDeleteRemote(name: string) {
    if (!confirm(`Remove remote "${name}"?`)) return;

    try {
      await deleteRemote(name);
      await loadRemotes();
      notify(`Removed remote "${name}".`, "success");
    } catch (error) {
      console.error("Delete remote error:", error);
      notify(`Could not remove remote "${name}".`, "error");
    }
  }

  async function loadTags() {
    try {
      setTags(await getTags());
    } catch {
      setTags([]);
    }
  }

  async function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;

    try {
      await createTag(name);
      setNewTagName("");
      await loadTags();
      notify(`Created tag "${name}".`, "success");
    } catch (error) {
      console.error("Create tag error:", error);
      notify(`Could not create tag "${name}".`, "error");
    }
  }

  function openMoreView(view: MoreView) {
    setMoreView(view);
    if (view === "remotes") void loadRemotes();
    if (view === "tags") void loadTags();
  }

  function closeMoreMenu() {
    setMoreMenuOpen(false);
    setMoreView("root");
  }

  // statusMatrix rows are [filepath, HEAD, WORKDIR, STAGE].
  // A file is changed when WORKDIR differs from HEAD but hasn't been staged yet;
  // it's staged once STAGE no longer matches HEAD.
  const changedFiles = status.filter(([, head, workdir, stage]) => workdir !== head && stage === head);
  const stagedFiles = status.filter(([, head, , stage]) => stage !== head);
  // Every file that differs anywhere from the last commit (1/1/1 = unchanged).
  const changeCount = status.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1)).length;

  useEffect(() => {
    onChangeCount?.(changeCount);
  }, [changeCount, onChangeCount]);

  return (
    <aside className="flex h-full min-w-0 flex-col bg-[#0a0a0a] text-[#c9d1d9]">
      {githubPickerOpen && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
    <div className="w-[500px] max-h-[600px] overflow-auto rounded-lg border border-[#262626] bg-[#121212] p-4 shadow-2xl">
      
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#e6edf3]">
          Clone GitHub Repository
        </h2>

        <button
          type="button"
          onClick={() => setGithubPickerOpen(false)}
          className="rounded px-2 py-1 text-[#8b949e] hover:bg-[#262626] hover:text-white"
        >
          ✕
        </button>
      </div>

      <GitHubRepositories
        onCloned={async (repository) => {
          setGithubPickerOpen(false);
          notify(`Cloned ${repository.fullName}.`, "success");
          await refreshGit();
          await onRefreshExplorer?.();
        }}
      />
    </div>
  </div>
)}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#262626] px-3">
        <span className="text-[11px] font-semibold tracking-[0.12em]">SOURCE CONTROL</span>

        <div className="flex items-center gap-0.5 text-[#8b949e]">
          <button
            type="button"
            title="Refresh"
            onClick={refreshGit}
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {initialized === false ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-[#262626] bg-[#121212] text-[#8b949e]">
            <GitBranch size={18} />
          </span>
          <div>
            <p className="text-[13px] font-medium text-[#e6edf3]">No Git repository</p>
            <p className="mt-1 max-w-[210px] text-[11px] leading-5 text-[#6e7681]">
              Initialize a repository to track changes and commit your work.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={initializing}
              onClick={handleInitGit}
              className="flex h-8 items-center gap-2 rounded-md bg-white px-3.5 text-xs font-semibold text-black transition hover:bg-[#d4d4d4] disabled:opacity-50"
            >
              {initializing && <Loader2 size={13} className="animate-spin" />}
              Initialize Repository
            </button>
            <button
              type="button"
              disabled={initializing}
              onClick={handleClone}
              className="flex h-8 items-center gap-2 rounded-md border border-[#262626] px-3.5 text-xs font-semibold text-[#c9d1d9] transition hover:bg-[#1a1a1a] disabled:opacity-50"
            >
              Clone Repository
            </button>
          </div>
          {message && <p className="text-[11px] text-[#f85149]">{message}</p>}
        </div>
      ) : initialized === null ? (
        <div className="grid flex-1 place-items-center text-[11px] text-[#6e7681]">Checking repository…</div>
      ) : (
        <>
          <div className="relative flex items-center justify-between border-b border-[#262626] px-2 py-1.5">
            <button
              type="button"
              title="Branches"
              onClick={() => setBranchMenuOpen((open) => !open)}
              className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition hover:bg-[#1a1a1a]"
            >
              <GitBranch size={13} className="text-[#8b949e]" />
              <span className="font-medium text-[#e6edf3]">{currentBranch || "detached"}</span>
              <ChevronDown size={12} className="text-[#6e7681]" />
            </button>

            <div className="flex items-center gap-0.5 text-[#8b949e]">
              <button
                type="button"
                onClick={handlePull}
                disabled={loading}
                title="Pull"
                className="grid h-6 w-6 place-items-center rounded transition hover:bg-[#262626] hover:text-white disabled:opacity-40"
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                onClick={handlePush}
                disabled={loading}
                title="Push"
                className="grid h-6 w-6 place-items-center rounded transition hover:bg-[#262626] hover:text-white disabled:opacity-40"
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                onClick={handleFetch}
                disabled={loading}
                title="Fetch"
                className="grid h-6 w-6 place-items-center rounded transition hover:bg-[#262626] hover:text-white disabled:opacity-40"
              >
                <Upload size={13} />
              </button>
              <button
                type="button"
                onClick={() => setMoreMenuOpen((open) => !open)}
                title="More actions"
                className="grid h-6 w-6 place-items-center rounded transition hover:bg-[#262626] hover:text-white"
              >
                <MoreHorizontal size={14} />
              </button>
            </div>

            {branchMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setBranchMenuOpen(false)} />
                <div className="cf-dropdown absolute left-2 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-[#262626] bg-[#121212] shadow-xl shadow-black/40">
                  <div className="max-h-48 overflow-auto py-1">
                    {branches.length === 0 ? (
                      <div className="px-3 py-2 text-[11px] text-[#6e7681]">No branches yet</div>
                    ) : (
                      branches.map((branch) => {
                        const isCurrent = branch === currentBranch;

                        return (
                          <button
                            key={branch}
                            type="button"
                            disabled={loading || isCurrent}
                            onClick={() => handleCheckout(branch)}
                            title={isCurrent ? undefined : `Switch to ${branch}`}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-[#1a1a1a] disabled:cursor-default"
                          >
                            <span className="grid w-3.5 shrink-0 place-items-center">
                              {isCurrent && <Check size={12} className="text-white" />}
                            </span>
                            <span className={isCurrent ? "font-medium text-white" : "text-[#c9d1d9]"}>
                              {branch}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 border-t border-[#262626] p-2">
                    <input
                      value={newBranchName}
                      onChange={(event) => setNewBranchName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleCreateBranch();
                      }}
                      placeholder="New branch name"
                      className="h-7 min-w-0 flex-1 rounded border border-[#262626] bg-[#000000] px-2 text-xs text-[#e6edf3] outline-none placeholder:text-[#6e7681] focus:border-[#525252]"
                    />
                    <button
                      type="button"
                      title="Create branch"
                      disabled={creatingBranch || !newBranchName.trim()}
                      onClick={handleCreateBranch}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded bg-white text-black transition hover:bg-[#d4d4d4] disabled:opacity-40"
                    >
                      {creatingBranch ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {moreMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={closeMoreMenu} />
                <div className="cf-dropdown absolute right-2 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-[#262626] bg-[#121212] shadow-xl shadow-black/40">
                  {moreView === "root" && (
                    <div className="py-1">
                      <button
  type="button"
  disabled={githubConnected === true}
  onClick={() => {
    closeMoreMenu();
    handleConnectGithub();
  }}
  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a] disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
>
  <GitFork size={13} />
  {githubConnected ? (
    <span className="flex items-center gap-1.5">
      GitHub Connected
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fb950]" />
    </span>
  ) : (
    "Connect GitHub"
  )}
</button>

<button
  type="button"
  onClick={() => {
    closeMoreMenu();
    handleClone();
  }}
  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a]"
>
  <GitBranch size={13} />
  Clone GitHub Repository
</button>

<div className="my-1 h-px bg-[#262626]" />
                      <button
                        type="button"
                        disabled={changedFiles.length === 0}
                        onClick={() => {
                          closeMoreMenu();
                          handleStageAll();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a] disabled:opacity-40"
                      >
                        <Plus size={13} />
                        Stage All Changes
                      </button>
                      <button
                        type="button"
                        disabled={stagedFiles.length === 0}
                        onClick={() => {
                          closeMoreMenu();
                          handleUnstageAll();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a] disabled:opacity-40"
                      >
                        <Minus size={13} />
                        Unstage All Changes
                      </button>

                      <div className="my-1 h-px bg-[#262626]" />

                      <button
                        type="button"
                        disabled={loading}
                        onClick={handleForcePush}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#f85149] transition hover:bg-[#1a1a1a] disabled:opacity-40"
                      >
                        <ArrowUp size={13} />
                        Force Push
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={handlePushAsNewProject}
                        title="Push your current files as a fresh project with no previous history"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#f85149] transition hover:bg-[#1a1a1a] disabled:opacity-40"
                      >
                        <Upload size={13} />
                        Push as New Project
                      </button>
                      <div className="my-1 h-px bg-[#262626]" />
                      <button
                        type="button"
                        onClick={() => openMoreView("merge-branch")}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a]"
                      >
                        <span className="flex items-center gap-2">
                          <GitMerge size={13} />
                          Merge Branch
                        </span>
                        <ChevronRight size={13} className="text-[#6e7681]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openMoreView("delete-branch")}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a]"
                      >
                        <span className="flex items-center gap-2">
                          <Trash2 size={13} />
                          Delete Branch
                        </span>
                        <ChevronRight size={13} className="text-[#6e7681]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openMoreView("remotes")}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a]"
                      >
                        <span className="flex items-center gap-2">
                          <GitBranch size={13} />
                          Remotes
                        </span>
                        <ChevronRight size={13} className="text-[#6e7681]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openMoreView("tags")}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-[#c9d1d9] transition hover:bg-[#1a1a1a]"
                      >
                        <span className="flex items-center gap-2">
                          <Tag size={13} />
                          Tags
                        </span>
                        <ChevronRight size={13} className="text-[#6e7681]" />
                      </button>
                    </div>
                  )}

                  {moreView !== "root" && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setMoreView("root")}
                        className="flex w-full items-center gap-1.5 border-b border-[#262626] px-3 py-2 text-left text-[11px] font-semibold text-[#c9d1d9] hover:bg-[#1a1a1a]"
                      >
                        <ChevronLeft size={13} />
                        {moreView === "merge-branch" && `MERGE INTO ${currentBranch.toUpperCase()}`}
                        {moreView === "delete-branch" && "DELETE BRANCH"}
                        {moreView === "remotes" && "REMOTES"}
                        {moreView === "tags" && "TAGS"}
                      </button>

                      {moreView === "merge-branch" && (
                        <div className="max-h-48 overflow-auto py-1">
                          {branches.filter((b) => b !== currentBranch).length === 0 ? (
                            <div className="px-3 py-2 text-[11px] text-[#6e7681]">No other branches to merge</div>
                          ) : (
                            branches
                              .filter((branch) => branch !== currentBranch)
                              .map((branch) => (
                                <button
                                  key={branch}
                                  type="button"
                                  onClick={() => handleMerge(branch)}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#c9d1d9] hover:bg-[#1a1a1a]"
                                >
                                  <GitMerge size={13} className="shrink-0 text-[#8b949e]" />
                                  <span className="min-w-0 flex-1 truncate">{branch}</span>
                                </button>
                              ))
                          )}
                        </div>
                      )}

                      {moreView === "delete-branch" && (
                        <div className="max-h-48 overflow-auto py-1">
                          {branches.filter((b) => b !== currentBranch).length === 0 ? (
                            <div className="px-3 py-2 text-[11px] text-[#6e7681]">No other branches</div>
                          ) : (
                            branches
                              .filter((branch) => branch !== currentBranch)
                              .map((branch) => (
                                <div
                                  key={branch}
                                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[#1a1a1a]"
                                >
                                  <span className="min-w-0 flex-1 truncate text-xs text-[#c9d1d9]">{branch}</span>
                                  <button
                                    type="button"
                                    title={`Delete ${branch}`}
                                    onClick={() => handleDeleteBranch(branch)}
                                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#f85149] opacity-0 hover:bg-[#262626] group-hover:opacity-100"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ))
                          )}
                        </div>
                      )}

                      {moreView === "remotes" && (
                        <>
                          <div className="max-h-40 overflow-auto py-1">
                            {remotes.length === 0 ? (
                              <div className="px-3 py-2 text-[11px] text-[#6e7681]">No remotes configured</div>
                            ) : (
                              remotes.map((remote) => (
                                <div
                                  key={remote.remote}
                                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[#1a1a1a]"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs text-[#e6edf3]">{remote.remote}</p>
                                    <p className="truncate text-[10px] text-[#6e7681]">{remote.url}</p>
                                  </div>
                                  <button
                                    type="button"
                                    title={`Remove ${remote.remote}`}
                                    onClick={() => handleDeleteRemote(remote.remote)}
                                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#f85149] opacity-0 hover:bg-[#262626] group-hover:opacity-100"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 border-t border-[#262626] p-2">
                            <input
                              value={newRemoteName}
                              onChange={(event) => setNewRemoteName(event.target.value)}
                              placeholder="Name (e.g. origin)"
                              className="h-7 rounded border border-[#262626] bg-[#000000] px-2 text-xs text-[#e6edf3] outline-none placeholder:text-[#6e7681] focus:border-[#525252]"
                            />
                            <div className="flex items-center gap-1.5">
                              <input
                                value={newRemoteUrl}
                                onChange={(event) => setNewRemoteUrl(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") handleAddRemote();
                                }}
                                placeholder="Repository URL"
                                className="h-7 min-w-0 flex-1 rounded border border-[#262626] bg-[#000000] px-2 text-xs text-[#e6edf3] outline-none placeholder:text-[#6e7681] focus:border-[#525252]"
                              />
                              <button
                                type="button"
                                title="Add remote"
                                disabled={!newRemoteName.trim() || !newRemoteUrl.trim()}
                                onClick={handleAddRemote}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded bg-white text-black transition hover:bg-[#d4d4d4] disabled:opacity-40"
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                          </div>
                        </>
                      )}

                      {moreView === "tags" && (
                        <>
                          <div className="max-h-40 overflow-auto py-1">
                            {tags.length === 0 ? (
                              <div className="px-3 py-2 text-[11px] text-[#6e7681]">No tags yet</div>
                            ) : (
                              tags.map((tagName) => (
                                <div key={tagName} className="flex items-center gap-2 px-3 py-1.5">
                                  <Tag size={12} className="shrink-0 text-[#8b949e]" />
                                  <span className="truncate text-xs text-[#c9d1d9]">{tagName}</span>
                                </div>
                              ))
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 border-t border-[#262626] p-2">
                            <input
                              value={newTagName}
                              onChange={(event) => setNewTagName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") handleCreateTag();
                              }}
                              placeholder="New tag name"
                              className="h-7 min-w-0 flex-1 rounded border border-[#262626] bg-[#000000] px-2 text-xs text-[#e6edf3] outline-none placeholder:text-[#6e7681] focus:border-[#525252]"
                            />
                            <button
                              type="button"
                              title="Create tag"
                              disabled={!newTagName.trim()}
                              onClick={handleCreateTag}
                              className="grid h-7 w-7 shrink-0 place-items-center rounded bg-white text-black transition hover:bg-[#d4d4d4] disabled:opacity-40"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="border-b border-[#262626] p-3">
            <textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  handleCommit();
                }
              }}
              placeholder="Message (required)"
              className="h-16 w-full resize-none rounded border border-[#262626] bg-[#000000] p-2 text-xs text-[#e6edf3] outline-none placeholder:text-[#6e7681] focus:border-[#525252]"
            />
            <div className="mt-1 text-right text-[10px] text-[#484f58]">⌘ Enter to commit</div>

            <button
              type="button"
              disabled={loading || stagedFiles.length === 0}
              onClick={handleCommit}
              title={stagedFiles.length === 0 ? "Stage changes before committing" : "Commit"}
              className="flex h-7 w-full items-center justify-center gap-2 rounded bg-white text-xs font-medium text-black transition hover:bg-[#d4d4d4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Commit{stagedFiles.length > 0 ? ` (${stagedFiles.length})` : ""}
            </button>
          </div>

          {message && (
            <div
              className={`flex items-center gap-2 border-b border-[#262626] px-3 py-2 text-[11px] ${
                tone === "error" ? "text-[#f85149]" : tone === "success" ? "text-[#3fb950]" : "text-[#8b949e]"
              }`}
            >
              {tone === "error" ? (
                <AlertCircle size={12} className="shrink-0" />
              ) : tone === "success" ? (
                <CheckCircle2 size={12} className="shrink-0" />
              ) : null}
              <span className="truncate">{message}</span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            <section>
              <div className="flex h-8 items-center gap-1.5 px-3 text-[11px] font-semibold text-[#c9d1d9]">
                <span>CHANGES</span>
                {changedFiles.length > 0 && (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[#262626] px-1 text-[10px] font-medium text-[#c9d1d9]">
                    {changedFiles.length}
                  </span>
                )}
              </div>

              {changedFiles.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-[#6e7681]">No changes</div>
              ) : (
                changedFiles.map(([path, head, workdir]) => {
                  const badge = unstagedBadge(head, workdir);
                  const { name, dir } = splitPath(path);

                  return (
                    <div key={path} className="group flex h-7 items-center gap-2 px-3 hover:bg-[#1a1a1a]">
                      <span className="min-w-0 flex-1 truncate text-xs" title={path}>
                        <span className="text-[#e6edf3]">{name}</span>
                        {dir && <span className="ml-1.5 text-[#6e7681]">{dir}</span>}
                      </span>
                      {badge && (
                        <span className={`shrink-0 text-[11px] font-semibold ${badge.className}`}>
                          {badge.letter}
                        </span>
                      )}
                      <button
                        type="button"
                        title="Stage changes"
                        onClick={() => handleStage(path)}
                        className="grid h-5 w-5 shrink-0 place-items-center rounded opacity-0 hover:bg-[#262626] group-hover:opacity-100"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </section>

            <section className="border-t border-[#262626]">
              <div className="flex h-8 items-center gap-1.5 px-3 text-[11px] font-semibold text-[#c9d1d9]">
                <span>STAGED CHANGES</span>
                {stagedFiles.length > 0 && (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[#262626] px-1 text-[10px] font-medium text-[#c9d1d9]">
                    {stagedFiles.length}
                  </span>
                )}
              </div>

              {stagedFiles.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-[#6e7681]">No staged changes</div>
              ) : (
                stagedFiles.map(([path, head, , stage]) => {
                  const badge = stagedBadge(head, stage);
                  const { name, dir } = splitPath(path);

                  return (
                    <div key={path} className="group flex h-7 items-center gap-2 px-3 hover:bg-[#1a1a1a]">
                      <span className="min-w-0 flex-1 truncate text-xs" title={path}>
                        <span className="text-[#e6edf3]">{name}</span>
                        {dir && <span className="ml-1.5 text-[#6e7681]">{dir}</span>}
                      </span>
                      {badge && (
                        <span className={`shrink-0 text-[11px] font-semibold ${badge.className}`}>
                          {badge.letter}
                        </span>
                      )}
                      <button
                        type="button"
                        title="Unstage changes"
                        onClick={() => handleUnstage(path)}
                        className="grid h-5 w-5 shrink-0 place-items-center rounded opacity-0 hover:bg-[#262626] group-hover:opacity-100"
                      >
                        <Minus size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </section>

            <section className="border-t border-[#262626]">
              <div className="flex h-8 items-center gap-1.5 px-3 text-[11px] font-semibold text-[#c9d1d9]">
                <History size={13} />
                HISTORY
              </div>

              {history.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-[#6e7681]">No commits yet</div>
              ) : (
                history.map((entry) => {
                  const isExpanded = expandedCommit === entry.oid;
                  const changes = entry.commit.changes ?? [];

                  return (
                    <div key={entry.oid} className="border-b border-[#1a1a1a] last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setExpandedCommit(isExpanded ? null : entry.oid)}
                        className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-[#1a1a1a]"
                      >
                        <GitCommit size={13} className="mt-0.5 shrink-0 text-[#8b949e]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-[#e6edf3]">{entry.commit.message.split("\n")[0]}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#6e7681]">
                            <span className="font-mono text-[#9ca3af]">{entry.oid.slice(0, 7)}</span>
                            <span>{entry.commit.author.name}</span>
                            <span>·</span>
                            <span>{relativeTime(entry.commit.author.timestamp)}</span>
                          </p>
                        </div>
                        <ChevronDown
                          size={12}
                          className={`mt-1 shrink-0 text-[#6e7681] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>

                      {isExpanded && (
                        <div className="pb-2 pl-8 pr-3">
                          {changes.length === 0 ? (
                            <p className="py-1 text-[11px] text-[#6e7681]">No file changes recorded.</p>
                          ) : (
                            changes.map(([newOid, oldOid, filepath]) => {
                              const badge = changeBadge(newOid as string | null, oldOid as string | null);
                              const { name, dir } = splitPath(filepath as string);

                              return (
                                <button
                                  type="button"
                                  key={filepath as string}
                                  onClick={() => onOpenDiff?.(entry, filepath as string)}
                                  title="View diff"
                                  className="flex w-full items-center gap-2 rounded py-0.5 text-left hover:bg-[#1a1a1a]"
                                >
                                  <span className="min-w-0 flex-1 truncate text-[11px]">
                                    <span className="text-[#c9d1d9]">{name}</span>
                                    {dir && <span className="ml-1 text-[#6e7681]">{dir}</span>}
                                  </span>
                                  <span className={`shrink-0 text-[11px] font-semibold ${badge.className}`}>
                                    {badge.letter}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </section>
          </div>
        </>
      )}
    </aside>
  );
}
