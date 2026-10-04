"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MonacoEditor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { FileCode2, GitCompare, X } from "lucide-react";
import { WebContainer } from "@webcontainer/api";
import SaveDialog from "./SaveDialog";

type OpenFile = {
  path: string;
  content: string;
  isDirty: boolean;
};

export type DiffTab = {
  id: string;
  path: string;
  label: string;
  original: string;
  modified: string;
};

type EditorProps = {
  webcontainer: WebContainer | null;
  openedFiles: OpenFile[];
  setOpenedFiles: React.Dispatch<React.SetStateAction<OpenFile[]>>;
  activeFilePath: string;
  setActiveFilePath: React.Dispatch<React.SetStateAction<string>>;
  diffTabs: DiffTab[];
  setDiffTabs: React.Dispatch<React.SetStateAction<DiffTab[]>>;
  activeDiffId: string | null;
  setActiveDiffId: React.Dispatch<React.SetStateAction<string | null>>;
  onSelectionChange?: (selectedText: string) => void;
  /** Select this range once its file is showing (e.g. a clicked search result). */
  revealTarget?: RevealTarget | null;
};

export type RevealTarget = {
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  length: number;
  /** New value per request, so clicking the same result twice still jumps. */
  token: number;
};

const languagesByExtension: Record<string, string> = {
  css: "css",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
};

function languageForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return languagesByExtension[extension] ?? "plaintext";
}

