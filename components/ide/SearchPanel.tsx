"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WebContainer } from "@webcontainer/api";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  File,
  Loader2,
  MoreHorizontal,
  Regex,
  RefreshCw,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from "lucide-react";

import type { FileTreeNode } from "@/types/file-tree";

type OpenFile = { path: string; content: string; isDirty: boolean };

type SearchMatch = {
  /** 1-based line number. */
  line: number;
  /** 0-based offset of the match within the line. */
  start: number;
  length: number;
  lineText: string;
};

type FileResult = { path: string; matches: SearchMatch[] };

type SearchPanelProps = {
  webcontainer: WebContainer;
  fileTree: FileTreeNode[];
  openedFiles: OpenFile[];
  /** Changes when the panel should grab focus (e.g. ⌘⇧F). */
  focusToken: number;
  onOpenMatch: (path: string, line: number, column: number, length: number) => void;
  /** Replace edits open files in the editor (left unsaved, like VS Code) instead of on disk. */
  onUpdateOpenFile: (path: string, content: string) => void;
  /** Called after files on disk were rewritten by a replace. */
  onFilesWritten: () => void;
};

// Searched like VS Code's default files.exclude + .gitignore for typical projects.
const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo", ".cache"]);
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif", "pdf", "zip", "gz", "tar",
  "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "webm", "mov", "wasm", "lockb",
]);
const MAX_FILE_BYTES = 1_000_000;
// Stop collecting after this many matches so huge result sets stay responsive.
const MAX_RESULTS = 2_000;
// Characters of context shown before a match in the results list.
const PREVIEW_LEAD = 24;

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(query: string, matchCase: boolean, wholeWord: boolean, useRegex: boolean) {
  let source = useRegex ? query : escapeRegex(query);
  if (wholeWord) source = `\\b(?:${source})\\b`;
  return new RegExp(source, matchCase ? "g" : "gi");
}

// Glob → RegExp for the include/exclude boxes. Like VS Code, a pattern without
// a slash matches at any depth ("*.ts", "components"), and a folder pattern
// matches everything inside it.
function globToRegex(glob: string) {
  let pattern = glob.trim().replace(/^\.\//, "").replace(/\/$/, "");
  if (!pattern.includes("/")) pattern = `**/${pattern}`;

  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      // "**/" can also match zero folders.
      if (pattern[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }

  return new RegExp(`^${source}(?:/.*)?$`, "i");
}

function parseGlobs(text: string) {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(globToRegex);
}

function collectFiles(nodes: FileTreeNode[], acc: string[] = []) {
  for (const node of nodes) {
    if (node.type === "directory") {
      if (!EXCLUDED_DIRS.has(node.name) && node.children) collectFiles(node.children, acc);
    } else {
      const extension = node.name.split(".").pop()?.toLowerCase() ?? "";
      if (!BINARY_EXTENSIONS.has(extension)) acc.push(node.path);
    }
  }
  return acc;
}

function findMatches(content: string, regex: RegExp, limit: number): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length && matches.length < limit; index++) {
    const lineText = lines[index];
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(lineText)) && matches.length < limit) {
      if (match[0].length === 0) {
        // Empty match (e.g. /^/): skip it, but move on so the loop ends.
        regex.lastIndex++;
        continue;
      }
      matches.push({ line: index + 1, start: match.index, length: match[0].length, lineText });
    }
  }

  return matches;
}

