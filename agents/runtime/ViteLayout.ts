import type { WebContainer } from "@webcontainer/api";

// Vite serves the app from index.html in the project root. Models keep
// putting it in public/ (Create React App's layout), where Vite never loads
// it — the preview is blank and nothing errors, so the agent can't notice.
// Prompt rules alone didn't stop it, so it's enforced here in code:
//   - write_file redirects a Vite-style public/index.html to the root,
//   - start_dev_server moves a misplaced one before starting,
//   - the agent can't finish while a Vite project has no root index.html.

const VITE_CONFIGS = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.cjs"];
const ENTRY_CANDIDATES = ["src/main.jsx", "src/main.tsx", "src/main.js", "src/main.ts", "src/index.jsx", "src/index.tsx"];

function join(root: string, path: string) {
  return root === "." || root === "" ? path : `${root}/${path}`;
}

async function exists(webcontainer: WebContainer, path: string) {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "." : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const entries = await webcontainer.fs.readdir(dir).catch(() => [] as string[]);
  return entries.includes(name);
}

async function readText(webcontainer: WebContainer, path: string) {
  return webcontainer.fs.readFile(path, "utf-8").catch(() => null);
}

/** A Vite project: vite in package.json, or a vite.config file. */
export async function isViteProject(webcontainer: WebContainer, root: string) {
  const pkg = await readText(webcontainer, join(root, "package.json"));
  // \b keeps "vitest" from counting.
  if (pkg && /\bvite\b/.test(pkg)) return true;

  for (const config of VITE_CONFIGS) {
    if (await exists(webcontainer, join(root, config))) return true;
  }
  return false;
}

/** HTML written for Vite: it loads the app with a module script from /src. */
export function looksLikeViteHtml(html: string) {
  return /<script[^>]*type=["']module["'][^>]*src=["']\/?src\//i.test(html);
}

/** The file to load from index.html, e.g. "/src/main.jsx". */
async function findEntry(webcontainer: WebContainer, root: string) {
  for (const candidate of ENTRY_CANDIDATES) {
    if (await exists(webcontainer, join(root, candidate))) return `/${candidate}`;
  }
  return "/src/main.jsx";
}

/** Adds the root div and module script if the HTML is missing them. */
async function ensureViteMarkup(webcontainer: WebContainer, root: string, html: string) {
  let next = html;

  if (!/id=["']root["']/.test(next)) {
    next = next.includes("<body")
      ? next.replace(/<body([^>]*)>/i, `<body$1>\n    <div id="root"></div>`)
      : `${next}\n<div id="root"></div>`;
  }

  if (!looksLikeViteHtml(next)) {
    const script = `<script type="module" src="${await findEntry(webcontainer, root)}"></script>`;
    next = next.includes("</body>") ? next.replace(/<\/body>/i, `    ${script}\n  </body>`) : `${next}\n${script}`;
  }

  return next;
}

/**
 * If a Vite project has index.html in public/ but not in the root, moves it
 * to the root (adding the root div / module script if missing).
 * Returns a note describing what was fixed, or null if nothing was needed.
 */
export async function fixMisplacedIndexHtml(webcontainer: WebContainer, root: string): Promise<string | null> {
  if (!(await isViteProject(webcontainer, root))) return null;
  if (await exists(webcontainer, join(root, "index.html"))) return null;

  const misplaced = join(root, "public/index.html");
  const html = await readText(webcontainer, misplaced);
  if (html === null) return null;

  await webcontainer.fs.writeFile(join(root, "index.html"), await ensureViteMarkup(webcontainer, root, html));
  await webcontainer.fs.rm(misplaced);
  return "Moved public/index.html to the project root — Vite only loads index.html from there.";
}

/** Why a Vite project can't load yet, or null if its entry HTML is in place. */
export async function missingViteEntry(webcontainer: WebContainer, root: string): Promise<string | null> {
  if (!(await isViteProject(webcontainer, root))) return null;
  if (await exists(webcontainer, join(root, "index.html"))) return null;

  const entry = await findEntry(webcontainer, root);
  return `This is a Vite project but index.html is missing from the project root, so the preview will be blank. Create index.html in the project root (next to package.json) containing <div id="root"></div> and <script type="module" src="${entry}"></script>.`;
}
