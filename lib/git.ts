import git, { type ReadCommitResult } from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { getWebContainer } from "@/lib/webcontainer";
import { gitFs } from "@/lib/git-fs";

export type GitLogEntry = ReadCommitResult;

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

// isomorphic-git's init() no-ops once .git/config exists, even if an earlier
// init was interrupted before HEAD got written, and other commands (statusMatrix)
// tolerate a missing HEAD by treating it as "no commits yet" — only commit()
// crashes on it. So this can't be left to run once behind an "Initialize" button;
// it has to self-heal on every read, before anything gets a chance to trip on it.
async function ensureHead() {
  const gitdirExists = await gitFs.promises
    .stat(".git")
    .then(() => true)
    .catch(() => false);

  if (!gitdirExists) return;

  const head = await gitFs.promises.readFile(".git/HEAD", "utf8").catch(() => null);

  if (!head) {
    await gitFs.promises.writeFile(".git/HEAD", "ref: refs/heads/main\n");
  }
}

export async function initGit() {
  await getWebContainer();

  await git.init({
    fs: gitFs,
    dir: ".",
    defaultBranch: "main",
  });

  await ensureHead();
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export async function getGitStatus() {
  await getWebContainer();
  await ensureHead();

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

  for (const [filepath] of status) {
    await git.add({
      fs: gitFs,
      dir: ".",
      filepath,
    });
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
  token?: string
) {
  await getWebContainer();

  return await git.pull({
    fs: gitFs,
    http,
    dir: ".",
    remote,
    ref,
    singleBranch: true,
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
  token?: string
) {
  await getWebContainer();

  return await git.push({
    fs: gitFs,
    http,
    dir: ".",
    remote,
    ref,
    onAuth: token
      ? () => ({ username: "x-access-token", password: token })
      : undefined,
  });
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

  // A full clone (every branch, full history) means isomorphic-git — a pure-JS
  // git implementation running inside a WebContainer — has to download the
  // entire object database. For an active repo that's a lot of data with the
  // UI showing nothing but a spinner, which just looks hung. Default to a
  // shallow, single-branch clone (what most browser-based IDEs do) so cloning
  // stays fast; other branches can still be fetched/checked out afterwards.
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
    corsProxy: "/api/git-proxy",
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
      name: "MightGuy",
      email: "mightguy@example.com",
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Current branch                                                             */
/* -------------------------------------------------------------------------- */

export async function getCurrentBranch() {
  await getWebContainer();

  return await git.currentBranch({
    fs: gitFs,
    dir: ".",
    fullname: false,
  });
}