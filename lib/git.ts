import git, { type ReadCommitResult } from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { getWebContainer } from "@/lib/webcontainer";
import { gitFs } from "@/lib/git-fs";

/** Our own git proxy route (app/api/git-proxy) — see cloneRepository. */
const GIT_CORS_PROXY = "/api/git-proxy";

export type GitLogEntry = ReadCommitResult;

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

// isomorphic-git's init() no-ops once .git/config exists, even if an earlier
// init was interrupted before HEAD got written, and other commands (statusMatrix)
// tolerate a missing HEAD by treating it as "no commits yet" — only commit()
// crashes on it. So this can't be left to run once behind an "Initialize" button;
// it has to self-heal on every read, before anything gets a chance to trip on it.
// Things no project should track: installed packages, build output, caches,
// logs, local secrets. Written to .git/info/exclude — git's own local-only
// ignore file (never committed or pushed) — so they're skipped in every repo,
// with or without a .gitignore. Like any ignore rule it only affects untracked
// files: a repo that deliberately commits e.g. dist/ keeps tracking it.
// Ignored folders aren't even walked, so `npm install` no longer makes
// status scan thousands of package files.
const BUILT_IN_IGNORES = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  ".vite/",
  ".turbo/",
  ".cache/",
  "coverage/",
  "*.log",
  ".DS_Store",
  ".env",
  ".env.*",
  "!.env.example",
  "!.env.sample",
];
const BUILT_IN_IGNORES_MARKER = "# CodeClik built-in ignores";

/** Default .gitignore for projects initialized here, so the rules travel with the repo. */
const DEFAULT_GITIGNORE = `# Dependencies
node_modules/

# Build output
dist/
build/
.next/
.vite/
coverage/

# Logs and OS files
*.log
.DS_Store

# Local secrets
.env
.env.*
!.env.example
`;

async function ensureBuiltInIgnores() {
  const excludePath = ".git/info/exclude";
  const current = await gitFs.promises.readFile(excludePath, "utf8").catch(() => "");
  const text = typeof current === "string" ? current : "";

  if (text.includes(BUILT_IN_IGNORES_MARKER)) return;

  await gitFs.promises.mkdir(".git/info").catch(() => {});
  const separator = text && !text.endsWith("\n") ? "\n" : "";
  await gitFs.promises.writeFile(
    excludePath,
    `${text}${separator}${BUILT_IN_IGNORES_MARKER}\n${BUILT_IN_IGNORES.join("\n")}\n`
  );
}

/** Returns false when the project has no repository (.git folder) yet. */
async function ensureHead(): Promise<boolean> {
  const gitdirExists = await gitFs.promises
    .stat(".git")
    .then(() => true)
    .catch(() => false);

  if (!gitdirExists) return false;

  // Every repo — new, cloned or agent-built — gets the built-in ignores.
  await ensureBuiltInIgnores();

  const head = await gitFs.promises.readFile(".git/HEAD", "utf8").catch(() => null);

  if (!head) {
    await gitFs.promises.writeFile(".git/HEAD", "ref: refs/heads/main\n");
  }

  return true;
}

/** Thrown by getGitStatus when the project has no .git folder yet. */
export class NoRepositoryError extends Error {
  constructor() {
    super("This project has no Git repository yet.");
    this.name = "NoRepositoryError";
  }
}