export default function SearchPanel({
  webcontainer,
  fileTree,
  openedFiles,
  focusToken,
  onOpenMatch,
  onUpdateOpenFile,
  onFilesWritten,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);

  const [results, setResults] = useState<FileResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [limited, setLimited] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [refreshToken, setRefreshToken] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchId = useRef(0);

  // Latest open-file contents, read at search time without re-running the
  // search on every keystroke in the editor.
  const openedFilesRef = useRef(openedFiles);
  useEffect(() => {
    openedFilesRef.current = openedFiles;
  }, [openedFiles]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const regexError = useMemo(() => {
    if (!query || !useRegex) return "";
    try {
      buildRegex(query, matchCase, wholeWord, useRegex);
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid regular expression";
    }
  }, [query, matchCase, wholeWord, useRegex]);

  async function readContent(path: string) {
    const open = openedFilesRef.current.find((file) => file.path === path);
    if (open) return open.content;
    return webcontainer.fs.readFile(path, "utf-8");
  }

  useEffect(() => {
    const id = ++searchId.current;

    // Nothing to search: the results list is hidden below, no state to reset.
    if (!query || regexError) return;

    const timer = setTimeout(async () => {
      setSearching(true);

      const regex = buildRegex(query, matchCase, wholeWord, useRegex);
      const includes = parseGlobs(include);
      const excludes = parseGlobs(exclude);
      const paths = collectFiles(fileTree).filter(
        (path) =>
          (includes.length === 0 || includes.some((glob) => glob.test(path))) &&
          !excludes.some((glob) => glob.test(path)),
      );

      const found: FileResult[] = [];
      let total = 0;

      // Small batches: parallel enough to be quick, and lets a newer search
      // (id changed) abandon this one early.
      for (let i = 0; i < paths.length && total < MAX_RESULTS; i += 25) {
        if (searchId.current !== id) return;

        const batch = await Promise.all(
          paths.slice(i, i + 25).map(async (path) => {
            try {
              const content = await readContent(path);
              if (content.length > MAX_FILE_BYTES || content.includes("\0")) return null;
              return { path, content };
            } catch {
              return null;
            }
          }),
        );

        for (const entry of batch) {
          if (!entry || total >= MAX_RESULTS) continue;
          const matches = findMatches(entry.content, regex, MAX_RESULTS - total);
          if (matches.length > 0) {
            found.push({ path: entry.path, matches });
            total += matches.length;
          }
        }
      }

      if (searchId.current !== id) return;
      setResults(found);
      setLimited(total >= MAX_RESULTS);
      setSearching(false);
    }, 250);

    return () => clearTimeout(timer);
    // readContent only reads refs and props that are stable for the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase, wholeWord, useRegex, include, exclude, fileTree, regexError, refreshToken]);

  // Stale results from an earlier query aren't shown once the box is cleared.
  const visibleResults = query && !regexError ? results : [];
  const totalMatches = visibleResults.reduce((sum, file) => sum + file.matches.length, 0);

  function toggleCollapsed(path: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function dismissFile(path: string) {
    setResults((previous) => previous.filter((file) => file.path !== path));
  }

  function dismissMatch(path: string, match: SearchMatch) {
    setResults((previous) =>
      previous.flatMap((file) => {
        if (file.path !== path) return [file];
        const matches = file.matches.filter((m) => m !== match);
        return matches.length > 0 ? [{ ...file, matches }] : [];
      }),
    );
  }

  // Regex mode supports $1-style groups; plain mode inserts the text as-is.
  function replacementFor(matchedText: string) {
    if (!useRegex) return replacement;
    const single = new RegExp(buildRegex(query, matchCase, wholeWord, useRegex).source, matchCase ? "" : "i");
    return matchedText.replace(single, replacement);
  }

  async function writeContent(path: string, content: string) {
    const isOpen = openedFilesRef.current.some((file) => file.path === path);
    if (isOpen) {
      onUpdateOpenFile(path, content);
    } else {
      await webcontainer.fs.writeFile(path, content);
    }
    return !isOpen;
  }

  async function replaceInFile(path: string) {
    const content = await readContent(path);
    const regex = buildRegex(query, matchCase, wholeWord, useRegex);
    const next = content
      .split("\n")
      .map((line) => (useRegex ? line.replace(regex, replacement) : line.replace(regex, () => replacement)))
      .join("\n");
    return writeContent(path, next);
  }

  async function handleReplaceFile(path: string) {
    const wroteDisk = await replaceInFile(path);
    if (wroteDisk) onFilesWritten();
    setRefreshToken((token) => token + 1);
  }

  async function handleReplaceAll() {
    let wroteDisk = false;
    for (const file of visibleResults) {
      wroteDisk = (await replaceInFile(file.path)) || wroteDisk;
    }
    if (wroteDisk) onFilesWritten();
    setRefreshToken((token) => token + 1);
  }

  async function handleReplaceMatch(path: string, match: SearchMatch) {
    const content = await readContent(path);
    const lines = content.split("\n");
    const line = lines[match.line - 1];
    const matched = line?.slice(match.start, match.start + match.length);
    // The file changed since the search ran — just refresh the results.
    if (matched === undefined || matched.length !== match.length) {
      setRefreshToken((token) => token + 1);
      return;
    }

    lines[match.line - 1] = line.slice(0, match.start) + replacementFor(matched) + line.slice(match.start + match.length);
    const wroteDisk = await writeContent(path, lines.join("\n"));
    if (wroteDisk) onFilesWritten();
    setRefreshToken((token) => token + 1);
  }

  function clearSearch() {
    setQuery("");
    setReplacement("");
    setResults([]);
    setCollapsed(new Set());
    inputRef.current?.focus();
  }

  const toggleClass = (on: boolean) =>
    `grid h-5 w-5 place-items-center rounded border transition ${
      on ? "border-[#e6edf3] bg-white text-black" : "border-transparent text-[#8b949e] hover:bg-[#262626] hover:text-white"
    }`;

  return (
    <aside className="flex h-full min-w-0 flex-col bg-[#0a0a0a] text-[#c9d1d9]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#262626] px-3">
        <span className="text-[11px] font-semibold tracking-[0.12em] text-[#c9d1d9]">SEARCH</span>
        <div className="flex items-center gap-0.5 text-[#8b949e]">
          <button
            type="button"
            title="Refresh"
            onClick={() => setRefreshToken((token) => token + 1)}
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            title="Clear Search Results"
            onClick={clearSearch}
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <X size={14} />
          </button>
          <button
            type="button"
            title="Collapse All"
            onClick={() => setCollapsed(new Set(results.map((file) => file.path)))}
            className="grid h-6 w-6 place-items-center rounded hover:bg-[#262626] hover:text-white"
          >
            <ChevronsDownUp size={14} />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-[#262626] px-2 py-2">
        <div className="flex gap-1">
          <button
            type="button"
            title={showReplace ? "Hide Replace" : "Toggle Replace"}
            onClick={() => setShowReplace((open) => !open)}
            className="grid w-5 shrink-0 place-items-center rounded text-[#8b949e] hover:bg-[#262626] hover:text-white"
          >
            {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div
              className={`flex items-start rounded border bg-[#000000] focus-within:border-[#e6edf3] ${
                regexError ? "border-[#f85149]" : "border-[#262626]"
              }`}
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter searches right away; Shift+Enter is a newline only in regex mode.
                  if (event.key === "Enter" && !(event.shiftKey && useRegex)) {
                    event.preventDefault();
                    setRefreshToken((token) => token + 1);
                  }
                }}
                placeholder="Search"
                spellCheck={false}
                className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-[12.5px] text-white outline-none placeholder:text-[#6e7681]"
              />
              <div className="flex shrink-0 items-center gap-0.5 px-1 py-1">
                <button type="button" title="Match Case" aria-pressed={matchCase} onClick={() => setMatchCase((on) => !on)} className={toggleClass(matchCase)}>
                  <CaseSensitive size={14} />
                </button>
                <button type="button" title="Match Whole Word" aria-pressed={wholeWord} onClick={() => setWholeWord((on) => !on)} className={toggleClass(wholeWord)}>
                  <WholeWord size={14} />
                </button>
                <button type="button" title="Use Regular Expression" aria-pressed={useRegex} onClick={() => setUseRegex((on) => !on)} className={toggleClass(useRegex)}>
                  <Regex size={14} />
                </button>
              </div>
            </div>

            {regexError && <p className="px-1 text-[11px] text-[#f85149]">{regexError}</p>}

            {showReplace && (
              <div className="flex items-center gap-1">
                <input
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && visibleResults.length > 0) {
                      event.preventDefault();
                      void handleReplaceAll();
                    }
                  }}
                  placeholder="Replace"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded border border-[#262626] bg-[#000000] px-2 py-1 text-[12.5px] text-white outline-none placeholder:text-[#6e7681] focus:border-[#e6edf3]"
                />
                <button
                  type="button"
                  title="Replace All (⌘↵)"
                  disabled={visibleResults.length === 0}
                  onClick={() => void handleReplaceAll()}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-[#8b949e] hover:bg-[#262626] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ReplaceAll size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-1 flex justify-end">
          <button
            type="button"
            title="Toggle Search Details"
            onClick={() => setShowDetails((open) => !open)}
            className={`grid h-5 w-6 place-items-center rounded transition ${
              showDetails ? "bg-[#1a1a1a] text-white" : "text-[#8b949e] hover:bg-[#262626] hover:text-white"
            }`}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>

        {showDetails && (
          <div className="mt-1 flex flex-col gap-1.5 pl-6">
            <label className="flex flex-col gap-0.5 text-[11px] text-[#8b949e]">
              files to include
              <input
                value={include}
                onChange={(event) => setInclude(event.target.value)}
                placeholder="e.g. *.ts, src/**/include"
                spellCheck={false}
                className="rounded border border-[#262626] bg-[#000000] px-2 py-1 text-[12px] text-white outline-none placeholder:text-[#6e7681] focus:border-[#e6edf3]"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[#8b949e]">
              files to exclude
              <input
                value={exclude}
                onChange={(event) => setExclude(event.target.value)}
                placeholder="e.g. *.test.ts, **/generated"
                spellCheck={false}
                className="rounded border border-[#262626] bg-[#000000] px-2 py-1 text-[12px] text-white outline-none placeholder:text-[#6e7681] focus:border-[#e6edf3]"
              />
            </label>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {query && !regexError && (
          <p className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-[#8b949e]">
            {searching && <Loader2 size={11} className="animate-spin" />}
            {searching && visibleResults.length === 0
              ? "Searching…"
              : totalMatches === 0
                ? "No results found."
                : `${totalMatches}${limited ? "+" : ""} result${totalMatches === 1 ? "" : "s"} in ${visibleResults.length} file${visibleResults.length === 1 ? "" : "s"}`}
          </p>
        )}

        {visibleResults.map((file) => {
          const isCollapsed = collapsed.has(file.path);
          const name = file.path.split("/").pop();
          const dir = file.path.split("/").slice(0, -1).join("/");

          return (
            <div key={file.path}>
              <div
                onClick={() => toggleCollapsed(file.path)}
                className="group flex h-6 cursor-pointer items-center gap-1 px-2 text-[12.5px] hover:bg-[#1a1a1a]"
              >
                {isCollapsed ? (
                  <ChevronRight size={14} className="shrink-0 text-[#8b949e]" />
                ) : (
                  <ChevronDown size={14} className="shrink-0 text-[#8b949e]" />
                )}
                <File size={14} className="shrink-0 text-[#8b949e]" />
                <span className="shrink-0 text-[#e6edf3]">{name}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#6e7681]">{dir}</span>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  {showReplace && (
                    <button
                      type="button"
                      title="Replace All in File"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleReplaceFile(file.path);
                      }}
                      className="grid h-5 w-5 place-items-center rounded text-[#8b949e] hover:bg-[#262626] hover:text-white"
                    >
                      <ReplaceAll size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Dismiss"
                    onClick={(event) => {
                      event.stopPropagation();
                      dismissFile(file.path);
                    }}
                    className="grid h-5 w-5 place-items-center rounded text-[#8b949e] hover:bg-[#262626] hover:text-white"
                  >
                    <X size={13} />
                  </button>
                </span>
                <span className="shrink-0 rounded-full bg-[#262626] px-1.5 text-[10px] leading-4 text-[#c9d1d9] group-hover:hidden">
                  {file.matches.length}
                </span>
              </div>

              {!isCollapsed &&
                file.matches.map((match) => {
                  const lead = Math.max(0, match.start - PREVIEW_LEAD);
                  const before = (lead > 0 ? "…" : "") + match.lineText.slice(lead, match.start).trimStart();
                  const matched = match.lineText.slice(match.start, match.start + match.length);
                  const after = match.lineText.slice(match.start + match.length, match.start + match.length + 200);

                  return (
                    <div
                      key={`${match.line}:${match.start}`}
                      onClick={() => onOpenMatch(file.path, match.line, match.start + 1, match.length)}
                      title={`Line ${match.line}`}
                      className="group flex h-[22px] cursor-pointer items-center gap-1 pl-9 pr-2 text-[12px] hover:bg-[#1a1a1a]"
                    >
                      <span className="min-w-0 flex-1 truncate whitespace-pre font-mono text-[11.5px] text-[#8b949e]">
                        {before}
                        {showReplace && replacement !== "" ? (
                          <>
                            <span className="bg-[#f85149]/25 text-[#ffa198] line-through">{matched}</span>
                            <span className="bg-[#3fb950]/25 text-[#7ee787]">{replacementFor(matched)}</span>
                          </>
                        ) : (
                          <span className="rounded-sm bg-[#e3b341]/30 text-[#e6edf3]">{matched}</span>
                        )}
                        {after}
                      </span>
                      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                        {showReplace && (
                          <button
                            type="button"
                            title="Replace"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleReplaceMatch(file.path, match);
                            }}
                            className="grid h-5 w-5 place-items-center rounded text-[#8b949e] hover:bg-[#262626] hover:text-white"
                          >
                            <Replace size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Dismiss"
                          onClick={(event) => {
                            event.stopPropagation();
                            dismissMatch(file.path, match);
                          }}
                          className="grid h-5 w-5 place-items-center rounded text-[#8b949e] hover:bg-[#262626] hover:text-white"
                        >
                          <X size={13} />
                        </button>
                      </span>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
