import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { PipelineDocument, PipelineNode, WorkflowDependency } from "../src/modules/graph/types";
import type { LibraryMcp, LibraryRule, LibrarySkill, LibrarySnapshot } from "../src/modules/library/types";
import { checkWorkflowHealth, healthCatalogEntries } from "../src/modules/workflow/health";

describe("workflow health", () => {
  test("marks agent files ok, missing, or unset", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-health-agent-"));
    try {
      await fs.writeFile(path.join(dir, "review.md"), "# Review\n", "utf8");
      const missingFile = path.join(dir, "gone.md");
      const health = await checkWorkflowHealth({
        doc: document([
          agent("relative", "review.md", "Reviewer"),
          agent("named", "", "Planner"),
          agent("blank", "", ""),
          agent("absolute", missingFile, "Missing"),
        ]),
        workflowDir: dir,
        library: emptyLibrary(),
      });

      assert.deepEqual(health.agents.relative, { status: "ok" });
      assert.deepEqual(health.agents.named, {
        status: "missing",
        message: 'Agent "Planner" is not on this machine. Use Browse or pick another agent.',
      });
      assert.deepEqual(health.agents.blank, { status: "unset" });
      assert.deepEqual(health.agents.absolute, {
        status: "missing",
        message: `Agent file not found: ${missingFile}. Use Browse or pick another agent.`,
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("resolves a skill from the bundle, then the library, then missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-health-skill-"));
    try {
      const bundled = path.join(dir, ".sharlie", "bundle", "skills", "code-review", "SKILL.md");
      await fs.mkdir(path.dirname(bundled), { recursive: true });
      await fs.writeFile(bundled, "# Code Review\n", "utf8");
      const libraryPath = path.join(dir, "library-skill.md");
      const health = await checkWorkflowHealth({
        doc: document(
          [],
          [
            dependency("skill", "Code Review", "Checks diffs", ".sharlie/bundle/skills/code-review/SKILL.md"),
            dependency("skill", "Code Review Copy", "", ".sharlie/bundle/skills/deleted/SKILL.md"),
            dependency("skill", "Ghost Skill", ""),
          ],
        ),
        workflowDir: dir,
        library: emptyLibrary({
          skills: [skill("  code review copy  ", libraryPath, "Reviews code")],
        }),
      });

      assert.equal(health.dependencies[0]?.status, "bundled");
      assert.equal(health.dependencies[0]?.path, path.resolve(dir, ".sharlie/bundle/skills/code-review/SKILL.md"));
      assert.equal(health.dependencies[0]?.message, "Bundled with this workflow");
      assert.equal(health.dependencies[1]?.status, "library");
      assert.equal(health.dependencies[1]?.path, libraryPath);
      assert.equal(health.dependencies[1]?.description, "Reviews code");
      assert.equal(health.dependencies[1]?.message, `Found in your library: ${libraryPath}`);
      assert.equal(health.dependencies[2]?.status, "missing");
      assert.equal(
        health.dependencies[2]?.message,
        'Skill "Ghost Skill" is missing. Add it to ~/.cursor/skills or import it in Library.',
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("resolves a rule from the bundle, then the library, then missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-health-rule-"));
    try {
      const bundled = path.join(dir, ".sharlie", "bundle", "rules", "style.mdc");
      await fs.mkdir(path.dirname(bundled), { recursive: true });
      await fs.writeFile(bundled, "# Style\n", "utf8");
      const libraryPath = path.join(dir, "library-rule.mdc");
      const health = await checkWorkflowHealth({
        doc: document(
          [],
          [
            dependency("rule", "Style", "House style", ".sharlie/bundle/rules/style.mdc"),
            dependency("rule", "Naming", "", ".sharlie/bundle/rules/deleted.mdc"),
            dependency("rule", "Ghost Rule", ""),
          ],
        ),
        workflowDir: dir,
        library: emptyLibrary({
          rules: [rule("NAMING", libraryPath, "Name things")],
        }),
      });

      assert.equal(health.dependencies[0]?.status, "bundled");
      assert.equal(health.dependencies[0]?.path, path.resolve(dir, ".sharlie/bundle/rules/style.mdc"));
      assert.equal(health.dependencies[0]?.message, "Bundled with this workflow");
      assert.equal(health.dependencies[1]?.status, "library");
      assert.equal(health.dependencies[1]?.path, libraryPath);
      assert.equal(health.dependencies[1]?.message, `Found in your library: ${libraryPath}`);
      assert.equal(health.dependencies[2]?.status, "missing");
      assert.equal(
        health.dependencies[2]?.message,
        'Rule "Ghost Rule" is missing. Add it to ~/.cursor/rules or import it in Library.',
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("marks an MCP server enabled, disabled, or missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-health-mcp-"));
    try {
      const health = await checkWorkflowHealth({
        doc: document(
          [],
          [
            dependency("mcp", "GitHub", "Issues"),
            dependency("mcp", "Slack", ""),
            dependency("mcp", "Notion", ""),
          ],
        ),
        workflowDir: dir,
        library: emptyLibrary({
          mcps: [mcp("github", true), mcp("slack", false)],
        }),
      });

      assert.equal(health.dependencies[0]?.status, "library");
      assert.equal(health.dependencies[0]?.message, "Enabled in your library");
      assert.equal(health.dependencies[1]?.status, "disabled");
      assert.equal(
        health.dependencies[1]?.message,
        'MCP server "Slack" exists but is turned off. Enable it in Library.',
      );
      assert.equal(health.dependencies[2]?.status, "missing");
      assert.equal(
        health.dependencies[2]?.message,
        'MCP server "Notion" is not in ~/.cursor/mcp.json. Add it there, then enable it in Library.',
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("counts missing agents and missing or disabled dependencies, and skips unset agents", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-health-count-"));
    try {
      await fs.writeFile(path.join(dir, "review.md"), "# Review\n", "utf8");
      await fs.writeFile(path.join(dir, "skill.md"), "# Skill\n", "utf8");
      const health = await checkWorkflowHealth({
        doc: document(
          [agent("blank", "", ""), agent("named", "", "Planner"), agent("ok", "review.md", "Reviewer")],
          [
            dependency("skill", "Present", "Here", "skill.md"),
            dependency("rule", "Gone", ""),
            dependency("mcp", "Slack", ""),
            dependency("mcp", "GitHub", ""),
          ],
        ),
        workflowDir: dir,
        library: emptyLibrary({ mcps: [mcp("slack", false), mcp("GitHub", true)] }),
      });

      assert.equal(health.agents.blank?.status, "unset");
      assert.equal(health.agents.ok?.status, "ok");
      assert.equal(health.problemCount, 3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("returns catalog entries only for bundled and library skills and rules", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-health-catalog-"));
    try {
      const bundled = path.join(dir, "bundled-skill.md");
      await fs.writeFile(bundled, "# Bundled\n", "utf8");
      const libraryPath = path.join(dir, "library-rule.md");
      const health = await checkWorkflowHealth({
        doc: document(
          [],
          [
            dependency("skill", "Bundled Skill", "From the package", "bundled-skill.md"),
            dependency("rule", "Library Rule", "", "missing-rule.md"),
            dependency("skill", "Ghost Skill", ""),
            dependency("mcp", "GitHub", ""),
            dependency("rule", "Kept", "Keep this", "missing-kept.md"),
          ],
        ),
        workflowDir: dir,
        library: emptyLibrary({
          rules: [rule("Library Rule", libraryPath, "From the library"), rule("Kept", path.join(dir, "kept.md"), "Other")],
        }),
      });
      const entries = healthCatalogEntries(health);

      assert.equal(entries.skills.length, 1);
      assert.equal(entries.rules.length, 2);
      assert.equal(entries.skills[0]?.title, "Bundled Skill");
      assert.equal(entries.skills[0]?.description, "From the package");
      assert.equal(path.isAbsolute(entries.skills[0]?.path ?? ""), true);
      assert.equal(entries.skills[0]?.path, path.resolve(dir, "bundled-skill.md"));
      assert.equal(entries.rules[0]?.title, "Library Rule");
      assert.equal(entries.rules[0]?.description, "From the library");
      assert.equal(entries.rules[0]?.path, libraryPath);
      assert.equal(path.isAbsolute(entries.rules[0]?.path ?? ""), true);
      assert.equal(entries.rules[1]?.description, "Keep this");
      assert.equal(entries.rules[1]?.path, path.join(dir, "kept.md"));
      assert.equal(
        [...entries.skills, ...entries.rules].some((entry) => entry.title === "Ghost Skill" || entry.title === "GitHub"),
        false,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

function document(nodes: PipelineNode[], dependencies?: WorkflowDependency[]): PipelineDocument {
  const doc: PipelineDocument = {
    version: 1,
    id: "pipe",
    name: "Pipe",
    nodes,
    edges: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  if (dependencies) doc.dependencies = dependencies;
  return doc;
}

function agent(id: string, agentPath: string, agentName: string): PipelineNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      modelId: "model",
      effort: "",
      effortParamId: "",
      agentPath,
      agentName,
      status: "idle",
      elapsedMs: 0,
      retryCount: 0,
      tokens: {},
    },
  };
}

function dependency(
  kind: WorkflowDependency["kind"],
  name: string,
  description: string,
  bundledPath?: string,
): WorkflowDependency {
  const item: WorkflowDependency = { kind, name, description };
  if (bundledPath) item.bundledPath = bundledPath;
  return item;
}

function emptyLibrary(partial: Partial<LibrarySnapshot> = {}): LibrarySnapshot {
  return {
    skills: partial.skills ?? [],
    rules: partial.rules ?? [],
    mcps: partial.mcps ?? [],
  };
}

function skill(title: string, filePath: string, description: string): LibrarySkill {
  return {
    id: `cursor:${filePath}`,
    source: "cursor",
    title,
    description,
    path: filePath,
    enabled: false,
  };
}

function rule(title: string, filePath: string, description: string): LibraryRule {
  return skill(title, filePath, description);
}

function mcp(name: string, enabled: boolean): LibraryMcp {
  return {
    id: `cursor:${name}`,
    source: "cursor",
    name,
    hasEnv: false,
    transport: { type: "stdio", command: "noop", args: [], hasEnv: false },
    enabled,
  };
}
