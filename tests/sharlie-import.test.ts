import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { AgentFile } from "../src/modules/agents/agentFile";
import { resolveAgentPath } from "../src/modules/agents/agentFile";
import type { PipelineDocument, PipelineNode } from "../src/modules/graph/types";
import type { SharlieItem, SharliePackage } from "../src/modules/sharlie/format";
import { buildSharliePackage } from "../src/modules/sharlie/pack";
import { importSharliePackage } from "../src/modules/sharlie/unpack";
import { newPipelineId, workflowDir } from "../src/modules/storage/pipelines";

describe("sharlie import", () => {
  test("extracts a bundled skill with its extra files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-skill-"));
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-ws-"));
    try {
      const skillDir = path.join(root, "skill");
      await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
      await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Code Review\n", "utf8");
      await fs.writeFile(path.join(skillDir, "scripts", "run.py"), "print('run')\n", "utf8");
      await fs.writeFile(path.join(skillDir, "blob.bin"), Buffer.from([0x68, 0x00, 0x69]));
      const doc = workflow("Code Review Flow");
      const built = await buildSharliePackage({
        doc,
        workflowDir: root,
        enabledSkills: [{ title: "Code Review", description: "Reviews code", path: path.join(skillDir, "SKILL.md") }],
        enabledRules: [],
        enabledMcpNames: [],
        includeFiles: true,
        appVersion: "0.0.0",
      });
      const newId = newPipelineId(built.pkg.workflow.name);
      const { doc: saved } = await importSharliePackage({
        pkg: built.pkg,
        workspace,
        newId,
        libraryAgents: [],
      });
      const slug = "code-review";
      const skillRoot = path.join(workspace, saved.id, ".sharlie", "bundle", "skills", slug);
      assert.equal(await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"), "# Code Review\n");
      assert.equal(await fs.readFile(path.join(skillRoot, "scripts", "run.py"), "utf8"), "print('run')\n");
      assert.deepEqual(await fs.readFile(path.join(skillRoot, "blob.bin")), Buffer.from([0x68, 0x00, 0x69]));
      const skill = saved.dependencies?.find((item) => item.kind === "skill");
      assert.equal(skill?.bundledPath, `.sharlie/bundle/skills/${slug}/SKILL.md`);
      await fs.access(path.join(workspace, saved.id, ".sharlie", "workflow.json"));
      assert.equal(saved.id, newId);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("a second skill with the same name lands in slug-2", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-slug-"));
    try {
      const pkg = makePackage(workflow("Two Skills"), {
        items: [
          skillItem("skill-1", "Code Review", "one"),
          skillItem("skill-2", "Code Review", "two"),
        ],
      });
      const { doc } = await importSharliePackage({
        pkg,
        workspace,
        newId: newPipelineId(pkg.workflow.name),
        libraryAgents: [],
      });
      const skillsRoot = path.join(workspace, doc.id, ".sharlie", "bundle", "skills");
      assert.equal(await fs.readFile(path.join(skillsRoot, "code-review", "SKILL.md"), "utf8"), "one");
      assert.equal(await fs.readFile(path.join(skillsRoot, "code-review-2", "SKILL.md"), "utf8"), "two");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("a bundled agent path is relative and resolves to the extracted file", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-agent-"));
    try {
      const node = agentNode("a1", "Helper");
      const pkg = makePackage(workflow("Agent Flow", [node]), {
        nodeAgents: { a1: "agent-1" },
        items: [
          {
            kind: "agent",
            ref: "agent-1",
            name: "Helper",
            description: "Helps",
            entry: "helper.md",
            files: [{ path: "helper.md", encoding: "utf8", content: "# Helper\n" }],
          },
        ],
      });
      const { doc } = await importSharliePackage({
        pkg,
        workspace,
        newId: newPipelineId(pkg.workflow.name),
        libraryAgents: [],
      });
      const saved = doc.nodes.find((item) => item.id === "a1");
      assert.ok(saved && saved.type === "agent");
      assert.equal(path.isAbsolute(saved.data.agentPath), false);
      assert.equal(saved.data.agentPath, ".sharlie/bundle/agents/helper/helper.md");
      const dir = workflowDir(workspace, doc.id);
      const resolved = resolveAgentPath(dir, saved.data.agentPath);
      assert.equal(await fs.readFile(resolved, "utf8"), "# Helper\n");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("a missing agent file uses a local agent with the same name", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-local-"));
    const library = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-lib-"));
    try {
      const libraryPath = path.join(library, "reviewer.md");
      await fs.writeFile(libraryPath, "# Reviewer\n", "utf8");
      const agents: AgentFile[] = [{ name: " reviewer ", description: "", path: libraryPath }];
      const pkg = makePackage(workflow("Local Agent", [agentNode("a1", "Reviewer")]), {
        nodeAgents: { a1: "agent-1" },
        items: [agentItem("agent-1", "Reviewer", null)],
      });
      const { doc, warnings } = await importSharliePackage({
        pkg,
        workspace,
        newId: newPipelineId(pkg.workflow.name),
        libraryAgents: agents,
      });
      const saved = doc.nodes.find((item) => item.id === "a1");
      assert.ok(saved && saved.type === "agent");
      assert.equal(path.isAbsolute(saved.data.agentPath), true);
      assert.equal(saved.data.agentPath, libraryPath);
      assert.ok(
        warnings.includes('Agent "Reviewer" was not in the file; using your local agent with the same name'),
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(library, { recursive: true, force: true });
    }
  });

  test("a missing agent with no local match still imports", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-missing-"));
    try {
      const pkg = makePackage(workflow("Missing Agent", [agentNode("a1", "Reviewer")]), {
        nodeAgents: { a1: "agent-1" },
        items: [agentItem("agent-1", "Reviewer", null)],
      });
      const { doc, warnings } = await importSharliePackage({
        pkg,
        workspace,
        newId: newPipelineId(pkg.workflow.name),
        libraryAgents: [],
      });
      const saved = doc.nodes.find((item) => item.id === "a1");
      assert.ok(saved && saved.type === "agent");
      assert.equal(saved.data.agentPath, "");
      assert.equal(saved.data.agentName, "Reviewer");
      assert.ok(warnings.includes('Agent "Reviewer" is missing. Pick an agent file on the red node.'));
      await fs.access(path.join(workspace, doc.id, ".sharlie", "workflow.json"));
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("a path that escapes the item folder is not written", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-evil-"));
    try {
      const workspace = path.join(parent, "ws");
      await fs.mkdir(workspace);
      const pkg = makePackage(workflow("Unsafe"), {
        items: [
          {
            kind: "skill",
            ref: "skill-1",
            name: "Code Review",
            description: "",
            entry: "SKILL.md",
            files: [{ path: "../../evil.md", encoding: "utf8", content: "pwned" }],
          },
        ],
      });
      const { doc, warnings } = await importSharliePackage({
        pkg,
        workspace,
        newId: newPipelineId(pkg.workflow.name),
        libraryAgents: [],
      });
      const skill = doc.dependencies?.find((item) => item.kind === "skill");
      assert.equal(skill?.bundledPath, undefined);
      assert.ok(warnings.includes('Could not unpack skill "Code Review"; it is marked as missing'));
      const files = await filesUnder(parent);
      assert.equal(
        files.some((file) => path.basename(file).toLowerCase() === "evil.md"),
        false,
      );
      for (const file of files) {
        const text = await fs.readFile(file, "utf8");
        assert.equal(text.includes("pwned"), false);
      }
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  test("mcp entries become dependencies with one warning each", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-import-mcp-"));
    try {
      const pkg = makePackage(workflow("MCP Flow"), {
        mcps: [{ name: "GitHub" }, { name: "Linear" }],
      });
      const { doc, warnings } = await importSharliePackage({
        pkg,
        workspace,
        newId: newPipelineId(pkg.workflow.name),
        libraryAgents: [],
      });
      const mcps = (doc.dependencies ?? []).filter((item) => item.kind === "mcp");
      assert.deepEqual(
        mcps.map((item) => item.name),
        ["GitHub", "Linear"],
      );
      assert.deepEqual(
        mcps.map((item) => item.description),
        ["", ""],
      );
      assert.deepEqual(warnings, [
        'MCP server "GitHub" is used by this workflow. Add it to your ~/.cursor/mcp.json and enable it in Library if you do not have it.',
        'MCP server "Linear" is used by this workflow. Add it to your ~/.cursor/mcp.json and enable it in Library if you do not have it.',
      ]);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  test("resolveAgentPath keeps an empty path, keeps an absolute path, and resolves a relative path", () => {
    assert.equal(resolveAgentPath("C:/w/flow", ""), "");
    const absolute = process.platform === "win32" ? "C:\\agents\\review.md" : "/agents/review.md";
    assert.equal(resolveAgentPath("C:/w/flow", absolute), absolute);
    const relative = ".sharlie/bundle/agents/review.md";
    const resolved = resolveAgentPath("C:/w/flow", relative);
    assert.equal(resolved, path.resolve("C:/w/flow", relative));
    const under = path.relative(path.resolve("C:/w/flow"), resolved);
    assert.equal(under.startsWith(".."), false);
    assert.equal(path.isAbsolute(under), false);
  });
});

function workflow(name: string, nodes: PipelineNode[] = []): PipelineDocument {
  return {
    version: 1,
    id: "old-workflow",
    name,
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodes,
    edges: [],
  };
}

function agentNode(id: string, agentName: string): PipelineNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      modelId: "composer",
      effort: "",
      effortParamId: "",
      agentPath: "",
      agentName,
      status: "idle",
      elapsedMs: 0,
      retryCount: 0,
      tokens: {},
    },
  };
}

function makePackage(
  doc: PipelineDocument,
  extra: Partial<Omit<SharliePackage, "workflow">> = {},
): SharliePackage {
  return {
    format: "sharlie-workflow",
    formatVersion: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    app: { name: "Sharlie Easy Flow", version: "0.0.0" },
    workflow: doc,
    nodeAgents: {},
    items: [],
    mcps: [],
    ...extra,
  };
}

function skillItem(ref: string, name: string, content: string): SharlieItem {
  return {
    kind: "skill",
    ref,
    name,
    description: "",
    entry: "SKILL.md",
    files: [{ path: "SKILL.md", encoding: "utf8", content }],
  };
}

function agentItem(ref: string, name: string, files: SharlieItem["files"]): SharlieItem {
  return {
    kind: "agent",
    ref,
    name,
    description: "",
    entry: "agent.md",
    files,
  };
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}
