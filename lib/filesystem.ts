import { WebContainer } from "@webcontainer/api";
import { FileTreeNode } from "@/types/file-tree";

const IGNORED_DIRS = new Set(["node_modules", ".git"]);

export async function readDirectory(
  webcontainer: WebContainer,
  path: string
): Promise<FileTreeNode[]> {
  const entries = await webcontainer.fs.readdir(path, {
    withFileTypes: true,
  });

  const tree: FileTreeNode[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const fullPath =
      path === "."
        ? entry.name
        : `${path}/${entry.name}`;

    const node: FileTreeNode = {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? "directory" : "file",
    };

    if (entry.isDirectory()) {
      node.children = await readDirectory(
        webcontainer,
        fullPath
      );
    }

    tree.push(node);
  }

  return tree;
}

function splitPath(path: string) {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  return { dir: parts.join("/"), name };
}

export async function pathExists(webcontainer: WebContainer, path: string): Promise<boolean> {
  const { dir, name } = splitPath(path);
  const entries = await webcontainer.fs.readdir(dir || ".").catch(() => [] as string[]);
  return entries.includes(name);
}

/** Copies a file, or a folder and everything in it, to `dest`. */
export async function copyPath(webcontainer: WebContainer, src: string, dest: string): Promise<void> {
  // readdir only succeeds on folders — the same check the git fs adapter uses.
  const entries = await webcontainer.fs.readdir(src, { withFileTypes: true }).catch(() => null);

  if (!entries) {
    const data = await webcontainer.fs.readFile(src);
    await webcontainer.fs.writeFile(dest, data);
    return;
  }

  await webcontainer.fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    await copyPath(webcontainer, `${src}/${entry.name}`, `${dest}/${entry.name}`);
  }
}

/**
 * A name that doesn't exist yet in `dir`, VS Code style:
 * "App.tsx" → "App copy.tsx" → "App copy 2.tsx".
 */
export async function uniqueCopyName(webcontainer: WebContainer, dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  // Dotfiles (".env") and extensionless names keep the whole name as the base.
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const join = (candidate: string) => (dir ? `${dir}/${candidate}` : candidate);

  if (!(await pathExists(webcontainer, join(name)))) return name;

  for (let n = 1; ; n++) {
    const candidate = `${base} copy${n === 1 ? "" : ` ${n}`}${ext}`;
    if (!(await pathExists(webcontainer, join(candidate)))) return candidate;
  }
}