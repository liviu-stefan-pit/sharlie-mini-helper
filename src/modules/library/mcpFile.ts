/**
 * Responsibility: read MCP server entries from an mcp.json file.
 * Inputs: path to mcp.json.
 * Outputs: parsed servers. Env and headers stay on the parsed value for the runner only.
 */
import fs from "node:fs/promises";
import { isRecord, isSoftFsError, stringList, stringRecord } from "./json";

export type ParsedMcp = {
  name: string;
  type: "stdio" | "http";
  command?: string;
  args: string[];
  url?: string;
  env: Record<string, string>;
  headers: Record<string, string>;
  hasEnv: boolean;
};

export async function readMcpServers(file: string): Promise<{ realPath: string | null; servers: ParsedMcp[] }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isSoftFsError(error)) return { realPath: null, servers: [] };
    throw error;
  }
  let realPath: string | null = null;
  try {
    realPath = await fs.realpath(file);
  } catch (error) {
    if (isSoftFsError(error)) return { realPath: null, servers: [] };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return { realPath, servers: [] };
  }
  return { realPath, servers: parseMcpDocument(parsed) };
}

export function parseMcpDocument(value: unknown): ParsedMcp[] {
  if (!isRecord(value) || !isRecord(value.mcpServers)) return [];
  const servers: ParsedMcp[] = [];
  for (const [name, entry] of Object.entries(value.mcpServers)) {
    const parsed = parseMcpEntry(name, entry);
    if (parsed) servers.push(parsed);
  }
  servers.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return servers;
}

function parseMcpEntry(name: string, value: unknown): ParsedMcp | null {
  if (!name || !isRecord(value)) return null;
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if ((command && url) || (!command && !url)) return null;
  const env = stringRecord(value.env);
  const hasEnv = isRecord(value.env) && Object.keys(value.env).length > 0;
  if (command) {
    return {
      name,
      type: "stdio",
      command,
      args: stringList(value.args),
      env,
      headers: {},
      hasEnv,
    };
  }
  return {
    name,
    type: "http",
    args: [],
    url,
    env,
    headers: stringRecord(value.headers),
    hasEnv,
  };
}
