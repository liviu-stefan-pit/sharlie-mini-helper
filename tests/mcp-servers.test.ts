import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toSdkMcpServers } from "../src/modules/cursor/mcpServers";
import type { EnabledMcpConfig } from "../src/modules/library/types";

const TOKEN = "stdio-env-secret";
const HEADER = "http-header-secret";
const HTTP_ENV = "http-env-must-stay-off-the-sdk-shape";

describe("toSdkMcpServers", () => {
  test("maps stdio command/args/env and http url/headers, and drops incomplete entries", () => {
    const stdio: EnabledMcpConfig = {
      id: "app:mcp:local",
      name: "local",
      source: "app",
      type: "stdio",
      command: "echo",
      args: ["hi"],
      env: { TOKEN },
    };
    const http: EnabledMcpConfig = {
      id: "cursor:mcp.json#remote",
      name: "remote",
      source: "cursor",
      type: "http",
      url: "https://example.test/mcp",
      env: { UNUSED: HTTP_ENV },
      headers: { Authorization: HEADER },
    };
    const blankCommand: EnabledMcpConfig = {
      id: "app:mcp:blank",
      name: "blank",
      source: "app",
      type: "stdio",
      command: "  ",
      env: { TOKEN },
    };
    const blankUrl: EnabledMcpConfig = {
      id: "app:mcp:nourl",
      name: "nourl",
      source: "app",
      type: "http",
      url: "",
      env: { UNUSED: HTTP_ENV },
    };

    const servers = toSdkMcpServers([stdio, http, blankCommand, blankUrl]);

    assert.deepEqual(servers.local, {
      type: "stdio",
      command: "echo",
      args: ["hi"],
      env: { TOKEN },
    });
    assert.notEqual(servers.local && servers.local.type === "stdio" ? servers.local.env : undefined, stdio.env);
    assert.deepEqual(servers.remote, {
      type: "http",
      url: "https://example.test/mcp",
      headers: { Authorization: HEADER },
    });
    assert.equal(servers.remote && "env" in servers.remote, false);
    assert.equal(JSON.stringify(servers.remote).includes(HTTP_ENV), false);
    assert.equal(servers.blank, undefined);
    assert.equal(servers.nourl, undefined);
    assert.deepEqual(Object.keys(servers).sort(), ["local", "remote"]);
  });

  test("omits http headers when the config has none", () => {
    const servers = toSdkMcpServers([
      {
        id: "app:mcp:plain",
        name: "plain",
        source: "app",
        type: "http",
        url: "https://example.test/plain",
        env: { UNUSED: HTTP_ENV },
      },
    ]);
    assert.deepEqual(servers.plain, { type: "http", url: "https://example.test/plain" });
    assert.equal(JSON.stringify(servers).includes(HTTP_ENV), false);
  });

  test("keeps both enabled servers when names collide", () => {
    const servers = toSdkMcpServers([
      {
        id: "cursor:mcp.json#shared",
        name: "shared",
        source: "cursor",
        type: "stdio",
        command: "one",
        args: [],
        env: {},
      },
      {
        id: "app:mcp:shared",
        name: "shared",
        source: "app",
        type: "stdio",
        command: "two",
        args: ["--flag"],
        env: { TOKEN },
      },
    ]);
    assert.deepEqual(Object.keys(servers).sort(), ["app:shared", "shared"]);
    assert.deepEqual(servers.shared, { type: "stdio", command: "one", args: [], env: {} });
    assert.deepEqual(servers["app:shared"], {
      type: "stdio",
      command: "two",
      args: ["--flag"],
      env: { TOKEN },
    });
  });
});