export default function Editor({
  webcontainer,
  openedFiles,
  setOpenedFiles,
  activeFilePath,
  setActiveFilePath,
  diffTabs,
  setDiffTabs,
  activeDiffId,
  setActiveDiffId,
  onSelectionChange,
  revealTarget,
}: EditorProps) {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null);
  const activeDiff = diffTabs.find((diff) => diff.id === activeDiffId) ?? null;
  const currentFile = activeDiff ? null : openedFiles.find((file) => file.path === activeFilePath) ?? null;

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const revealedToken = useRef<number | null>(null);

  // Runs after the file's text is in the editor: from the effect below when
  // the editor already exists, or from onMount when it's just being created.
  const applyReveal = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !revealTarget || revealedToken.current === revealTarget.token) return;
    if (activeDiffId || activeFilePath !== revealTarget.path) return;

    revealedToken.current = revealTarget.token;
    const { line, column, length } = revealTarget;
    editor.setSelection({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + length });
    editor.revealLineInCenter(line);
    editor.focus();
  }, [revealTarget, activeFilePath, activeDiffId]);

  // Monaco loads asynchronously, so onMount can fire renders later than the
  // callback it was given — read the latest version through a ref.
  const applyRevealRef = useRef(applyReveal);

  useEffect(() => {
    applyRevealRef.current = applyReveal;
    applyReveal();
  }, [applyReveal, currentFile?.path]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.onDidDispose(() => {
      if (editorRef.current === editor) editorRef.current = null;
    });
    applyRevealRef.current();

    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      const model = editor.getModel();

      if (!selection || !model || selection.isEmpty()) {
        onSelectionChange?.("");
        return;
      }

      onSelectionChange?.(model.getValueInRange(selection));
    });
  }, [onSelectionChange]);

  useEffect(() => {
    onSelectionChange?.("");
  }, [activeFilePath, onSelectionChange]);

  function closeDiffTab(id: string) {
    setDiffTabs((previousDiffs) => previousDiffs.filter((diff) => diff.id !== id));
    if (activeDiffId === id) setActiveDiffId(null);
  }

  const saveFile = useCallback(async (path: string) => {
    if (!webcontainer) return;

    const file = openedFiles.find((openedFile) => openedFile.path === path);
    if (!file) return;

    await webcontainer.fs.writeFile(path, file.content);
    setOpenedFiles((previousFiles) => previousFiles.map((openedFile) => (
      openedFile.path === path ? { ...openedFile, isDirty: false } : openedFile
    )));
  }, [openedFiles, setOpenedFiles, webcontainer]);

  function closeTab(path: string) {
    const file = openedFiles.find((openedFile) => openedFile.path === path);
    if (!file) return;

    if (file.isDirty) {
      setPendingClosePath(path);
      return;
    }

    forceCloseTab(path);
  }

  function forceCloseTab(path: string) {
    const remainingFiles = openedFiles.filter((file) => file.path !== path);
    setOpenedFiles(remainingFiles);

    if (activeFilePath !== path) return;

    if (remainingFiles.length === 0) {
      setActiveFilePath("");
      return;
    }

    const closedIndex = openedFiles.findIndex((file) => file.path === path);
    const nextFile = remainingFiles[closedIndex] ?? remainingFiles[closedIndex - 1];
    setActiveFilePath(nextFile.path);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;

      event.preventDefault();
      if (activeFilePath && !activeDiffId) void saveFile(activeFilePath);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFilePath, activeDiffId, saveFile]);

  return (
    <section className="flex h-full min-w-0 flex-col bg-[#000000]">
      <div className="flex h-9 shrink-0 overflow-x-auto border-b border-[#262626] bg-[#121212]">
        {openedFiles.length === 0 && diffTabs.length === 0 ? (
          <span className="flex items-center px-3 text-[11px] text-[#6e7681]">No open editors</span>
        ) : (
          <>
            {openedFiles.map((file) => {
              const isActive = !activeDiff && file.path === activeFilePath;

              return (
                <div
                  key={file.path}
                  onClick={() => {
                    setActiveDiffId(null);
                    setActiveFilePath(file.path);
                  }}
                  onMouseEnter={() => setHoveredTab(file.path)}
                  onMouseLeave={() => setHoveredTab(null)}
                  className={`group relative flex h-full min-w-[140px] max-w-[220px] cursor-pointer items-center gap-2 border-r border-[#262626] px-3 text-[12px] transition ${
                    isActive
                      ? "bg-[#000000] text-[#e6edf3]"
                      : "bg-[#121212] text-[#8b949e] hover:bg-[#1a1a1a] hover:text-[#c9d1d9]"
                  }`}
                >
                  {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-white" />}
                  <FileCode2 size={14} className="shrink-0 text-[#4fc1ff]" />
                  <span className="min-w-0 flex-1 truncate">{file.path.split("/").pop()}</span>
                  <span className="grid h-4 w-4 shrink-0 place-items-center">
                    {hoveredTab === file.path ? (
                      <button
                        type="button"
                        aria-label={`Close ${file.path.split("/").pop()}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeTab(file.path);
                        }}
                        className="grid h-4 w-4 place-items-center rounded text-[#8b949e] hover:bg-[#262626] hover:text-white"
                      >
                        <X size={12} />
                      </button>
                    ) : file.isDirty ? (
                      <span className="text-[10px] text-[#c9d1d9]">●</span>
                    ) : null}
                  </span>
                </div>
              );
            })}

            {diffTabs.map((diff) => {
              const isActive = diff.id === activeDiffId;

              return (
                <div
                  key={diff.id}
                  onClick={() => setActiveDiffId(diff.id)}
                  onMouseEnter={() => setHoveredTab(diff.id)}
                  onMouseLeave={() => setHoveredTab(null)}
                  className={`group relative flex h-full min-w-[140px] max-w-[220px] cursor-pointer items-center gap-2 border-r border-[#262626] px-3 text-[12px] transition ${
                    isActive
                      ? "bg-[#000000] text-[#e6edf3]"
                      : "bg-[#121212] text-[#8b949e] hover:bg-[#1a1a1a] hover:text-[#c9d1d9]"
                  }`}
                >
                  {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-[#a371f7]" />}
                  <GitCompare size={14} className="shrink-0 text-[#a371f7]" />
                  <span className="min-w-0 flex-1 truncate">{diff.label}</span>
                  <button
                    type="button"
                    aria-label={`Close ${diff.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeDiffTab(diff.id);
                    }}
                    className="grid h-4 w-4 shrink-0 place-items-center rounded text-[#8b949e] opacity-0 hover:bg-[#262626] hover:text-white group-hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 bg-[#000000]">
        {activeDiff ? (
          <DiffEditor
            height="100%"
            language={languageForPath(activeDiff.path)}
            theme="vs-dark"
            original={activeDiff.original}
            modified={activeDiff.modified}
            options={{
              automaticLayout: true,
              fontFamily: "var(--font-geist-mono), Menlo, Monaco, Consolas, monospace",
              fontSize: 13,
              minimap: { enabled: false },
              readOnly: true,
              renderSideBySide: true,
            }}
          />
        ) : currentFile ? (
          <MonacoEditor
            height="100%"
            language={languageForPath(currentFile.path)}
            theme="vs-dark"
            value={currentFile.content}
            onMount={handleEditorMount}
            onChange={(value) => {
              setOpenedFiles((previousFiles) => previousFiles.map((file) => (
                file.path === activeFilePath
                  ? { ...file, content: value ?? "", isDirty: true }
                  : file
              )));
            }}
            options={{
              automaticLayout: true,
              fontFamily: "var(--font-geist-mono), Menlo, Monaco, Consolas, monospace",
              fontSize: 13,
              lineHeight: 22,
              minimap: { enabled: false },
              padding: { top: 14 },
              smoothScrolling: true,
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl border border-[#262626] bg-[#121212] text-[#4fc1ff] shadow-lg shadow-black/20">
              <FileCode2 size={22} />
            </span>
            <p className="mt-4 text-sm font-medium text-[#c9d1d9]">Ready for your next file</p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-[#6e7681]">Select a file in Explorer or create a new one to start coding.</p>
            <kbd className="mt-5 rounded border border-[#262626] bg-[#121212] px-2 py-1 font-mono text-[10px] text-[#8b949e]">⌘ P</kbd>
          </div>
        )}
      </div>

      {pendingClosePath && (
        <SaveDialog
          fileName={pendingClosePath.split("/").pop()!}
          onCancel={() => setPendingClosePath(null)}
          onDiscard={() => {
            forceCloseTab(pendingClosePath);
            setPendingClosePath(null);
          }}
          onSave={async () => {
            await saveFile(pendingClosePath);
            forceCloseTab(pendingClosePath);
            setPendingClosePath(null);
          }}
        />
      )}
    </section>
  );
}
