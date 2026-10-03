"use client";

import { createContext, useContext, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  File,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { FileTreeNode } from "@/types/file-tree";

type FileExplorerProps = {
  fileTree: FileTreeNode[];
  activeFilePath: string;
  onRefresh: () => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onCreateFile: (path: string) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
  onDeletePath: (path: string) => Promise<void>;
  onRenamePath: (oldPath: string, newPath: string) => Promise<void>;
  selectedPath: string;
  setSelectedPath: React.Dispatch<React.SetStateAction<string>>;
  selectedType: "" | "file" | "directory";
  setSelectedType: React.Dispatch<
    React.SetStateAction<"" | "file" | "directory">
  >;
};

type TreeActions = {
  activeFilePath: string;
  onOpenFile: (path: string) => Promise<void>;
  setSelectedPath: (path: string) => void;
  setSelectedType: (type: "" | "file" | "directory") => void;
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
};

/** An in-progress "New File"/"New Folder" — an inline input row in the tree. */
type Creating = { dir: string; type: "file" | "directory"; value: string };

const TreeContext = createContext<TreeActions | null>(null);

function fileColor(name: string) {
  if (/\.(tsx?|jsx?)$/i.test(name)) return "text-[#4fc1ff]";
  if (/\.css$/i.test(name)) return "text-[#c586c0]";
  if (/\.json$/i.test(name)) return "text-[#e3b341]";
  return "text-[#8b949e]";
}

function parentDir(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

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
  const isDirectory = node.type === "directory";
  const isActive = !isDirectory && node.path === ctx.activeFilePath;
  const isRenaming = ctx.renamingPath === node.path;
  const isCreatingHere = isDirectory && ctx.creating?.dir === node.path;

  if (node.name === "node_modules") return null;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onContextMenu={(event) => ctx.openContextMenu(event, node)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.currentTarget.click();
        }}
        className={`flex h-7 w-full cursor-pointer items-center gap-1.5 px-2 text-left text-[13px] transition ${
          isActive
            ? "bg-white/10 text-[#f0f6fc]"
            : "text-[#b1bac4] hover:bg-[#1a1a1a] hover:text-[#e6edf3]"
        }`}
        style={{ paddingLeft: `${level * 14 + 8}px` }}
        onClick={async () => {
          if (isRenaming) return;
          ctx.setSelectedPath(node.path);
          ctx.setSelectedType(node.type);
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
  onClick,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[#1a1a1a] ${
        danger ? "text-[#ff7b72]" : "text-[#c9d1d9]"
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function ContextMenu({
  x,
  y,
  node,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  x: number;
  y: number;
  node: FileTreeNode;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="fixed z-50 w-44 overflow-hidden rounded-md border border-[#262626] bg-[#121212] py-1 shadow-xl shadow-black/40"
        style={{ top: y, left: x }}
      >
        {node.type === "directory" && (
          <>
            <MenuItem icon={FilePlus2} label="New File" onClick={onNewFile} />
            <MenuItem icon={FolderPlus} label="New Folder" onClick={onNewFolder} />
            <div className="my-1 h-px bg-[#262626]" />
          </>
        )}
        <MenuItem icon={Pencil} label="Rename" onClick={onRename} />
        <MenuItem icon={Trash2} label="Delete" onClick={onDelete} danger />
      </div>
    </>
  );
}

export default function FileExplorer({
  fileTree,
  activeFilePath,
  onRefresh,
  onCreateFolder,
  onCreateFile,
  onOpenFile,
  onDeletePath,
  onRenamePath,
  selectedPath,
  setSelectedPath,
  selectedType,
  setSelectedType,
}: FileExplorerProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; node: FileTreeNode } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  // Set once a create is committed or cancelled, so the blur that follows
  // Enter/Escape (when the input unmounts) can't run it a second time.
  const createSettled = useRef(true);

  function resolveDir(node?: FileTreeNode) {
    if (node) return node.type === "directory" ? node.path : parentDir(node.path);
    if (selectedType === "directory") return selectedPath;
    if (selectedType === "file") return parentDir(selectedPath);
    return "";
  }

  function handleCreateFile(node?: FileTreeNode) {
    setRenaming(null);
    createSettled.current = false;
    setCreating({ dir: resolveDir(node), type: "file", value: "" });
  }

  function handleCreateFolder(node?: FileTreeNode) {
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
    const path = dir ? `${dir}/${name}` : name;
    if (type === "file") await onCreateFile(path);
    else await onCreateFolder(path);
  }

  async function commitRename() {
    if (!renaming) return;
    const { path, value } = renaming;
    setRenaming(null);
    const trimmed = value.trim();
    if (!trimmed || trimmed === path.split("/").pop()) return;
    const dir = parentDir(path);
    await onRenamePath(path, dir ? `${dir}/${trimmed}` : trimmed);
  }

  async function handleDelete(node: FileTreeNode) {
    setMenu(null);
    if (!confirm(`Delete "${node.name}"? This cannot be undone.`)) return;
    await onDeletePath(node.path);
  }

  const treeActions: TreeActions = {
    activeFilePath,
    onOpenFile,
    setSelectedPath,
    setSelectedType,
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
    openContextMenu: (event, node) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedPath(node.path);
      setSelectedType(node.type);
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 190),
        y: Math.min(event.clientY, window.innerHeight - 120),
        node,
      });
    },
  };

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
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <Ellipsis size={15} />
          </button>
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-[#262626] px-3 text-[11px] font-medium text-[#c9d1d9]">
        <ChevronDown size={14} className="text-[#8b949e]" />
        <FolderOpen size={14} className="text-[#e3b341]" />
        WORKSPACE
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
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
              Create a file or folder to begin building.
            </p>
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          node={menu.node}
          onClose={() => setMenu(null)}
          onNewFile={() => {
            const node = menu.node;
            setMenu(null);
            handleCreateFile(node);
          }}
          onNewFolder={() => {
            const node = menu.node;
            setMenu(null);
            handleCreateFolder(node);
          }}
          onRename={() => {
            setRenaming({ path: menu.node.path, value: menu.node.name });
            setMenu(null);
          }}
          onDelete={() => handleDelete(menu.node)}
        />
      )}
    </aside>
  );
}
