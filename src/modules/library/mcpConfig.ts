/**
 * Responsibility: load enabled MCP servers, including env, for the runner.
 * Inputs: cursor home and app library root. MCP servers are read only from cursorHome/mcp.json.
 * Outputs: enabled server configs with env. Do not use this in list responses.
 */
import path from "node:path";
import { readMcpServers, type ParsedMcp } from "./mcpFile";
import { cursorMcpId } from "./paths";
import { readSelection } from "./selection";
import type { EnabledMcpConfig, LibraryRoots, LibrarySource } from "./types";

export async function loadEnabledMcpConfigs(roots: LibraryRoots): Promise<EnabledMcpConfig[]> {
  const [selection, cursorFile] = await Promise.all([
    readSelection(roots.appLibraryRoot),
    readMcpServers(path.join(roots.cursorHome, "mcp.json")),
  ]);
  const configs: EnabledMcpConfig[] = [];
  if (cursorFile.realPath) {
    for (const server of cursorFile.servers) {
      configs.push(toConfig(server, "cursor", cursorMcpId(cursorFile.realPath, server.name)));
    }
  }
  const enabled = new Set(selection.mcps.filter((id) => configs.some((config) => config.id === id)));
  return configs.filter((config) => enabled.has(config.id));
}

function toConfig(server: ParsedMcp, source: LibrarySource, id: string): EnabledMcpConfig {
  const config: EnabledMcpConfig = {
    id,
    name: server.name,
    source,
    type: server.type,
    env: { ...server.env },
  };
  if (server.type === "stdio") {
    config.command = server.command;
    config.args = [...server.args];
    return config;
  }
  config.url = server.url;
  if (Object.keys(server.headers).length > 0) config.headers = { ...server.headers };
  return config;
}
