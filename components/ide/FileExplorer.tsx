"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Ellipsis,
  File,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Pencil,
  RefreshCw,
  Scissors,
  Trash2,
} from "lucide-react";
import { FileTreeNode } from "@/types/file-tree";

type FileExplorerProps = {
  fileTree: FileTreeNode[];
  activeFilePath: string;
  /** Absolute path of the workspace root, for "Copy Path". */
  workdir: string;
  onRefresh: () => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onCreateFile: (path: string) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
  onDeletePath: (path: string) => Promise<void>;
  /** Rename or move (moving is renaming into another folder). */
  onRenamePath: (oldPath: string, newPath: string) => Promise<void>;
  onCopyPath: (src: string, dest: string) => Promise<void>;
  pathExists: (path: string) => Promise<boolean>;
  uniqueCopyName: (dir: string, name: string) => Promise<string>;
  /** Files dropped in from the computer (Finder/desktop). */
  onUploadFiles: (dir: string, files: File[]) => Promise<void>;
  selectedPath: string;
  setSelectedPath: React.Dispatch<React.SetStateAction<string>>;
  selectedType: "" | "file" | "directory";
  setSelectedType: React.Dispatch<
    React.SetStateAction<"" | "file" | "directory">
  >;
};

type Clipboard = { path: string; mode: "copy" | "cut" };

type TreeActions = {
  activeFilePath: string;
  selectedPath: string;
  onOpenFile: (path: string) => Promise<void>;
  select: (node: FileTreeNode) => void;
  renamingPath: string;
  renameValue: string;
  setRenameValue: (value: string) => void;
  commitRename: () => void;
  cancelRename: () => void;
  openContextMenu: (event: React.MouseEvent, node: FileTreeNode) => void;
  creating: Creating | null;
  setCreateValue: (value: string) => void;
  commitCreate: () => void;
  cancelCreate: () => void;
  cutPath: string;
  // Drag & drop
  dropTarget: string | null;
  startDrag: (event: React.DragEvent, node: FileTreeNode) => void;
  endDrag: () => void;
  dragOver: (event: React.DragEvent, dir: string) => boolean;
  drop: (event: React.DragEvent, dir: string) => void;
};

/** An in-progress "New File"/"New Folder" — an inline input row in the tree. */
type Creating = { dir: string; type: "file" | "directory"; value: string };

const TreeContext = createContext<TreeActions | null>(null);

const DRAG_TYPE = "application/x-codeclik-path";
// Hovering a closed folder this long while dragging opens it, like VS Code.
const AUTO_EXPAND_MS = 600;

function fileColor(name: string) {
  if (/\.(tsx?|jsx?)$/i.test(name)) return "text-[#4fc1ff]";
  if (/\.css$/i.test(name)) return "text-[#c586c0]";
  if (/\.json$/i.test(name)) return "text-[#e3b341]";
  return "text-[#8b949e]";
}

function parentDir(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function baseName(path: string) {
  return path.split("/").pop() ?? path;
}

function joinPath(dir: string, name: string) {
  return dir ? `${dir}/${name}` : name;
}

/** True when `dir` is `path` itself or inside it (a folder can't move into itself). */
function isSelfOrInside(dir: string, path: string) {
  return dir === path || dir.startsWith(`${path}/`);
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";
const alt = isMac ? "⌥" : "Alt+";
const shift = isMac ? "⇧" : "Shift+";

function CreateRow({ level }: { level: number }) {
  const ctx = useContext(TreeContext)!;
  if (!ctx.creating) return null;
  const isFolder = ctx.creating.type === "directory";

  return (
    <div className="flex h-7 items-center gap-1.5 px-2" style={{ paddingLeft: `${level * 14 + 8}px` }}>
      {isFolder ? (
        <>
          <ChevronRight size={14} className="shrink-0 text-[#8b949e]" />
          <Folder size={15} className="shrink-0 text-[#e3b341]" />
        </>
      ) : (
        <>
          <span className="w-[14px] shrink-0" />
          <File size={15} className={`shrink-0 ${fileColor(ctx.creating.value)}`} />
        </>
      )}
      <input
        autoFocus
        value={ctx.creating.value}
        placeholder={isFolder ? "Folder name" : "File name"}
        onChange={(event) => ctx.setCreateValue(event.target.value)}
        onBlur={ctx.commitCreate}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            ctx.commitCreate();
          }
          if (event.key === "Escape") ctx.cancelCreate();
        }}
        spellCheck={false}
        className="min-w-0 flex-1 rounded border border-[#4b5563] bg-[#000000] px-1 text-[13px] text-white outline-none placeholder:text-[#6e7681]"
      />
    </div>
  );
}

