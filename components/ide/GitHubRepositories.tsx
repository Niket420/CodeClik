"use client";

import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { cloneRepository, type CloneProgress } from "@/lib/git";
import { useToast } from "@/components/ui/toast";

type Repository = {
  id: number;
  name: string;
  fullName: string;
  cloneUrl: string;
};

type GitHubRepositoriesProps = {
  onCloned?: (repository: Repository) => void | Promise<void>;
};

// Accepts a full URL ("https://github.com/owner/repo", optionally with
// ".git"), an SSH remote ("git@github.com:owner/repo.git"), or the
// "owner/repo" shorthand, and normalizes it to a clonable https URL.
function normalizeRepoUrl(input: string): string {
  const trimmed = input.trim().replace(/\/$/, "");

  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`;
  }

  return trimmed;
}

function repoInfoFromUrl(url: string): Pick<Repository, "name" | "fullName"> {
  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");
  const segments = cleaned.split("/");

  return {
    name: segments[segments.length - 1] || cleaned,
    fullName: segments.slice(-2).join("/") || cleaned,
  };
}

function formatCloneProgress(progress: CloneProgress | null): string {
  if (!progress) return "Cloning…";

  const pct = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : null;
  return pct !== null ? `${progress.phase}… ${pct}%` : `${progress.phase}…`;
}

// GitHub's REST API sends CORS headers for public reads, so this can be
// called directly from the browser with no proxy — used to warn about large
// repos *before* starting a clone that will run entirely in-browser.
async function fetchGithubRepoSizeKb(url: string): Promise<number | null> {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;

  const [, owner, repo] = match;

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (!response.ok) return null;

    const data = await response.json();
    return typeof data.size === "number" ? data.size : null;
  } catch {
    return null;
  }
}

const LARGE_REPO_WARNING_KB = 50 * 1024; // 50 MB

function formatKb(sizeKb: number): string {
  return sizeKb >= 1024 ? `${Math.round(sizeKb / 1024)} MB` : `${sizeKb} KB`;
}

// isomorphic-git has no real cancellation (its `signal` option is explicitly
// unimplemented) so this can't stop the underlying transfer — but without
// this, a genuinely stuck clone leaves the UI spinning forever with no way
// out. Rather than a flat timeout (which would cut off a large repo that's
// still legitimately progressing), this only fires if no progress event
// arrives for a while — a real stall, not just "slow."
const STALL_TIMEOUT_MS = 45 * 1000;

class CloneStalledError extends Error {}

function withStallWatchdog<T>(
  run: (onProgress: (progress: CloneProgress) => void) => Promise<T>,
  onProgress: (progress: CloneProgress) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    function resetTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new CloneStalledError("No progress for a while — this looks stuck."));
      }, STALL_TIMEOUT_MS);
    }

    resetTimer();

    run((progress) => {
      resetTimer();
      onProgress(progress);
    }).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export default function GitHubRepositories({ onCloned }: GitHubRepositoriesProps) {
  const [urlInput, setUrlInput] = useState("");
  const [cloningUrl, setCloningUrl] = useState(false);

  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);

  const { push: pushToast } = useToast();

  async function handleCloneUrl(force = false) {
    const url = normalizeRepoUrl(urlInput);
    if (!url) return;

    const { name, fullName } = repoInfoFromUrl(url);

    if (!force) {
      const sizeKb = await fetchGithubRepoSizeKb(url);
      if (sizeKb !== null && sizeKb > LARGE_REPO_WARNING_KB) {
        const proceed = confirm(
          `"${fullName}" is about ${formatKb(sizeKb)}. Cloning runs entirely in the browser, so a repo this size can take several minutes (or hit browser memory limits). Continue anyway?`,
        );
        if (!proceed) return;
      }
    }

    try {
      setCloningUrl(true);

      // No GitHub App / installation token involved — this is a plain,
      // unauthenticated clone, exactly like `git clone <url>`, so it only
      // works for public repos.
      await withStallWatchdog(
        (onProgress) => cloneRepository(url, undefined, ".", { force, onProgress }),
        setCloneProgress,
      );

      pushToast({
        tone: "success",
        title: "Repository cloned",
        description: fullName,
      });

      setUrlInput("");
      await onCloned?.({ id: -1, name, fullName, cloneUrl: url });
    } catch (error) {
      if (error instanceof CloneStalledError) {
        console.error("Clone stalled:", fullName);
        pushToast({
          tone: "error",
          title: "Clone stalled",
          description: "No progress for a while, so this was stopped. Large or media-heavy repos can be too slow to clone in-browser — try again, or use a smaller repo.",
        });
        return;
      }

      const conflictFiles = (error as { data?: { filepaths?: string[] } })?.data?.filepaths;

      if (!force && conflictFiles && conflictFiles.length > 0) {
        const preview = conflictFiles.slice(0, 8).join(", ") + (conflictFiles.length > 8 ? ", …" : "");
        const shouldOverwrite = confirm(
          `Cloning "${fullName}" would overwrite local changes to:\n${preview}\n\nOverwrite these files and continue?`,
        );

        if (shouldOverwrite) {
          await handleCloneUrl(true);
          return;
        }

        pushToast({
          tone: "info",
          title: "Clone cancelled",
          description: "Local changes were kept.",
        });
        return;
      }

      console.error("Clone failed:", error);
      pushToast({
        tone: "error",
        title: "Clone failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not clone this repository. Make sure it's public and the URL is correct.",
      });
    } finally {
      setCloningUrl(false);
      setCloneProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-[#8b949e]">
          CLONE BY URL
        </h2>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Link2
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6e7681]"
            />
            <input
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && urlInput.trim() && !cloningUrl) {
                  void handleCloneUrl();
                }
              }}
              placeholder="https://github.com/owner/repo"
              spellCheck={false}
              autoComplete="off"
              className="h-8 w-full rounded border border-[#262626] bg-[#000000] pl-8 pr-2.5 text-xs text-[#e6edf3] outline-none placeholder:text-[#6e7681] focus:border-[#525252]"
            />
          </div>

          <button
            type="button"
            disabled={!urlInput.trim() || cloningUrl}
            onClick={() => handleCloneUrl()}
            className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-white px-3 text-[11px] font-semibold text-black transition hover:bg-[#d4d4d4] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cloningUrl && <Loader2 size={12} className="animate-spin" />}
            {cloningUrl ? formatCloneProgress(cloneProgress) : "Clone"}
          </button>
        </div>

        <p className="text-[10px] leading-4 text-[#6e7681]">
          Works for any public repository — no GitHub App access needed, just like{" "}
          <code className="text-[#8b949e]">git clone</code>.
        </p>
      </div>
    </div>
  );
}
