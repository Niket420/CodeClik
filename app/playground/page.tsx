"use client";

import { useEffect, useState } from "react";
import { WebContainer } from "@webcontainer/api";
import {
  Blocks,
  Files,
  GitBranch,
  Globe2,
  Search,
  Settings2,
  TerminalSquare,
  X,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { getWebContainer } from "@/lib/webcontainer";
import { copyPath, pathExists, readDirectory, uniqueCopyName } from "@/lib/filesystem";
import { FileTreeNode } from "@/types/file-tree";
import IDEHeader from "@/components/ide/IDEHeader";
import FileExplorer from "@/components/ide/FileExplorer";
import Editor, { type DiffTab, type RevealTarget } from "@/components/ide/Editor";
import SearchPanel from "@/components/ide/SearchPanel";
import Preview from "@/components/ide/Preview";
import IDETerminal from "@/components/ide/Terminal";
import GitSourceControl from "@/components/ide/GitSourceControl";
import AIAssistant from "@/components/ide/AI/AIAssistant";
import { ToastProvider } from "@/components/ui/toast";
import SupportNotice from "@/components/ide/SupportNotice";
import BrandMark from "@/components/brand/BrandMark";
import { getWorkingDiff, readBlobText, type GitLogEntry } from "@/lib/git";

type OpenFile = {
  path: string;
  content: string;
  isDirty: boolean;
};

const activityItems = [
  { id: "explorer", label: "Explorer", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "source-control", label: "Source Control", icon: GitBranch },
  { id: "extensions", label: "Extensions", icon: Blocks },
];

export default function PlaygroundPage() {
  const [webcontainer, setWebcontainer] = useState<WebContainer | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [openedFiles, setOpenedFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [diffTabs, setDiffTabs] = useState<DiffTab[]>([]);
  const [activeDiffId, setActiveDiffId] = useState<string | null>(null);
  const [activeActivity, setActiveActivity] = useState("explorer");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  // Changed-file count from Source Control, shown as a badge like VS Code.
  const [gitChangeCount, setGitChangeCount] = useState(0);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedType, setSelectedType] = useState<"file" | "directory" | "">(
    "",
  );
  const [selectedCode, setSelectedCode] = useState("");
  const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null);
  const [searchFocusToken, setSearchFocusToken] = useState(0);

  async function refreshFileTree(wc: WebContainer) {
    const tree = await readDirectory(wc, ".");
    setFileTree(tree);
  }

  async function createFolder(path: string) {
    if (!webcontainer) return;

    await webcontainer.fs.mkdir(path, { recursive: true });
    await refreshFileTree(webcontainer);
  }

  async function createFile(path: string) {
    if (!webcontainer) return;

    await webcontainer.fs.writeFile(path, "");
    await refreshFileTree(webcontainer);
  }

  function closePathsUnder(path: string) {
    setOpenedFiles((previousFiles) =>
      previousFiles.filter(
        (file) => file.path !== path && !file.path.startsWith(`${path}/`),
      ),
    );
    setActiveFilePath((current) =>
      current === path || current.startsWith(`${path}/`) ? "" : current,
    );
  }

  async function deletePath(path: string) {
    if (!webcontainer) return;

    await webcontainer.fs.rm(path, { recursive: true, force: true });
    closePathsUnder(path);
    await refreshFileTree(webcontainer);
  }

  async function renamePath(oldPath: string, newPath: string) {
    if (!webcontainer) return;

    await webcontainer.fs.rename(oldPath, newPath);

    const remap = (path: string) =>
      path === oldPath
        ? newPath
        : path.startsWith(`${oldPath}/`)
          ? newPath + path.slice(oldPath.length)
          : path;

    setOpenedFiles((previousFiles) =>
      previousFiles.map((file) => ({ ...file, path: remap(file.path) })),
    );
    setActiveFilePath((current) => remap(current));
    await refreshFileTree(webcontainer);
  }

  async function copyWorkspacePath(src: string, dest: string) {
    if (!webcontainer) return;

    await copyPath(webcontainer, src, dest);
    await refreshFileTree(webcontainer);
  }

  // Files dragged in from the computer (Finder/desktop).
  async function uploadFiles(dir: string, files: File[]) {
    if (!webcontainer) return;

    for (const file of files) {
      const path = dir ? `${dir}/${file.name}` : file.name;
      if (
        (await pathExists(webcontainer, path)) &&
        !confirm(`"${file.name}" already exists. Replace it?`)
      ) {
        continue;
      }
      await webcontainer.fs.writeFile(path, new Uint8Array(await file.arrayBuffer()));
    }
    await refreshFileTree(webcontainer);
  }

  async function openFile(path: string) {
    if (!webcontainer) return;

    setActiveDiffId(null);

    const existing = openedFiles.find((file) => file.path === path);

    if (existing) {
      setActiveFilePath(path);
      return;
    }

    const content = await webcontainer.fs.readFile(path, "utf-8");

    setOpenedFiles((previousFiles) => [
      ...previousFiles,
      { path, content, isDirty: false },
    ]);
    setActiveFilePath(path);
  }

  async function openFileAt(path: string, line: number, column: number, length: number) {
    await openFile(path);
    setRevealTarget({ path, line, column, length, token: Date.now() });
  }

  async function openDiff(entry: GitLogEntry, filepath: string) {
    const change = entry.commit.changes?.find(
      ([, , changedPath]) => changedPath === filepath,
    );
    if (!change) return;

    const [newOid, oldOid] = change as [string | null, string | null, string];
    const id = `${entry.oid}:${filepath}`;

    if (diffTabs.some((diff) => diff.id === id)) {
      setActiveDiffId(id);
      return;
    }

    const [original, modified] = await Promise.all([
      readBlobText(oldOid),
      readBlobText(newOid),
    ]);

    setDiffTabs((previousDiffs) => [
      ...previousDiffs,
      {
        id,
        path: filepath,
        label: `${filepath.split("/").pop()} (${entry.oid.slice(0, 7)})`,
        original,
        modified,
      },
    ]);
    setActiveDiffId(id);
  }

  // Diff for a file in Source Control's Changes / Staged Changes, like VS Code's
  // "(Working Tree)" / "(Index)" views. Always re-read: these change as you edit.
  async function openWorkingDiff(filepath: string, kind: "unstaged" | "staged") {
    const id = `${kind}:${filepath}`;
    const { original, modified } = await getWorkingDiff(filepath, kind);
    const tab: DiffTab = {
      id,
      path: filepath,
      label: `${filepath.split("/").pop()} (${kind === "unstaged" ? "Working Tree" : "Index"})`,
      original,
      modified,
    };

    setDiffTabs((previousDiffs) =>
      previousDiffs.some((diff) => diff.id === id)
        ? previousDiffs.map((diff) => (diff.id === id ? tab : diff))
        : [...previousDiffs, tab],
    );
    setActiveDiffId(id);
  }

  // After a discard rewrote or deleted files on disk: reload their open tabs
  // (so a later save can't write the old text back) and drop stale diff tabs.
  async function syncDiscardedFiles(paths: string[]) {
    if (!webcontainer) return;
    const discarded = new Set(paths);

    const contents = new Map<string, string | null>();
    for (const path of paths) {
      contents.set(path, await webcontainer.fs.readFile(path, "utf-8").catch(() => null));
    }

    setOpenedFiles((previousFiles) =>
      previousFiles.flatMap((file) => {
        if (!discarded.has(file.path)) return [file];
        const content = contents.get(file.path);
        return content === null || content === undefined ? [] : [{ ...file, content, isDirty: false }];
      }),
    );
    setActiveFilePath((current) =>
      discarded.has(current) && contents.get(current) === null ? "" : current,
    );

    const isStale = (diff: DiffTab) =>
      [...discarded].some((path) => diff.id === `unstaged:${path}` || diff.id === `staged:${path}`);
    setDiffTabs((previousDiffs) => previousDiffs.filter((diff) => !isStale(diff)));
    setActiveDiffId((current) =>
      current && [...discarded].some((path) => current === `unstaged:${path}` || current === `staged:${path}`)
        ? null
        : current,
    );
  }

  function handleSelectActivity(id: string) {
    if (activeActivity === id && sidebarOpen) {
      setSidebarOpen(false);
      return;
    }

    setActiveActivity(id);
    setSidebarOpen(true);
    if (id === "search") setSearchFocusToken((token) => token + 1);
  }

  // ⌘⇧F / Ctrl+Shift+F opens Search, like VS Code.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      setActiveActivity("search");
      setSidebarOpen(true);
      setSearchFocusToken((token) => token + 1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    async function init() {
      const wc = await getWebContainer();
      wc.on("server-ready", (port, url) => {
        console.log(port, url);
        setPreviewUrl(url);
        // Show it right away — the page has to be loaded for its runtime
        // errors to reach the agent.
        setPreviewOpen(true);
      });
      // Load the tree before showing the IDE, so its first render already
      // reflects the workspace (SupportNotice treats that as the baseline).
      await refreshFileTree(wc);
      setWebcontainer(wc);
    }

    init();
  }, []);

  if (!webcontainer) {
    return (
      <ToastProvider>
        <main className="grid min-h-screen place-items-center bg-[#000000] text-[#c9d1d9]">
          <div className="flex flex-col items-center gap-4">
            <BrandMark size={48} />
            <div className="text-center">
              <p className="text-sm font-medium text-white">
                Preparing your workspace
              </p>
              <p className="mt-1 text-xs text-[#8b949e]">
                Booting the browser development environment…
              </p>
            </div>
            <span className="h-1 w-32 overflow-hidden rounded-full bg-[#1a1a1a]">
              <span className="block h-full w-2/3 animate-pulse rounded-full bg-white" />
            </span>
          </div>
        </main>
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      <SupportNotice fileTree={fileTree} />
      <main className="flex h-screen flex-col overflow-hidden bg-[#000000] font-sans text-[#e6edf3]">
        <header className="h-11 shrink-0 border-b border-[#262626]">
          <IDEHeader
            fileTree={fileTree}
            activityItems={activityItems}
            onSelectActivity={handleSelectActivity}
            onOpenFile={openFile}
            aiOpen={aiPanelOpen}
            onToggleAI={() => setAiPanelOpen((open) => !open)}
            terminalOpen={terminalOpen}
            onToggleTerminal={() => setTerminalOpen((open) => !open)}
            previewOpen={previewOpen}
            onTogglePreview={() => setPreviewOpen((open) => !open)}
          />
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="z-10 flex w-12 shrink-0 flex-col items-center border-r border-[#262626] bg-[#0a0a0a] py-3">
            <BrandMark size={32} className="mb-4" />

            <nav className="flex flex-1 flex-col items-center gap-1">
              {activityItems.map(({ id, label, icon: Icon }) => {
                const isActive = activeActivity === id && sidebarOpen;

                return (
                  <button
                    key={id}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={isActive}
                    onClick={() => handleSelectActivity(id)}
                    className={`relative grid h-10 w-10 place-items-center rounded-md transition-colors duration-150 ${
                      isActive
                        ? "bg-[#1a1a1a] text-white"
                        : "text-[#7d8590] hover:bg-[#1a1a1a] hover:text-[#c9d1d9]"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 h-6 w-0.5 rounded-r-full bg-white" />
                    )}
                    <Icon size={20} strokeWidth={1.8} />
                    {id === "source-control" && gitChangeCount > 0 && (
                      <span
                        aria-label={`${gitChangeCount} changed files`}
                        className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#1f6feb] px-1 text-[9.5px] font-semibold leading-none text-white"
                      >
                        {gitChangeCount > 99 ? "99+" : gitChangeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              title="Manage"
              aria-label="Manage"
              className="grid h-10 w-10 place-items-center rounded-md text-[#7d8590] transition hover:bg-[#1a1a1a] hover:text-[#c9d1d9]"
            >
              <Settings2 size={19} strokeWidth={1.8} />
            </button>
          </aside>

          <Group className="min-h-0 flex-1">
            {sidebarOpen && (
              <>
                <Panel
                  id="sidebar"
                  defaultSize={340}
                  minSize={260}
                  maxSize={480}
                >
                  <div className="relative h-full">
                    <div
                      className={`absolute inset-0 ${
                        activeActivity === "source-control" ? "block" : "hidden"
                      }`}
                    >
                      <GitSourceControl
                        onRefreshExplorer={async () => {
                          await refreshFileTree(webcontainer);
                        }}
                        onOpenDiff={openDiff}
                        onChangeCount={setGitChangeCount}
                        onOpenWorkingDiff={openWorkingDiff}
                        onFilesDiscarded={syncDiscardedFiles}
                      />
                    </div>

                    <div
                      className={`absolute inset-0 ${
                        activeActivity === "search" ? "block" : "hidden"
                      }`}
                    >
                      <SearchPanel
                        webcontainer={webcontainer}
                        fileTree={fileTree}
                        openedFiles={openedFiles}
                        focusToken={searchFocusToken}
                        onOpenMatch={openFileAt}
                        onUpdateOpenFile={(path, content) =>
                          setOpenedFiles((previousFiles) =>
                            previousFiles.map((file) =>
                              file.path === path ? { ...file, content, isDirty: true } : file,
                            ),
                          )
                        }
                        onFilesWritten={() => refreshFileTree(webcontainer)}
                      />
                    </div>

                    <div
                      className={`absolute inset-0 ${
                        activeActivity === "explorer" ? "block" : "hidden"
                      }`}
                    >
                      <FileExplorer
                        fileTree={fileTree}
                        activeFilePath={activeFilePath}
                        workdir={webcontainer.workdir}
                        onRefresh={() => refreshFileTree(webcontainer)}
                        onCreateFolder={createFolder}
                        onCreateFile={createFile}
                        onOpenFile={openFile}
                        onDeletePath={deletePath}
                        onRenamePath={renamePath}
                        onCopyPath={copyWorkspacePath}
                        pathExists={(path) => pathExists(webcontainer, path)}
                        uniqueCopyName={(dir, name) => uniqueCopyName(webcontainer, dir, name)}
                        onUploadFiles={uploadFiles}
                        selectedPath={selectedPath}
                        setSelectedPath={setSelectedPath}
                        selectedType={selectedType}
                        setSelectedType={setSelectedType}
                      />
                    </div>
                  </div>
                </Panel>

                <Separator className="w-px bg-[#262626] transition-colors hover:bg-[#404040]" />
              </>
            )}

            <Panel id="editor-column" minSize="30%">
              <Group orientation="vertical" className="h-full">
                <Panel id="editor">
                  <Editor
                    webcontainer={webcontainer}
                    openedFiles={openedFiles}
                    setOpenedFiles={setOpenedFiles}
                    activeFilePath={activeFilePath}
                    setActiveFilePath={setActiveFilePath}
                    diffTabs={diffTabs}
                    setDiffTabs={setDiffTabs}
                    activeDiffId={activeDiffId}
                    setActiveDiffId={setActiveDiffId}
                    onSelectionChange={setSelectedCode}
                    revealTarget={revealTarget}
                  />
                </Panel>

                {terminalOpen && (
                  <>
                    <Separator className="h-px bg-[#262626] transition-colors hover:bg-[#404040]" />

                    <Panel
                      id="terminal"
                      defaultSize="30%"
                      minSize="15%"
                      maxSize="75%"
                    >
                      <section className="cf-panel-bottom flex h-full flex-col bg-[#0a0a0a]">
                        <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#262626] bg-[#121212] px-2.5">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[#c9d1d9]">
                            <TerminalSquare
                              size={13}
                              className="text-[#8b949e]"
                            />
                            TERMINAL
                          </span>
                          <button
                            type="button"
                            title="Close Terminal"
                            aria-label="Close terminal"
                            onClick={() => setTerminalOpen(false)}
                            className="grid h-5 w-5 place-items-center rounded text-[#8b949e] transition hover:bg-[#262626] hover:text-white"
                          >
                            <X size={13} />
                          </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-hidden">
                          <IDETerminal
                            onFilesystemChange={() =>
                              refreshFileTree(webcontainer)
                            }
                          />
                        </div>
                      </section>
                    </Panel>
                  </>
                )}
              </Group>
            </Panel>

            {previewOpen && (
              <>
                <Separator className="w-px bg-[#262626] transition-colors hover:bg-[#404040]" />

                <Panel
                  id="preview"
                  defaultSize="40%"
                  minSize="25%"
                  maxSize="55%"
                >
                  <section className="cf-panel-right flex h-full flex-col border-l border-[#262626] bg-[#0a0a0a]">
                    <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#262626] bg-[#121212] px-2.5">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[#c9d1d9]">
                        <Globe2 size={13} className="text-[#8b949e]" />
                        PREVIEW
                      </span>
                      <button
                        type="button"
                        title="Close Preview"
                        aria-label="Close preview"
                        onClick={() => setPreviewOpen(false)}
                        className="grid h-5 w-5 place-items-center rounded text-[#8b949e] transition hover:bg-[#262626] hover:text-white"
                      >
                        <X size={13} />
                      </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden">
                      <Preview previewUrl={previewUrl} />
                    </div>
                  </section>
                </Panel>
              </>
            )}

            {aiPanelOpen && (
              <>
                <Separator className="w-px bg-[#262626] transition-colors hover:bg-[#404040]" />

                <Panel
                  id="ai-assistant"
                  defaultSize={380}
                  minSize={300}
                  maxSize={560}
                >
                  <AIAssistant
                    activeFilePath={activeFilePath}
                    webcontainer={webcontainer}
                    openedFiles={openedFiles}
                    fileTree={fileTree}
                    selectedCode={selectedCode}
                    onWorkspaceChange={() => refreshFileTree(webcontainer)}
                  />
                </Panel>
              </>
            )}
          </Group>
        </div>

        <footer className="flex h-6 shrink-0 items-center justify-between bg-[#f5f5f5] px-3 text-[10px] font-medium text-black">
          <span className="flex items-center gap-1.5">
            <GitBranch size={12} /> main
          </span>
          <span className="hidden sm:inline">No problems detected</span>
          <span>Spaces: 2 &nbsp; UTF-8</span>
        </footer>
      </main>
    </ToastProvider>
  );
}