function TreeNode({ node, level }: { node: FileTreeNode; level: number }) {
  const [expanded, setExpanded] = useState(true);
  const ctx = useContext(TreeContext)!;
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirectory = node.type === "directory";
  const isActive = !isDirectory && node.path === ctx.activeFilePath;
  const isSelected = node.path === ctx.selectedPath;
  const isRenaming = ctx.renamingPath === node.path;
  const isCreatingHere = isDirectory && ctx.creating?.dir === node.path;
  const isCut = ctx.cutPath !== "" && isSelfOrInside(node.path, ctx.cutPath);
  // The whole folder block lights up while something is dragged over it.
  const isDropTarget = isDirectory && ctx.dropTarget === node.path;
  // Dropping on a file means "into the folder this file is in".
  const dropDir = isDirectory ? node.path : parentDir(node.path);

  function clearExpandTimer() {
    if (expandTimer.current) clearTimeout(expandTimer.current);
    expandTimer.current = null;
  }

  useEffect(() => clearExpandTimer, []);

  if (node.name === "node_modules") return null;

  return (
    <div className={isDropTarget ? "bg-[#1f6feb]/15 outline outline-1 -outline-offset-1 outline-[#1f6feb]/60" : ""}>
      <div
        role="button"
        tabIndex={0}
        draggable={!isRenaming}
        onDragStart={(event) => ctx.startDrag(event, node)}
        onDragEnd={ctx.endDrag}
        onDragOver={(event) => {
          const accepted = ctx.dragOver(event, dropDir);
          if (accepted && isDirectory && !expanded && !expandTimer.current) {
            expandTimer.current = setTimeout(() => {
              setExpanded(true);
              expandTimer.current = null;
            }, AUTO_EXPAND_MS);
          }
        }}
        onDragLeave={clearExpandTimer}
        onDrop={(event) => {
          clearExpandTimer();
          ctx.drop(event, dropDir);
        }}
        onContextMenu={(event) => ctx.openContextMenu(event, node)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.currentTarget.click();
        }}
        className={`flex h-7 w-full cursor-pointer items-center gap-1.5 px-2 text-left text-[13px] outline-none transition ${
          isActive
            ? "bg-white/10 text-[#f0f6fc]"
            : isSelected
              ? "bg-[#1a1a1a] text-[#e6edf3]"
              : "text-[#b1bac4] hover:bg-[#1a1a1a] hover:text-[#e6edf3]"
        } ${isCut ? "opacity-50" : ""} focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#525252]`}
        style={{ paddingLeft: `${level * 14 + 8}px` }}
        onClick={async () => {
          if (isRenaming) return;
          ctx.select(node);
          if (isDirectory) {
            setExpanded((isCurrentlyExpanded) => !isCurrentlyExpanded);
            return;
          }
          await ctx.onOpenFile(node.path);
        }}
      >
        {isDirectory ? (
          expanded ? (
            <ChevronDown size={14} className="shrink-0 text-[#8b949e]" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-[#8b949e]" />
          )
        ) : (
          <span className="w-[14px] shrink-0" />
        )}

        {isDirectory ? (
          expanded ? (
            <FolderOpen size={15} className="shrink-0 text-[#e3b341]" />
          ) : (
            <Folder size={15} className="shrink-0 text-[#e3b341]" />
          )
        ) : (
          <File size={15} className={`shrink-0 ${fileColor(node.name)}`} />
        )}

        {isRenaming ? (
          <input
            autoFocus
            value={ctx.renameValue}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => ctx.setRenameValue(event.target.value)}
            onBlur={ctx.commitRename}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                ctx.commitRename();
              }
              if (event.key === "Escape") ctx.cancelRename();
            }}
            className="min-w-0 flex-1 rounded border border-[#4b5563] bg-[#000000] px-1 text-[13px] text-white outline-none"
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </div>

      {isDirectory && (expanded || isCreatingHere) && (
        <>
          {isCreatingHere && <CreateRow level={level + 1} />}
          {node.children?.map((child) => (
            <TreeNode key={child.path} node={child} level={level + 1} />
          ))}
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
  danger,
  disabled,
}: {
  icon: typeof Pencil;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[#1a1a1a] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
        danger ? "text-[#ff7b72]" : "text-[#c9d1d9]"
      }`}
    >
      <Icon size={13} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[11px] text-[#6e7681]">{shortcut}</span>}
    </button>
  );
}

const Divider = () => <div className="my-1 h-px bg-[#262626]" />;

type MenuState = { x: number; y: number; node: FileTreeNode | null };

export default function FileExplorer({
  fileTree,
  activeFilePath,
  workdir,
  onRefresh,
  onCreateFolder,
  onCreateFile,
  onOpenFile,
  onDeletePath,
  onRenamePath,
  onCopyPath,
  pathExists,
  uniqueCopyName,
  onUploadFiles,
  selectedPath,
  setSelectedPath,
  selectedType,
  setSelectedType,
}: FileExplorerProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  // Folder being dragged over ("" = workspace root), or null when not dragging.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  // Set once a create is committed or cancelled, so the blur that follows
  // Enter/Escape (when the input unmounts) can't run it a second time.
  const createSettled = useRef(true);

  function select(node: FileTreeNode | { path: string; type: "file" | "directory" }) {
    setSelectedPath(node.path);
    setSelectedType(node.type);
  }

  function resolveDir(node?: FileTreeNode | null) {
    if (node) return node.type === "directory" ? node.path : parentDir(node.path);
    if (node === null) return "";
    if (selectedType === "directory") return selectedPath;
    if (selectedType === "file") return parentDir(selectedPath);
    return "";
  }

  function handleCreateFile(node?: FileTreeNode | null) {
    setRenaming(null);
    createSettled.current = false;
    setCreating({ dir: resolveDir(node), type: "file", value: "" });
  }

  function handleCreateFolder(node?: FileTreeNode | null) {
    setRenaming(null);
    createSettled.current = false;
    setCreating({ dir: resolveDir(node), type: "directory", value: "" });
  }

  async function commitCreate() {
    if (!creating || createSettled.current) return;
    createSettled.current = true;
    const { dir, type, value } = creating;
    setCreating(null);
    const name = value.trim();
    if (!name) return;
    const path = joinPath(dir, name);
    if (type === "file") await onCreateFile(path);
    else await onCreateFolder(path);
  }

  async function commitRename() {
    if (!renaming) return;
    const { path, value } = renaming;
    setRenaming(null);
    const trimmed = value.trim();
    if (!trimmed || trimmed === baseName(path)) return;
    await onRenamePath(path, joinPath(parentDir(path), trimmed));
  }

  async function handleDelete(path: string) {
    setMenu(null);
    if (!confirm(`Delete "${baseName(path)}"? This cannot be undone.`)) return;
    await onDeletePath(path);
    if (clipboard && isSelfOrInside(clipboard.path, path)) setClipboard(null);
  }

  /**
   * Moves (or copies) `src` into folder `dir`. Same rules as VS Code:
   * copying into the same folder makes "name copy", moving onto an
   * existing name asks before replacing it.
   */
  async function transfer(src: string, dir: string, mode: "copy" | "move") {
    // A folder can't go inside itself (a copy would recurse forever).
    if (isSelfOrInside(dir, src)) {
      alert(`Can't put "${baseName(src)}" inside itself.`);
      return;
    }
    const type = findNode(src)?.type ?? "file";

    const sameFolder = parentDir(src) === dir;
    if (mode === "move" && sameFolder) return;

    const name = mode === "copy" && sameFolder ? await uniqueCopyName(dir, baseName(src)) : baseName(src);
    const dest = joinPath(dir, name);

    if (await pathExists(dest)) {
      if (!confirm(`"${name}" already exists in ${dir || "the workspace"}. Replace it?`)) return;
      await onDeletePath(dest);
    }

    try {
      if (mode === "copy") await onCopyPath(src, dest);
      else await onRenamePath(src, dest);
    } catch (error) {
      console.error(`${mode} failed:`, error);
      alert(`Could not ${mode} "${baseName(src)}".`);
      return;
    }

    select({ path: dest, type });
  }

  function findNode(path: string, nodes: FileTreeNode[] = fileTree): FileTreeNode | undefined {
    for (const node of nodes) {
      if (node.path === path) return node;
      const hit = node.children && findNode(path, node.children);
      if (hit) return hit;
    }
  }

  async function paste(target?: FileTreeNode | null) {
    setMenu(null);
    if (!clipboard) return;
    const dir = resolveDir(target);
    await transfer(clipboard.path, dir, clipboard.mode === "cut" ? "move" : "copy");
    // A cut item can only be pasted once; a copied one any number of times.
    if (clipboard.mode === "cut") setClipboard(null);
  }

  async function duplicate(path: string) {
    setMenu(null);
    await transfer(path, parentDir(path), "copy");
  }

  async function copyText(text: string) {
    setMenu(null);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be blocked (permissions/insecure context) — fall back.
      window.prompt("Copy to clipboard:", text);
    }
  }

  const absolutePath = (path: string) => (path ? `${workdir.replace(/\/$/, "")}/${path}` : workdir);

  /* ------------------------------ Drag & drop ------------------------------ */

  function startDrag(event: React.DragEvent, node: FileTreeNode) {
    event.stopPropagation();
    event.dataTransfer.setData(DRAG_TYPE, node.path);
    event.dataTransfer.setData("text/plain", node.path);
    event.dataTransfer.effectAllowed = "copyMove";
    setDraggingPath(node.path);
    select(node);
  }

  function endDrag() {
    setDraggingPath(null);
    setDropTarget(null);
  }

  /** Called on dragover; returns whether `dir` accepts the drop. */
  function dragOver(event: React.DragEvent, dir: string) {
    event.stopPropagation();
    const fromComputer = event.dataTransfer.types.includes("Files");

    if (!fromComputer) {
      // Only our own tree items (not random text) can be dropped.
      if (!draggingPath || !event.dataTransfer.types.includes(DRAG_TYPE)) return false;
      if (isSelfOrInside(dir, draggingPath)) {
        setDropTarget(null);
        return false;
      }
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = fromComputer || event.altKey ? "copy" : "move";
    setDropTarget(dir);
    return true;
  }

  function drop(event: React.DragEvent, dir: string) {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    const src = event.dataTransfer.getData(DRAG_TYPE);
    endDrag();

    if (files.length > 0 && !src) {
      void onUploadFiles(dir, files);
      return;
    }
    if (src) void transfer(src, dir, event.altKey ? "copy" : "move");
  }

  /* ------------------------------- Keyboard -------------------------------- */

  function handleTreeKeyDown(event: React.KeyboardEvent) {
    // Typing in the rename/new-file box isn't a shortcut.
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    if (!selectedPath) return;

    const cmd = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const node = { path: selectedPath, type: selectedType || "file" } as FileTreeNode;

    if (event.key === "F2") {
      event.preventDefault();
      setRenaming({ path: selectedPath, value: baseName(selectedPath) });
    } else if (event.key === "Delete" || (cmd && event.key === "Backspace")) {
      event.preventDefault();
      void handleDelete(selectedPath);
    } else if (cmd && event.altKey && key === "c") {
      event.preventDefault();
      void copyText(event.shiftKey ? selectedPath : absolutePath(selectedPath));
    } else if (cmd && key === "c") {
      event.preventDefault();
      setClipboard({ path: selectedPath, mode: "copy" });
    } else if (cmd && key === "x") {
      event.preventDefault();
      setClipboard({ path: selectedPath, mode: "cut" });
    } else if (cmd && key === "v") {
      event.preventDefault();
      void paste(node);
    } else if (event.key === "Escape" && clipboard?.mode === "cut") {
      setClipboard(null);
    }
  }

  const treeActions: TreeActions = {
    activeFilePath,
    selectedPath,
    onOpenFile,
    select,
    renamingPath: renaming?.path ?? "",
    renameValue: renaming?.value ?? "",
    setRenameValue: (value) => setRenaming((current) => (current ? { ...current, value } : current)),
    commitRename,
    cancelRename: () => setRenaming(null),
    creating,
    setCreateValue: (value) => setCreating((current) => (current ? { ...current, value } : current)),
    commitCreate,
    cancelCreate: () => {
      createSettled.current = true;
      setCreating(null);
    },
    cutPath: clipboard?.mode === "cut" ? clipboard.path : "",
    dropTarget,
    startDrag,
    endDrag,
    dragOver,
    drop,
    openContextMenu: (event, node) => {
      event.preventDefault();
      event.stopPropagation();
      select(node);
      openMenuAt(event, node);
    },
  };

  function openMenuAt(event: React.MouseEvent, node: FileTreeNode | null) {
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 250),
      y: Math.min(event.clientY, window.innerHeight - (node ? 360 : 140)),
      node,
    });
  }

  const menuNode = menu?.node ?? null;
  const menuIsFolder = !menuNode || menuNode.type === "directory";

  return (
    <aside className="flex h-full min-w-0 flex-col bg-[#0a0a0a]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#262626] px-3">
        <span className="text-[11px] font-semibold tracking-[0.12em] text-[#c9d1d9]">
          EXPLORER
        </span>
        <div className="flex items-center gap-0.5 text-[#8b949e]">
          <button
            type="button"
            title="New file"
            aria-label="New file"
            onClick={() => handleCreateFile()}
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <FilePlus2 size={15} />
          </button>
          <button
            type="button"
            title="New folder"
            aria-label="New folder"
            onClick={() => handleCreateFolder()}
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <FolderPlus size={15} />
          </button>
          <button
            type="button"
            title="Refresh explorer"
            aria-label="Refresh explorer"
            onClick={onRefresh}
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            title="More actions"
            aria-label="More actions"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: Math.min(rect.left, window.innerWidth - 250), y: rect.bottom + 4, node: null });
            }}
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <Ellipsis size={15} />
          </button>
        </div>
      </div>

      {/* Dropping on the WORKSPACE header puts things at the top level. */}
      <div
        onDragOver={(event) => dragOver(event, "")}
        onDrop={(event) => drop(event, "")}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenuAt(event, null);
        }}
        className="flex h-8 shrink-0 items-center gap-1.5 border-b border-[#262626] px-3 text-[11px] font-medium text-[#c9d1d9]"
      >
        <ChevronDown size={14} className="text-[#8b949e]" />
        <FolderOpen size={14} className="text-[#e3b341]" />
        WORKSPACE
      </div>

      <div
        ref={treeRef}
        onKeyDown={handleTreeKeyDown}
        // Empty space below the files is the workspace root.
        onDragOver={(event) => dragOver(event, "")}
        onDrop={(event) => drop(event, "")}
        onDragLeave={(event) => {
          // Only when the pointer leaves the tree entirely (not moving between rows).
          if (!treeRef.current?.contains(event.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenuAt(event, null);
        }}
        className={`min-h-0 flex-1 overflow-auto py-1 ${
          dropTarget === "" ? "bg-[#1f6feb]/10 outline outline-1 -outline-offset-1 outline-[#1f6feb]/60" : ""
        }`}
      >
        {fileTree.length > 0 || creating ? (
          <TreeContext.Provider value={treeActions}>
            {creating?.dir === "" && <CreateRow level={0} />}
            {fileTree.map((node) => (
              <TreeNode key={node.path} node={node} level={0} />
            ))}
          </TreeContext.Provider>
        ) : (
          <div className="flex h-full min-h-44 flex-col items-center justify-center px-5 text-center">
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-[#262626] bg-[#121212] text-[#4fc1ff]">
              <FileCode2 size={18} />
            </span>
            <p className="mt-3 text-xs font-medium text-[#c9d1d9]">
              Your workspace is empty
            </p>
            <p className="mt-1 text-[11px] leading-5 text-[#6e7681]">
              Create a file or folder, or drop files here from your computer.
            </p>
          </div>
        )}
      </div>

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 w-60 overflow-hidden rounded-md border border-[#262626] bg-[#121212] py-1 shadow-xl shadow-black/40"
            style={{ top: menu.y, left: menu.x }}
          >
            {menuIsFolder && (
              <>
                <MenuItem
                  icon={FilePlus2}
                  label="New File…"
                  onClick={() => {
                    setMenu(null);
                    handleCreateFile(menuNode);
                  }}
                />
                <MenuItem
                  icon={FolderPlus}
                  label="New Folder…"
                  onClick={() => {
                    setMenu(null);
                    handleCreateFolder(menuNode);
                  }}
                />
                <Divider />
              </>
            )}

            {menuNode && (
              <>
                <MenuItem
                  icon={Scissors}
                  label="Cut"
                  shortcut={`${mod}X`}
                  onClick={() => {
                    setClipboard({ path: menuNode.path, mode: "cut" });
                    setMenu(null);
                  }}
                />
                <MenuItem
                  icon={Copy}
                  label="Copy"
                  shortcut={`${mod}C`}
                  onClick={() => {
                    setClipboard({ path: menuNode.path, mode: "copy" });
                    setMenu(null);
                  }}
                />
              </>
            )}
            <MenuItem
              icon={ClipboardPaste}
              label={clipboard ? `Paste "${baseName(clipboard.path)}"` : "Paste"}
              shortcut={`${mod}V`}
              disabled={!clipboard}
              onClick={() => void paste(menuNode)}
            />
            {menuNode && (
              <MenuItem icon={CopyPlus} label="Duplicate" onClick={() => void duplicate(menuNode.path)} />
            )}

            <Divider />
            <MenuItem
              icon={Link2}
              label="Copy Path"
              shortcut={`${alt}${mod}C`}
              onClick={() => void copyText(absolutePath(menuNode?.path ?? ""))}
            />
            {menuNode && (
              <MenuItem
                icon={Link2}
                label="Copy Relative Path"
                shortcut={`${shift}${alt}${mod}C`}
                onClick={() => void copyText(menuNode.path)}
              />
            )}

            {menuNode && (
              <>
                <Divider />
                <MenuItem
                  icon={Pencil}
                  label="Rename…"
                  shortcut="F2"
                  onClick={() => {
                    setRenaming({ path: menuNode.path, value: menuNode.name });
                    setMenu(null);
                  }}
                />
                <MenuItem
                  icon={Trash2}
                  label="Delete"
                  shortcut={isMac ? "⌘⌫" : "Del"}
                  onClick={() => void handleDelete(menuNode.path)}
                  danger
                />
              </>
            )}

            {!menuNode && (
              <>
                <Divider />
                <MenuItem
                  icon={RefreshCw}
                  label="Refresh Explorer"
                  onClick={() => {
                    setMenu(null);
                    void onRefresh();
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