export async function initGit() {
  await getWebContainer();

  await git.init({
    fs: gitFs,
    dir: ".",
    defaultBranch: "main",
  });

  // Give new repos a standard .gitignore (never overwrite an existing one).
  const hasGitignore = await gitFs.promises
    .stat(".gitignore")
    .then(() => true)
    .catch(() => false);
  if (!hasGitignore) {
    await gitFs.promises.writeFile(".gitignore", DEFAULT_GITIGNORE);
  }

  await ensureHead();
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export async function getGitStatus() {
  await getWebContainer();

  // Without a .git folder, isomorphic-git doesn't fail — it reports every file
  // in the project as new, including node_modules (the ignore rules live in
  // .git, so they don't exist yet either). Treat it as "no repo" instead, so
  // Source Control offers Initialize rather than listing thousands of files.
  if (!(await ensureHead())) {
    throw new NoRepositoryError();
  }

  return await git.statusMatrix({
    fs: gitFs,
    dir: ".",
  });
}

/* -------------------------------------------------------------------------- */
/* Staging                                                                     */
/* -------------------------------------------------------------------------- */

export async function stageFile(path: string) {
  await getWebContainer();

  await git.add({
    fs: gitFs,
    dir: ".",
    filepath: path,
  });
}

export async function stageAll() {
  await getWebContainer();

  const status = await getGitStatus();

  // Only files whose working copy differs from what's staged — re-adding
  // unchanged files means re-hashing the whole repo for nothing.
  for (const [filepath, , workdir, stage] of status) {
    if (workdir === stage) continue;

    if (workdir === 0) {
      // Deleted on disk: git.add can't read it, so stage the deletion.
      await git.remove({ fs: gitFs, dir: ".", filepath });
    } else {
      await git.add({ fs: gitFs, dir: ".", filepath });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Unstaging                                                                   */
/* -------------------------------------------------------------------------- */

export async function unstageFile(path: string) {
  await getWebContainer();

  await git.resetIndex({
    fs: gitFs,
    dir: ".",
    filepath: path,
  });
}

export async function unstageAll() {
  await getWebContainer();

  const status = await getGitStatus();

  for (const [filepath] of status) {
    await git.resetIndex({
      fs: gitFs,
      dir: ".",
      filepath,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Commit                                                                      */
/* -------------------------------------------------------------------------- */

export async function commitChanges(
  message: string,
  author: {
    name: string;
    email: string;
  }
) {
  await getWebContainer();
  await ensureHead();

  return await git.commit({
    fs: gitFs,
    dir: ".",
    message,
    author,
  });
}

/* -------------------------------------------------------------------------- */
/* Log                                                                         */
/* -------------------------------------------------------------------------- */

export async function getGitLog(depth = 20) {
  await getWebContainer();

  return await git.log({
    fs: gitFs,
    dir: ".",
    depth,
    // Populates commit.changes as [newOid, oldOid, filepath] tuples so the
    // History panel can show what a commit touched without a separate diff call.
    includeChanges: true,
  });
}

// Reads a blob directly by its object id — the ids that show up in
// commit.changes tuples — and decodes it as text for diff viewing.
// A null oid means "this side of the diff doesn't exist" (added/deleted file).
export async function readBlobText(oid: string | null) {
  if (!oid) return "";

  await getWebContainer();

  const { blob } = await git.readBlob({
    fs: gitFs,
    dir: ".",
    oid,
  });

  return new TextDecoder().decode(blob);
}

/* -------------------------------------------------------------------------- */
/* Working-tree diffs & discard                                                */
/* -------------------------------------------------------------------------- */

/** Blob id of `filepath` in the index (staging area), or null if it isn't there. */
async function indexOid(filepath: string): Promise<string | null> {
  let oid: string | null = null;

  await git.walk({
    fs: gitFs,
    dir: ".",
    trees: [git.STAGE()],
    map: async (path, [entry]) => {
      if (path === ".") return true;
      if (path === filepath) {
        oid = entry ? await entry.oid() : null;
        return null;
      }
      // Only descend into folders on the way to the file.
      return filepath.startsWith(`${path}/`) ? true : null;
    },
  });

  return oid;
}

/** Blob id of `filepath` in the last commit, or null (new file / no commits). */
async function headOid(filepath: string): Promise<string | null> {
  try {
    const commitOid = await git.resolveRef({ fs: gitFs, dir: ".", ref: "HEAD" });
    const { oid } = await git.readBlob({ fs: gitFs, dir: ".", oid: commitOid, filepath });
    return oid;
  } catch {
    return null;
  }
}

async function writeBlobToWorkdir(filepath: string, oid: string) {
  const { blob } = await git.readBlob({ fs: gitFs, dir: ".", oid });
  const parent = filepath.split("/").slice(0, -1).join("/");
  if (parent) await gitFs.promises.mkdir(parent);
  await gitFs.promises.writeFile(filepath, blob);
}

/**
 * Before/after text for a file in Source Control, like VS Code:
 * - "unstaged" (Changes): staged version → file on disk ("Working Tree")
 * - "staged" (Staged Changes): last commit → staged version ("Index")
 */
export async function getWorkingDiff(
  filepath: string,
  kind: "unstaged" | "staged"
): Promise<{ original: string; modified: string }> {
  await getWebContainer();

  const staged = await indexOid(filepath);

  if (kind === "staged") {
    return {
      original: await readBlobText(await headOid(filepath)),
      modified: await readBlobText(staged),
    };
  }

  const onDisk = await gitFs.promises.readFile(filepath, "utf8").catch(() => "");
  return {
    original: await readBlobText(staged),
    modified: typeof onDisk === "string" ? onDisk : "",
  };
}

/**
 * Throws away a file's unstaged edits: restores the staged version, or
 * deletes the file if git has never seen it (untracked).
 */
export async function discardUnstaged(filepath: string) {
  await getWebContainer();

  const staged = await indexOid(filepath);
  if (staged) {
    await writeBlobToWorkdir(filepath, staged);
  } else {
    await gitFs.promises.unlink(filepath).catch(() => {});
  }
}

/**
 * Reverts a file completely to the last commit — staged and unstaged edits
 * both go. A file that's new since the last commit is removed.
 */
export async function discardStaged(filepath: string) {
  await getWebContainer();

  const committed = await headOid(filepath);
  if (committed) {
    await git.resetIndex({ fs: gitFs, dir: ".", filepath });
    await writeBlobToWorkdir(filepath, committed);
  } else {
    await git.remove({ fs: gitFs, dir: ".", filepath });
    await gitFs.promises.unlink(filepath).catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* Branches                                                                    */
/* -------------------------------------------------------------------------- */

export async function getBranches() {
  await getWebContainer();

  return await git.listBranches({
    fs: gitFs,
    dir: ".",
  });
}

export async function createBranch(branchName: string) {
  await getWebContainer();

  await git.branch({
    fs: gitFs,
    dir: ".",
    ref: branchName,
  });
}

export async function checkoutBranch(branchName: string) {
  await getWebContainer();

  await git.checkout({
    fs: gitFs,
    dir: ".",
    ref: branchName,
  });
}

export async function deleteBranch(branchName: string) {
  await getWebContainer();

  await git.deleteBranch({
    fs: gitFs,
    dir: ".",
    ref: branchName,
  });
}

/* -------------------------------------------------------------------------- */
/* Remote                                                                      */
/* -------------------------------------------------------------------------- */

export async function getRemotes() {
  await getWebContainer();

  return await git.listRemotes({
    fs: gitFs,
    dir: ".",
  });
}

export async function addRemote(
  name: string,
  url: string
) {
  await getWebContainer();

  await git.addRemote({
    fs: gitFs,
    dir: ".",
    remote: name,
    url,
  });
}

export async function deleteRemote(name: string) {
  await getWebContainer();

  await git.deleteRemote({
    fs: gitFs,
    dir: ".",
    remote: name,
  });
}

/* -------------------------------------------------------------------------- */
/* Fetch                                                                       */
/* -------------------------------------------------------------------------- */

export async function fetchRemote(
  remote = "origin",
  token?: string
) {
  await getWebContainer();

  return await git.fetch({
    fs: gitFs,
    http,
    dir: ".",
    remote,
    // Browsers can't call github.com directly (CORS), so go through our proxy.
    // Repos cloned here already have this saved in their git config, but
    // repos created here with a remote added by hand don't.
    corsProxy: GIT_CORS_PROXY,
    onAuth: token
      ? () => ({ username: "x-access-token", password: token })
      : undefined,
  });
}

/* -------------------------------------------------------------------------- */
/* Pull                                                                        */
/* -------------------------------------------------------------------------- */

export async function pullRemote(
  remote = "origin",
  ref?: string,
  token?: string,
  // Needed when the pull has to create a merge commit; without it isomorphic-git
  // fails with MissingNameError (nothing is configured in .git/config).
  author?: { name: string; email: string }
) {
  await getWebContainer();

  return await git.pull({
    fs: gitFs,
    http,
    dir: ".",
    remote,
    // Browsers can't call github.com directly (CORS), so go through our proxy.
    // Repos cloned here already have this saved in their git config, but
    // repos created here with a remote added by hand don't.
    corsProxy: GIT_CORS_PROXY,
    ref,
    singleBranch: true,
    author,
    onAuth: token
      ? () => ({ username: "x-access-token", password: token })
      : undefined,
  });
}

/* -------------------------------------------------------------------------- */
/* Push                                                                        */
/* -------------------------------------------------------------------------- */

export async function pushRemote(
  remote = "origin",
  ref?: string,
  token?: string,
  // Overwrite the remote branch even when it has commits this repo doesn't
  // (git push --force). Those remote commits are lost.
  force = false
) {
  await getWebContainer();

  // GitHub explains rejections (e.g. "shallow update not allowed", missing
  // permissions) as "remote:" progress messages, while the error itself only
  // says "failed". Collect them so the UI can show the real reason.
  const remoteMessages: string[] = [];

  try {
    return await git.push({
      fs: gitFs,
      http,
      dir: ".",
      remote,
      force,
      // Browsers can't call github.com directly (CORS), so go through our proxy.
      // Repos cloned here already have this saved in their git config, but
      // repos created here with a remote added by hand don't.
      corsProxy: GIT_CORS_PROXY,
      ref,
      onMessage: (message) => {
        remoteMessages.push(message);
      },
      onAuth: token
        ? () => ({ username: "x-access-token", password: token })
        : undefined,
    });
  } catch (error) {
    if (error && typeof error === "object" && remoteMessages.length > 0) {
      (error as { remoteMessage?: string }).remoteMessage = remoteMessages.join("").trim();
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Clone                                                                       */
/* -------------------------------------------------------------------------- */

export type CloneProgress = { phase: string; loaded: number; total: number };

export async function cloneRepository(
  url: string,
  token?: string,
  dir = ".",
  options?: { force?: boolean; onProgress?: (progress: CloneProgress) => void }
) {
  await getWebContainer();

  // Public repos need no credentials at all — only pass onAuth when we
  // actually have a token (private repos via the GitHub App installation).
  const onAuth = token
    ? () => ({
        username: "x-access-token",
        password: token,
      })
    : undefined;

  // Shallow, single-branch clone (latest commit only). Full history means
  // isomorphic-git — pure JS in the browser — downloads and indexes every
  // commit, which for an active repo takes minutes and trips the stall
  // watchdog before any files appear. Trade-off: a shallow project can't be
  // pushed to a *different* repository as-is (its oldest commit points at
  // parents that were never downloaded) — "Push as New Project"
  // (startFreshHistory) handles that.
  //
  // corsProxy points at our own /api/git-proxy route rather than the public
  // https://cors.isomorphic-git.org demo proxy: that's a free, shared,
  // rate-limited community service, and for anything but a tiny repo it's
  // slow or stalls outright — which is the other big reason clones looked
  // stuck. This value gets saved into the cloned repo's git config, so
  // subsequent fetch/pull/push on this remote reuse it automatically.
  const cloneOptions = {
    fs: gitFs,
    http,
    dir,
    url,
    singleBranch: true,
    depth: 1,
    noTags: true,
    onAuth,
    onProgress: options?.onProgress,
    corsProxy: GIT_CORS_PROXY,
  };

  if (!options?.force) {
    return await git.clone(cloneOptions);
  }

  // Cloning into a non-empty working directory (e.g. a workspace that already has
  // scratch files) throws CheckoutConflictError for any path both sides touch.
  // Fetch and set up refs/remote without writing files, then force the checkout
  // to overwrite just those conflicting paths instead of the whole workdir.
  await git.clone({
    ...cloneOptions,
    noCheckout: true,
  });

  const branch = await git.currentBranch({ fs: gitFs, dir, fullname: false });

  return await git.checkout({
    fs: gitFs,
    dir,
    ref: branch ?? undefined,
    force: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

export async function getTags() {
  await getWebContainer();

  return await git.listTags({
    fs: gitFs,
    dir: ".",
  });
}

export async function createTag(tag: string) {
  await getWebContainer();

  await git.annotatedTag({
    fs: gitFs,
    dir: ".",
    ref: tag,
    message: tag,
    tagger: {
      name: "CodeClik",
      email: "codeclik@example.com",
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Current branch                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Replaces the current branch's history with one new root commit holding the
 * current files — "take this code, start fresh". Needed to push a project to
 * a different repository when its history is incomplete (cloned shallow) or
 * unrelated to that repository. Afterwards normal commits and pushes work.
 */
export async function startFreshHistory(
  message: string,
  author: { name: string; email: string }
) {
  await getWebContainer();

  const branch = await getCurrentBranch();
  if (!branch) {
    throw new Error("Switch to a branch first.");
  }

  // Stage every file as it is on disk, including deletions.
  const matrix = await getGitStatus();
  for (const [filepath, , workdir] of matrix) {
    if (workdir === 0) {
      await git.remove({ fs: gitFs, dir: ".", filepath });
    } else {
      await git.add({ fs: gitFs, dir: ".", filepath });
    }
  }

  // parent: [] makes it a root commit. The ref must be the full name — a bare
  // "main" writes a stray .git/main file instead of moving the branch.
  return await git.commit({
    fs: gitFs,
    dir: ".",
    message,
    author,
    parent: [],
    ref: `refs/heads/${branch}`,
  });
}

export type MergeOutcome = "merged" | "fast-forward" | "already-up-to-date";

/** Thrown when a merge can't run or can't finish cleanly; message is user-facing. */
export class MergeBlockedError extends Error {}

/**
 * Merges `theirs` into the current branch, like `git merge <theirs>`.
 * Requires a clean working tree (as VS Code does), and leaves everything
 * untouched if there are conflicts — isomorphic-git can't pause a merge
 * mid-way for manual resolution the way the git CLI can.
 */
export async function mergeBranch(
  theirs: string,
  author: { name: string; email: string }
): Promise<MergeOutcome> {
  await getWebContainer();

  const ours = await getCurrentBranch();
  if (!ours) {
    throw new MergeBlockedError("Switch to a branch before merging.");
  }

  // statusMatrix rows: [file, HEAD, workdir, stage]; 1/1/1 means unchanged.
  const matrix = await getGitStatus();
  const dirty = matrix.some(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
  if (dirty) {
    throw new MergeBlockedError("Commit or discard your changes before merging.");
  }

  let result;
  try {
    result = await git.merge({
      fs: gitFs,
      dir: ".",
      ours,
      theirs,
      author,
      message: `Merge branch '${theirs}' into ${ours}`,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "MergeConflictError" || code === "MergeNotSupportedError") {
      throw new MergeBlockedError(
        `"${theirs}" and "${ours}" changed the same lines, so they can't be merged automatically. Nothing was changed.`
      );
    }
    throw error;
  }

  if (result.alreadyMerged) return "already-up-to-date";

  // merge() moves the branch to the new commit; check it out so the files
  // in the editor match. Safe: the working tree was clean.
  await git.checkout({ fs: gitFs, dir: ".", ref: ours, force: true });

  return result.fastForward ? "fast-forward" : "merged";
}

export async function getCurrentBranch() {
  await getWebContainer();

  return await git.currentBranch({
    fs: gitFs,
    dir: ".",
    fullname: false,
  });
}