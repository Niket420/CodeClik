import type { Tool } from "../types";
import { ReadFileTool } from "./ReadFileTool";
import { WriteFileTool } from "./WriteFileTool";
import { DeleteFileTool } from "./DeleteFileTool";
import { CreateDirectoryTool } from "./CreateDirectoryTool";
import { ListDirectoryTool } from "./ListDirectoryTool";
import { RunCommandTool } from "./RunCommandTool";
import { StartDevServerTool } from "./StartDevServerTool";
import { CheckDevServerTool } from "./CheckDevServerTool";

export const ALL_TOOLS: Tool[] = [
  ReadFileTool,
  WriteFileTool,
  DeleteFileTool,
  CreateDirectoryTool,
  ListDirectoryTool,
  RunCommandTool,
  StartDevServerTool,
  CheckDevServerTool,
];

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.definition.name, tool]));

export function getTool(name: string): Tool | undefined {
  return TOOLS_BY_NAME.get(name);
}

/** OpenAI-compatible `tools` array to send to the model. */
export function getToolSchemas() {
  return ALL_TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.parameters,
    },
  }));
}

export {
  ReadFileTool,
  WriteFileTool,
  DeleteFileTool,
  CreateDirectoryTool,
  ListDirectoryTool,
  RunCommandTool,
  StartDevServerTool,
  CheckDevServerTool,
};
