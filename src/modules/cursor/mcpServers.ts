/**
 * Responsibility: map enabled library MCP configs onto the Cursor SDK server shape.
 * Inputs: enabled MCP configs. Stdio entries carry command, args, and env. HTTP entries carry a url and headers.
 * Outputs: a record keyed by server name. Incomplete entries are dropped. Env and headers are copied, never logged.
 */
import type { EnabledMcpConfig } from "../library/types";

export type SdkMcpServerConfig =
  | {
      type: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      type: "http";
      url: string;
      headers?: Record<string, string>;
    };

export function toSdkMcpServers(configs: readonly EnabledMcpConfig[]): Record<string, SdkMcpServerConfig> {
  const servers: Record<string, SdkMcpServerConfig> = {};
  const used = new Set<string>();
  for (const config of configs) {
    const server = mapConfig(config);
    if (!server) continue;
    servers[claimKey(used, config)] = server;
  }
  return servers;
}

function mapConfig(config: EnabledMcpConfig): SdkMcpServerConfig | undefined {
  if (config.type === "stdio") {
    const command = config.command?.trim() ?? "";
    if (!command) return undefined;
    return {
      type: "stdio",
      command,
      args: config.args ? [...config.args] : [],
      env: { ...config.env },
    };
  }
  const url = config.url?.trim() ?? "";
  if (!url) return undefined;
  const headers = config.headers ? { ...config.headers } : undefined;
  if (headers && Object.keys(headers).length > 0) {
    return { type: "http", url, headers };
  }
  return { type: "http", url };
}

function claimKey(used: Set<string>, config: EnabledMcpConfig): string {
  const name = config.name.trim();
  const preferred = name || config.id;
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const scoped = `${config.source}:${preferred}`;
  if (!used.has(scoped)) {
    used.add(scoped);
    return scoped;
  }
  let key = config.id;
  let suffix = 2;
  while (used.has(key)) {
    key = `${config.id}:${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}
