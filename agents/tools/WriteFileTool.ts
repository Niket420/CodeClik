import { statPath } from "@/contextEnginer/src";
import type { Tool } from "../types";
import { guardPath } from "../executor/Guardrails";
import { isViteProject, looksLikeViteHtml } from "../runtime/ViteLayout";

function parentDirOf(path: string): string | null {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? null : path.slice(0, lastSlash);
}

export const WriteFileTool: Tool = {
  requiresApproval: false,
  definition: {
    name: "write_file",
    description:
      "Create a new file or overwrite an existing file with the given content. Creates any missing parent directories automatically.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Project-relative path to the file, e.g. \"src/components/Button.tsx\".",
        },
        content: {
          type: "string",
          description: "The full contents to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
  async execute(context, args) {
    const rawPath = String(args.path ?? "");
    const content = String(args.content ?? "");

    try {
      let path = guardPath(rawPath, context.projectRoot);
      let note = "";

      // Vite only loads index.html from the project root; in public/ it's
      // silently ignored and the preview stays blank. Redirect it.
      const root = context.projectRoot === "." ? "" : `${context.projectRoot}/`;
      if (
        path === `${root}public/index.html` &&
        (looksLikeViteHtml(content) || (await isViteProject(context.webcontainer, context.projectRoot)))
      ) {
        path = `${root}index.html`;
        note = " Note: written to the project root instead of public/, because Vite only loads index.html from the root.";
      }

      const { exists, isDirectory } = await statPath(context.webcontainer, path);
      if (exists && isDirectory) {
        return { success: false, output: "", error: `"${path}" is a directory, can't write a file there.` };
      }

      const parentDir = parentDirOf(path);
      if (parentDir) {
        await context.webcontainer.fs.mkdir(parentDir, { recursive: true });
      }

      await context.webcontainer.fs.writeFile(path, content);

      return {
        success: true,
        output: `${exists ? "Updated" : "Created"} ${path} (${content.length} characters).${note}`,
      };
    } catch (error) {
      return { success: false, output: "", error: error instanceof Error ? error.message : String(error) };
    }
  },
};
