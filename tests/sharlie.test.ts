import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { PipelineDocument } from "../src/modules/graph/types";
import { SharlieFormatError } from "../src/modules/sharlie/format";
import { LIMITS } from "../src/modules/sharlie/format";
import { buildSharliePackage, readBundleFiles } from "../src/modules/sharlie/pack";
import { parseSharliePackage } from "../src/modules/sharlie/parse";
import { samePath } from "../src/modules/library/paths";
import { normalizePipeline, parseDependencies, readPipeline, writePipeline } from "../src/modules/storage/pipelines";
import { isSafeRelativePath } from "../src/modules/storage/pipelines";

const SECRET = "mcp-env-super-secret";

describe("sharlie format", () => {
  test("readBundleFiles skips private folders and encodes a null byte as base64", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-bundle-"));
    try {
      await fs.writeFile(path.join(root, "b.txt"), "bee", "utf8");
      await fs.writeFile(path.join(root, "a.txt"), "aye", "utf8");
      await fs.mkdir(path.join(root, "sub"));
      await fs.writeFile(path.join(root, "sub", "c.txt"), "cee", "utf8");
      await fs.writeFile(path.join(root, "nul.bin"), Buffer.from([0x68, 0x00, 0x69]));
      await fs.writeFile(path.join(root, "big.bin"), Buffer.alloc(2 * 1024 * 1024, 0x61));
      await fs.writeFile(path.join(root, ".env"), "SECRET_ENV=1\n", "utf8");
      await fs.writeFile(path.join(root, ".env.local"), "SECRET_LOCAL=1\n", "utf8");
      await fs.writeFile(path.join(root, ".environment"), "keep-environment", "utf8");
      await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
      await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "secret-node", "utf8");
      await fs.mkdir(path.join(root, ".git"));
      await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: secret-git\n", "utf8");
      await fs.mkdir(path.join(root, "dist"));
      await fs.writeFile(path.join(root, "dist", "app.js"), "secret-dist", "utf8");
      await fs.mkdir(path.join(root, ".sharlie"));
      await fs.writeFile(path.join(root, ".sharlie", "workflow.json"), "{}\n", "utf8");

      const result = await readBundleFiles(root, {
        maxFiles: LIMITS.maxSkillFiles,
        maxTotalBytes: LIMITS.maxSkillBytes,
        maxFileBytes: LIMITS.maxFileBytes,
      });

      assert.deepEqual(
        result.files.map((file) => file.path),
        [".environment", "a.txt", "b.txt", "nul.bin", "sub/c.txt"],
      );
      assert.equal(result.files.every((file) => !file.path.includes("\\")), true);
      assert.deepEqual(result.warnings, ["Skipped big.bin: larger than 1 MB"]);
      assert.equal(result.truncated, false);
      const text = result.files.find((file) => file.path === "a.txt");
      assert.equal(text?.encoding, "utf8");
      assert.equal(text?.content, "aye");
      const binary = result.files.find((file) => file.path === "nul.bin");
      assert.equal(binary?.encoding, "base64");
      assert.ok(binary);
      assert.deepEqual(Buffer.from(binary.content, "base64"), Buffer.from([0x68, 0x00, 0x69]));
      const packed = JSON.stringify(result.files);
      assert.equal(packed.includes("SECRET_ENV"), false);
      assert.equal(packed.includes("SECRET_LOCAL"), false);
      assert.equal(packed.includes("secret-node"), false);
      assert.equal(packed.includes("secret-git"), false);
      assert.equal(packed.includes("keep-environment"), true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("readBundleFiles skips .ENV on Windows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-env-case-"));
    try {
      await fs.writeFile(path.join(root, ".ENV"), "SECRET_ENV_CASE\n", "utf8");
      await fs.writeFile(path.join(root, "keep.txt"), "keep", "utf8");
      const result = await readBundleFiles(root, {
        maxFiles: LIMITS.maxSkillFiles,
        maxTotalBytes: LIMITS.maxSkillBytes,
        maxFileBytes: LIMITS.maxFileBytes,
      });
      const packed = JSON.stringify(result.files);
      if (process.platform === "win32") {
        assert.equal(
          result.files.some((file) => file.path.toLowerCase() === ".env"),
          false,
        );
        assert.equal(packed.includes("SECRET_ENV_CASE"), false);
      } else {
        assert.ok(result.files.some((file) => file.path === ".ENV"));
      }
      assert.equal(packed.includes("keep"), true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("a skill keeps other files when the entry casing differs", async (t) => {
    if (process.platform !== "win32") {
      t.skip("the catalog path and the directory name differ only by case");
      return;
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-skill-case-"));
    try {
      const skillDir = path.join(dir, "skill");
      await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
      await fs.writeFile(path.join(skillDir, "skill.md"), "# Skill\n", "utf8");
      await fs.writeFile(path.join(skillDir, "scripts", "run.py"), "print('run')\n", "utf8");
      const doc: PipelineDocument = {
        version: 1,
        id: "demo-1",
        name: "Demo",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [],
        edges: [],
      };
      const { pkg, warnings } = await buildSharliePackage({
        doc,
        workflowDir: dir,
        enabledSkills: [
          { title: "Code Review", description: "Reviews code", path: path.join(skillDir, "SKILL.md") },
        ],
        enabledRules: [],
        enabledMcpNames: [],
        includeFiles: true,
        appVersion: "9.9.9",
      });
      const skill = pkg.items.find((item) => item.kind === "skill");
      assert.ok(skill?.files);
      assert.ok(skill.files.some((file) => file.path === skill.entry));
      assert.ok(skill.files.some((file) => file.path === "scripts/run.py"));
      assert.equal(
        warnings.some((warning) => warning.includes("too large")),
        false,
      );
      const parsed = parseSharliePackage(JSON.stringify(pkg));
      const parsedSkill = parsed.pkg.items.find((item) => item.kind === "skill");
      assert.ok(parsedSkill?.files);
      assert.ok(parsedSkill.files.some((file) => file.path === "scripts/run.py"));
      assert.ok(parsedSkill.files.some((file) => samePath(file.path, parsedSkill.entry)));
      assert.equal(
        parsed.warnings.some((warning) => warning.includes("no main file")),
        false,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("buildSharliePackage bundles files and resets the workflow copy", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-pack-"));
    try {
      const built = await buildSample(dir, true);
      const { pkg, warnings } = built;
      assert.deepEqual(warnings, []);
      assert.equal(pkg.format, "sharlie-workflow");
      assert.equal(pkg.formatVersion, 1);
      assert.equal(pkg.app.name, "Sharlie Easy Flow");
      assert.equal(pkg.app.version, "9.9.9");

      const skill = pkg.items.find((item) => item.kind === "skill");
      assert.ok(skill);
      assert.equal(skill.entry, "SKILL.md");
      assert.ok(skill.files);
      assert.deepEqual(
        skill.files.map((file) => file.path),
        ["SKILL.md", "scripts/run.py"],
      );
      assert.match(skill.files.find((file) => file.path === "scripts/run.py")?.content ?? "", /print\("run"\)/);

      const rule = pkg.items.find((item) => item.kind === "rule");
      assert.ok(rule?.files);
      assert.equal(rule.files.length, 1);
      assert.equal(rule.entry, "review.md");
      assert.equal(rule.files[0]?.path, "review.md");
      assert.match(rule.files[0]?.content ?? "", /Keep this rule/);

      const agents = pkg.items.filter((item) => item.kind === "agent");
      assert.equal(agents.length, 1);
      assert.equal(agents[0]?.ref, "agent-1");
      assert.equal(agents[0]?.name, "Custom");
      assert.equal(agents[0]?.description, "Helps with the export");
      assert.equal(agents[0]?.files?.[0]?.encoding, "utf8");
      assert.equal(pkg.nodeAgents.a1, "agent-1");
      assert.equal(pkg.nodeAgents.a2, "agent-1");

      assert.equal("dependencies" in pkg.workflow, false);
      for (const node of pkg.workflow.nodes) {
        if (node.type === "agent") {
          assert.equal(node.data.agentPath, "");
          assert.equal(node.data.status, "idle");
          assert.equal(node.data.elapsedMs, 0);
          assert.equal(node.data.retryCount, 0);
          assert.deepEqual(node.data.tokens, {});
          assert.equal("lastOutput" in node.data, false);
          assert.equal(node.data.agentName === "Custom" || node.data.agentName === "", true);
        }
        if (node.type === "human") {
          assert.equal(node.data.status, "idle");
          assert.deepEqual(node.data.artifactPaths, []);
        }
      }
      assert.equal(built.doc.nodes[0]?.type, "agent");
      if (built.doc.nodes[0]?.type === "agent") {
        assert.notEqual(built.doc.nodes[0].data.agentPath, "");
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("includeFiles false exports names only and no warnings", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-names-"));
    try {
      const { pkg, warnings } = await buildSample(dir, false);
      assert.deepEqual(warnings, []);
      assert.ok(pkg.items.length >= 3);
      for (const item of pkg.items) assert.equal(item.files, null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("a missing agent file is exported as a name only", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-missing-agent-"));
    try {
      const doc: PipelineDocument = {
        version: 1,
        id: "demo-1",
        name: "Demo",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [
          {
            id: "a1",
            type: "agent",
            position: { x: 0, y: 0 },
            data: {
              modelId: "auto",
              agentPath: "missing.md",
              agentName: "Helper",
              status: "done",
              elapsedMs: 5,
              retryCount: 1,
              tokens: { total: 3 },
              lastOutput: "x",
            },
          },
        ],
        edges: [],
      };
      const { pkg, warnings } = await buildSharliePackage({
        doc,
        workflowDir: dir,
        enabledSkills: [],
        enabledRules: [],
        enabledMcpNames: [],
        includeFiles: true,
        appVersion: "9.9.9",
      });
      const agent = pkg.items.find((item) => item.kind === "agent");
      assert.ok(agent);
      assert.equal(agent.files, null);
      assert.deepEqual(warnings, ['Agent "Helper" could not be read and was exported as a name only']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("mcp entries are names only", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-mcp-"));
    try {
      const { pkg } = await buildSample(dir, true);
      assert.deepEqual(
        pkg.mcps.map((mcp) => mcp.name),
        ["Alpha", "beta", "Gamma"],
      );
      for (const mcp of pkg.mcps) assert.deepEqual(Object.keys(mcp), ["name"]);
      assert.equal(JSON.stringify(pkg).includes(SECRET), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("parseSharliePackage round-trips a package", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-round-"));
    try {
      const { pkg } = await buildSample(dir, true);
      const text = JSON.stringify(pkg);
      const parsed = parseSharliePackage(text);
      assert.deepEqual(parsed.warnings, []);
      assert.deepEqual(JSON.parse(JSON.stringify(parsed.pkg)), JSON.parse(text));
      const withBom = parseSharliePackage(`\uFEFF${text}`);
      assert.deepEqual(withBom.warnings, []);
      assert.deepEqual(JSON.parse(JSON.stringify(withBom.pkg)), JSON.parse(text));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("parseSharliePackage rejects a damaged package with the hard-error messages", () => {
    const cases: [string, string][] = [
      ["{", "This is not a .sharlie file (invalid JSON)"],
      ["[]", "This is not a .sharlie file"],
      [JSON.stringify({ format: "nope" }), "This is not a .sharlie file"],
      [JSON.stringify({ format: "sharlie-workflow" }), "This .sharlie file has no format version"],
      [JSON.stringify({ format: "sharlie-workflow", formatVersion: "1" }), "This .sharlie file has no format version"],
      [
        JSON.stringify({ format: "sharlie-workflow", formatVersion: 2 }),
        "This .sharlie file was made by a newer Sharlie Easy Flow. Update the app to import it.",
      ],
      [
        JSON.stringify({ format: "sharlie-workflow", formatVersion: 1, workflow: null }),
        "The workflow inside this .sharlie file is damaged: Pipeline body must be an object",
      ],
    ];
    for (const [text, message] of cases) {
      assert.throws(
        () => parseSharliePackage(text),
        (error: unknown) => {
          assert.ok(error instanceof SharlieFormatError);
          assert.equal(error.name, "SharlieFormatError");
          assert.equal(error.message, message);
          return true;
        },
      );
    }
  });

  test("an unsafe bundled path is dropped and the item remains", () => {
    const text = JSON.stringify({
      format: "sharlie-workflow",
      formatVersion: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      app: { name: "Sharlie Easy Flow", version: "0.0.0" },
      workflow: emptyWorkflow(),
      nodeAgents: { a1: "missing-ref" },
      items: [
        {
          kind: "skill",
          ref: "skill-1",
          name: "Danger",
          description: "",
          entry: "SKILL.md",
          files: [
            { path: "SKILL.md", encoding: "utf8", content: "# Skill" },
            { path: "../evil.md", encoding: "utf8", content: "no" },
          ],
        },
      ],
      mcps: [{ name: "Kept", env: SECRET }, { name: "  " }, "nope"],
    });
    const parsed = parseSharliePackage(text);
    assert.equal(parsed.pkg.items.length, 1);
    assert.equal(parsed.pkg.items[0]?.name, "Danger");
    assert.deepEqual(parsed.pkg.items[0]?.files?.map((file) => file.path), ["SKILL.md"]);
    assert.deepEqual(parsed.warnings, ['Dropped unsafe file "../evil.md" from skill "Danger"']);
    assert.deepEqual(parsed.pkg.nodeAgents, {});
    assert.deepEqual(parsed.pkg.mcps, [{ name: "Kept" }]);
    assert.equal(JSON.stringify(parsed.pkg).includes(SECRET), false);
  });

  test("parseDependencies drops bad entries, unsafe paths, and duplicate names", () => {
    assert.equal(isSafeRelativePath(".sharlie/bundle/skills/review/SKILL.md"), true);
    assert.equal(isSafeRelativePath("rules/review.md"), true);
    assert.equal(isSafeRelativePath("../x"), false);
    assert.equal(isSafeRelativePath("/abs"), false);
    assert.equal(isSafeRelativePath("C:/x"), false);
    assert.equal(isSafeRelativePath("a\\b"), false);
    assert.equal(isSafeRelativePath(""), false);
    assert.equal(isSafeRelativePath("a/../b"), false);
    assert.equal(isSafeRelativePath("a/./b"), false);
    assert.equal(isSafeRelativePath("a//b"), false);
    assert.equal(isSafeRelativePath("a".repeat(240)), true);
    assert.equal(isSafeRelativePath("a".repeat(241)), false);
    assert.deepEqual(parseDependencies(null), []);
    assert.deepEqual(parseDependencies({}), []);

    const parsed = parseDependencies([
      null,
      { kind: "other", name: "Nope" },
      { kind: "skill", name: "   " },
      { kind: "skill", name: " Review ", description: "first", bundledPath: "../x" },
      {
        kind: "skill",
        name: "review",
        description: "second",
        bundledPath: ".sharlie/bundle/skills/review/SKILL.md",
      },
      { kind: "mcp", name: "Srv", description: "m", bundledPath: ".sharlie/bundle/ok.md" },
      { kind: "rule", name: "Review", description: 4, bundledPath: "rules/review.md" },
    ]);
    assert.deepEqual(parsed, [
      { kind: "skill", name: "Review", description: "first" },
      { kind: "mcp", name: "Srv", description: "m" },
      { kind: "rule", name: "Review", description: "", bundledPath: "rules/review.md" },
    ]);
    assert.equal("bundledPath" in (parsed[0] ?? {}), false);
    assert.equal("bundledPath" in (parsed[1] ?? {}), false);
  });

  test("normalizePipeline keeps dependencies only when the field is present", async () => {
    const body = {
      version: 1,
      name: "Demo",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nodes: [],
      edges: [],
    };
    const dependencies = [
      {
        kind: "skill",
        name: "Review",
        description: "d",
        bundledPath: ".sharlie/bundle/skills/review/SKILL.md",
      },
      { kind: "skill", name: "bad", bundledPath: "../x" },
    ];
    const kept = normalizePipeline({ ...body, dependencies }, "demo-1");
    assert.deepEqual(kept.dependencies, [
      {
        kind: "skill",
        name: "Review",
        description: "d",
        bundledPath: ".sharlie/bundle/skills/review/SKILL.md",
      },
      { kind: "skill", name: "bad", description: "" },
    ]);
    const absent = normalizePipeline(body, "demo-1");
    assert.equal("dependencies" in absent, false);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-deps-"));
    try {
      const saved = await writePipeline(dir, { ...body, dependencies }, "demo-1");
      assert.deepEqual(saved.dependencies, kept.dependencies);
      const loaded = await readPipeline(dir, "demo-1");
      assert.deepEqual(loaded?.dependencies, kept.dependencies);
      const bare = await writePipeline(dir, body, "demo-2");
      assert.equal("dependencies" in bare, false);
      const loadedBare = await readPipeline(dir, "demo-2");
      assert.ok(loadedBare);
      assert.equal("dependencies" in loadedBare, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

function emptyWorkflow(): PipelineDocument {
  return {
    version: 1,
    id: "demo-1",
    name: "Demo",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [],
    edges: [],
  };
}

async function buildSample(dir: string, includeFiles: boolean) {
  const workflowDir = path.join(dir, "workflow");
  const skillDir = path.join(dir, "skill");
  const ruleFile = path.join(dir, "rules", "review.md");
  const agentFile = path.join(workflowDir, "helper.md");
  await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
  await fs.mkdir(workflowDir, { recursive: true });
  await fs.mkdir(path.dirname(ruleFile), { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    ["---", "name: Code Review", "description: Reviews code", "---", "", "Review the diff.", ""].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(skillDir, "scripts", "run.py"), 'print("run")\n', "utf8");
  await fs.writeFile(
    ruleFile,
    ["---", "name: Review Rule", "description: A rule", "---", "", "Keep this rule.", ""].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    agentFile,
    ["---", "name: Helper", "description: Helps with the export", "---", "", "Do the work.", ""].join("\n"),
    "utf8",
  );
  const absoluteAgent = path.resolve(agentFile);
  const doc: PipelineDocument = {
    version: 1,
    id: "demo-1",
    name: "Demo Flow",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      {
        id: "a1",
        type: "agent",
        position: { x: 1, y: 2 },
        data: {
          modelId: "composer",
          agentPath: absoluteAgent,
          agentName: "Custom",
          status: "done",
          elapsedMs: 12,
          retryCount: 2,
          tokens: { input: 1, output: 2, total: 3 },
          lastOutput: "hello",
        },
      },
      {
        id: "a2",
        type: "agent",
        position: { x: 3, y: 4 },
        data: {
          modelId: "composer",
          agentPath: "helper.md",
          agentName: "",
          status: "error",
          elapsedMs: 9,
          retryCount: 1,
          tokens: { total: 4 },
          lastOutput: "again",
        },
      },
      {
        id: "h1",
        type: "human",
        position: { x: 5, y: 6 },
        data: { status: "approved", artifactPaths: ["out.txt"] },
      },
    ],
    edges: [{ id: "e1", source: "a1", target: "h1", kind: "execution" }],
    dependencies: [
      {
        kind: "skill",
        name: "Code Review",
        description: "duplicate",
        bundledPath: ".sharlie/bundle/skills/missing/SKILL.md",
      },
      { kind: "mcp", name: "Gamma", description: "g" },
      { kind: "mcp", name: "ALPHA", description: SECRET },
    ],
  };
  const result = await buildSharliePackage({
    doc,
    workflowDir,
    enabledSkills: [{ title: "Code Review", description: "Reviews code", path: path.join(skillDir, "SKILL.md") }],
    enabledRules: [{ title: "Review Rule", description: "A rule", path: ruleFile }],
    enabledMcpNames: ["Alpha", "beta"],
    includeFiles,
    appVersion: "9.9.9",
  });
  return { ...result, doc };
}
