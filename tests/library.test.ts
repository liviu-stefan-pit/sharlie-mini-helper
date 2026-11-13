import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  LibraryError,
  applyCatalog,
  buildCatalogPrompt,
  filterSelection,
  forgetImport,
  importLibraryItem,
  loadEnabledMcpConfigs,
  skillFileInFolder,
  readLibraryBody,
  readSelection,
  scanLibrary,
  writeSelection,
} from "../src/modules/library";

const TOKEN = "super-secret-token";
const HEADER = "header-secret-value";
const APP_SECRET = "app-library-secret-value";

describe("library selection and catalog", () => {
  test("omits disabled items, ignores missing ids, and catalogs only enabled skills and rules", async () => {
    const cursorHome = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-cursor-"));
    const appLibraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-app-"));
    const roots = { cursorHome, appLibraryRoot };
    try {
      await writeSkill(cursorHome, ["alpha"], "Alpha Skill", "Alpha does the alpha task");
      await writeSkill(cursorHome, ["nested", "beta"], "Beta Skill", "Beta should stay disabled");
      await writeRule(cursorHome, ["team", "keep.mdc"], "Keep Rule", "Keep this rule when it matches");
      await writeRule(cursorHome, ["drop.md"], "Drop Rule", "Drop this rule from the catalog");
      await fs.writeFile(
        path.join(cursorHome, "rules", "plain-title.mdc"),
        ["# Plain Title", "", "Plain paragraph stays here.", ""].join("\n"),
        "utf8",
      );
      await fs.writeFile(path.join(cursorHome, "rules", "just-name.md"), "Only a paragraph.\n", "utf8");

      const pluginSkill = path.join(cursorHome, "plugins", "demo", "SKILL.md");
      await fs.mkdir(path.dirname(pluginSkill), { recursive: true });
      await fs.writeFile(pluginSkill, skillDoc("Plugin Skill", "Hidden plugin"), "utf8");
      const workspaceSkill = path.join(cursorHome, ".cursor", "skills", "decoy", "SKILL.md");
      await fs.mkdir(path.dirname(workspaceSkill), { recursive: true });
      await fs.writeFile(workspaceSkill, skillDoc("Workspace Skill", "Hidden workspace skill"), "utf8");

      const first = await scanLibrary(roots);
      assert.equal(first.skills.some((item) => item.title === "Plugin Skill" || item.title === "Workspace Skill"), false);
      assert.equal(first.rules.some((item) => item.path.includes(`${path.sep}plugins${path.sep}`)), false);

      const alpha = first.skills.find((item) => item.title === "Alpha Skill");
      const beta = first.skills.find((item) => item.title === "Beta Skill");
      const keep = first.rules.find((item) => item.title === "Keep Rule");
      const drop = first.rules.find((item) => item.title === "Drop Rule");
      const plain = first.rules.find((item) => item.title === "Plain Title");
      const named = first.rules.find((item) => item.path.endsWith(`${path.sep}just-name.md`));
      assert.ok(alpha);
      assert.ok(beta);
      assert.ok(keep);
      assert.ok(drop);
      assert.ok(plain);
      assert.equal(plain.description, "Plain paragraph stays here.");
      assert.ok(named);
      assert.equal(named.title, "just-name.md");
      assert.equal(named.description, "Only a paragraph.");
      assert.equal(alpha.source, "cursor");
      assert.equal(alpha.enabled, false);

      const alphaBody = await readLibraryBody({ ...roots, id: alpha.id });
      assert.match(alphaBody.content, /Alpha Skill/);

      const requested = {
        skills: [alpha.id, "cursor:missing-skill"],
        rules: [keep.id],
        mcps: ["app:mcp:missing"],
      };
      await writeSelection(appLibraryRoot, requested);
      const stored = await readSelection(appLibraryRoot);
      assert.deepEqual(stored, requested);

      const snapshot = await scanLibrary(roots);
      const enabledAlpha = snapshot.skills.find((item) => item.id === alpha.id);
      const enabledBeta = snapshot.skills.find((item) => item.id === beta.id);
      const enabledKeep = snapshot.rules.find((item) => item.id === keep.id);
      const enabledDrop = snapshot.rules.find((item) => item.id === drop.id);
      assert.ok(enabledAlpha);
      assert.ok(enabledBeta);
      assert.ok(enabledKeep);
      assert.ok(enabledDrop);
      assert.equal(enabledAlpha.enabled, true);
      assert.equal(enabledBeta.enabled, false);
      assert.equal(enabledKeep.enabled, true);
      assert.equal(enabledDrop.enabled, false);
      assert.equal(snapshot.skills.some((item) => item.id === "cursor:missing-skill"), false);
      assert.equal(snapshot.mcps.some((item) => item.id === "app:mcp:missing"), false);

      const filtered = filterSelection(requested, snapshot);
      assert.deepEqual(filtered, { skills: [alpha.id], rules: [keep.id], mcps: [] });

      const enabledSkills = snapshot.skills.filter((item) => item.enabled);
      const enabledRules = snapshot.rules.filter((item) => item.enabled);
      assert.deepEqual(
        enabledSkills.map((item) => item.title),
        ["Alpha Skill"],
      );
      assert.deepEqual(
        enabledRules.map((item) => item.title),
        ["Keep Rule"],
      );

      const catalog = buildCatalogPrompt(enabledSkills, enabledRules);
      assert.match(
        catalog,
        /Use a skill only when its description matches the task\. Read that file before following it\. Do not use skills that are not listed\./,
      );
      assert.match(catalog, /Read a rule only when its description matches the task\. Do not follow rules that are not listed\./);
      assert.match(catalog, /Only the MCP servers attached to this run are valid; do not look for other MCP servers\./);
      assert.ok(catalog.includes(`- Alpha Skill: Alpha does the alpha task`));
      assert.ok(catalog.includes(`  File: ${enabledAlpha.path}`));
      assert.ok(catalog.includes(`- Keep Rule: Keep this rule when it matches`));
      assert.ok(catalog.includes(`  File: ${enabledKeep.path}`));
      assert.equal(catalog.includes("Beta Skill"), false);
      assert.equal(catalog.includes("Drop Rule"), false);
      assert.equal(catalog.includes("cursor:missing-skill"), false);
      assert.equal(catalog.includes("There are none."), false);

      const skillsOnly = buildCatalogPrompt(enabledSkills, []);
      assert.match(
        skillsOnly,
        /## Rules\nRead a rule only when its description matches the task\. Do not follow rules that are not listed\.\nThere are none\./,
      );
      assert.equal(skillsOnly.includes("Beta Skill"), false);

      const role = "Be careful.";
      assert.equal(applyCatalog(role, catalog), `${catalog}\n\n${role}`);

      await assert.rejects(
        () => forgetImport({ appLibraryRoot, id: alpha.id }),
        (error: unknown) => error instanceof LibraryError && error.status === 400,
      );
      const stillThere = await fs.readFile(alpha.path, "utf8");
      assert.match(stillThere, /Alpha Skill/);
    } finally {
      await fs.rm(cursorHome, { recursive: true, force: true });
      await fs.rm(appLibraryRoot, { recursive: true, force: true });
    }
  });

  test("keeps env off the snapshot and returns it only from loadEnabledMcpConfigs", async () => {
    const cursorHome = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-mcp-"));
    const appLibraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-mcp-app-"));
    const roots = { cursorHome, appLibraryRoot };
    try {
      const mcpPath = path.join(cursorHome, "mcp.json");
      await fs.writeFile(
        mcpPath,
        JSON.stringify({
          mcpServers: {
            local: { command: "echo", args: ["hi"], env: { TOKEN } },
            remote: { url: "https://example.test/mcp", headers: { Authorization: HEADER } },
          },
        }),
        "utf8",
      );

      const snapshot = await scanLibrary(roots);
      const listed = JSON.stringify(snapshot);
      assert.equal(listed.includes(TOKEN), false);
      assert.equal(listed.includes(HEADER), false);
      const local = snapshot.mcps.find((item) => item.name === "local");
      const remote = snapshot.mcps.find((item) => item.name === "remote");
      assert.ok(local);
      assert.ok(remote);
      assert.equal(local.source, "cursor");
      assert.equal(local.hasEnv, true);
      assert.deepEqual(local.transport, { type: "stdio", command: "echo", args: ["hi"], hasEnv: true });
      assert.equal(remote.hasEnv, false);
      assert.deepEqual(remote.transport, { type: "http", url: "https://example.test/mcp", hasEnv: false });

      await writeSelection(appLibraryRoot, {
        skills: [],
        rules: [],
        mcps: [local.id, "app:mcp:missing"],
      });
      const configs = await loadEnabledMcpConfigs(roots);
      assert.equal(configs.length, 1);
      assert.equal(configs[0]?.name, "local");
      assert.equal(configs[0]?.env.TOKEN, TOKEN);
      assert.equal(JSON.stringify(configs).includes(HEADER), false);
      const selected = await scanLibrary(roots);
      assert.equal(selected.mcps.find((item) => item.id === local.id)?.enabled, true);
      assert.equal(selected.mcps.find((item) => item.id === remote.id)?.enabled, false);
      assert.equal(selected.mcps.some((item) => item.id === "app:mcp:missing"), false);
      assert.equal(JSON.stringify(selected).includes(TOKEN), false);

      const mcpReal = await fs.realpath(mcpPath);
      await assert.rejects(
        () => readLibraryBody({ ...roots, id: `cursor:${mcpReal}` }),
        (error: unknown) => error instanceof LibraryError,
      );
      await assert.rejects(
        () => readLibraryBody({ ...roots, id: "app:../mcp.json" }),
        (error: unknown) => error instanceof LibraryError,
      );
    } finally {
      await fs.rm(cursorHome, { recursive: true, force: true });
      await fs.rm(appLibraryRoot, { recursive: true, force: true });
    }
  });
});

describe("skillFileInFolder", () => {
  test("resolves SKILL.md directly inside the folder", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-skill-file-"));
    const skillPath = path.join(dir, "SKILL.md");
    try {
      await fs.writeFile(skillPath, "# Skill\n", "utf8");
      assert.equal(await skillFileInFolder(dir), await fs.realpath(skillPath));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when the folder has no SKILL.md", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-skill-file-"));
    try {
      await fs.writeFile(path.join(dir, "README.md"), "notes\n", "utf8");
      await assert.rejects(
        () => skillFileInFolder(dir),
        (error: unknown) =>
          error instanceof LibraryError && error.status === 400 && error.message === "That folder has no SKILL.md",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("ignores a SKILL.md that is only inside a child folder", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-skill-file-"));
    try {
      const child = path.join(dir, "nested");
      await fs.mkdir(child);
      await fs.writeFile(path.join(child, "SKILL.md"), "# Nested\n", "utf8");
      await assert.rejects(
        () => skillFileInFolder(dir),
        (error: unknown) =>
          error instanceof LibraryError && error.status === 400 && error.message === "That folder has no SKILL.md",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when the folder is missing", async () => {
    const missing = path.join(os.tmpdir(), "sharlie-skill-file-missing", "does-not-exist");
    await assert.rejects(
      () => skillFileInFolder(missing),
      (error: unknown) => error instanceof LibraryError && error.status === 400 && error.message === "Folder not found",
    );
  });
});

describe("library import", () => {
  test("imports a markdown skill and an mdc rule without changing the source bytes", async () => {
    const cursorHome = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-cursor-"));
    const appParent = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-app-"));
    const sources = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-src-"));
    const appLibraryRoot = path.join(appParent, "library");
    const roots = { cursorHome, appLibraryRoot };
    const skillText = `${skillDoc("Imported Skill", "Imported skill description")}SKILL-BODY-MARKER\n`;
    const ruleText = `${skillDoc("Imported Rule", "Imported rule description")}RULE-BODY-MARKER\n`;
    const skillPath = path.join(sources, "notes.md");
    const rulePath = path.join(sources, "team.mdc");
    try {
      await fs.writeFile(skillPath, skillText, "utf8");
      await fs.writeFile(rulePath, ruleText, "utf8");
      const skillBefore = await fs.readFile(skillPath);
      const ruleBefore = await fs.readFile(rulePath);

      const skill = await importLibraryItem({ appLibraryRoot, kind: "skill", path: skillPath });
      const rule = await importLibraryItem({ appLibraryRoot, kind: "rule", path: rulePath });
      assert.equal(skill.source, "import");
      assert.equal(skill.enabled, true);
      assert.equal(skill.title, "Imported Skill");
      assert.equal(rule.source, "import");
      assert.equal(rule.enabled, true);
      assert.equal(rule.title, "Imported Rule");

      const snapshot = await scanLibrary(roots);
      const listedSkill = snapshot.skills.find((item) => item.id === skill.id);
      const listedRule = snapshot.rules.find((item) => item.id === rule.id);
      assert.ok(listedSkill);
      assert.ok(listedRule);
      assert.equal(listedSkill.source, "import");
      assert.equal(listedSkill.enabled, true);
      assert.equal(listedSkill.description, "Imported skill description");
      assert.equal(listedRule.source, "import");
      assert.equal(listedRule.enabled, true);
      assert.equal(listedRule.description, "Imported rule description");

      assert.deepEqual(await fs.readFile(skillPath), skillBefore);
      assert.deepEqual(await fs.readFile(rulePath), ruleBefore);
      const skillBody = await readLibraryBody({ ...roots, id: skill.id });
      assert.equal(skillBody.content, skillText);

      const stored = JSON.parse(await fs.readFile(path.join(appLibraryRoot, "imports.json"), "utf8")) as {
        skills: string[];
        rules: string[];
      };
      const skillReal = await fs.realpath(skillPath);
      const ruleReal = await fs.realpath(rulePath);
      assert.deepEqual(stored.skills, [skillReal]);
      assert.deepEqual(stored.rules, [ruleReal]);
      const importsText = await fs.readFile(path.join(appLibraryRoot, "imports.json"), "utf8");
      assert.equal(importsText.includes("SKILL-BODY-MARKER"), false);
      assert.equal(importsText.includes("RULE-BODY-MARKER"), false);
      const names = await fs.readdir(appLibraryRoot);
      assert.deepEqual(names.sort(), ["imports.json", "selection.json"]);
    } finally {
      await fs.rm(cursorHome, { recursive: true, force: true });
      await fs.rm(appParent, { recursive: true, force: true });
      await fs.rm(sources, { recursive: true, force: true });
    }
  });

  test("rejects a directory, a missing path, a skill .mdc path, and a rule with the wrong extension", async () => {
    const appLibraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-reject-"));
    const sources = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-reject-src-"));
    const directory = path.join(sources, "folder.md");
    const missing = path.join(sources, "missing.md");
    const skillMdc = path.join(sources, "skill.mdc");
    const ruleText = path.join(sources, "note.txt");
    try {
      await fs.mkdir(directory);
      await fs.writeFile(skillMdc, skillDoc("Nope", "Not a skill"), "utf8");
      await fs.writeFile(ruleText, "not a rule\n", "utf8");
      const mdcBefore = await fs.readFile(skillMdc);
      const textBefore = await fs.readFile(ruleText);

      await assert.rejects(
        () => importLibraryItem({ appLibraryRoot, kind: "skill", path: directory }),
        (error: unknown) => error instanceof LibraryError && error.status === 400,
      );
      await assert.rejects(
        () => importLibraryItem({ appLibraryRoot, kind: "skill", path: missing }),
        (error: unknown) => error instanceof LibraryError && error.status === 400,
      );
      await assert.rejects(
        () => importLibraryItem({ appLibraryRoot, kind: "skill", path: skillMdc }),
        (error: unknown) => error instanceof LibraryError && error.status === 400,
      );
      await assert.rejects(
        () => importLibraryItem({ appLibraryRoot, kind: "rule", path: ruleText }),
        (error: unknown) => error instanceof LibraryError && error.status === 400,
      );

      await assert.rejects(() => fs.stat(path.join(appLibraryRoot, "imports.json")), (error: unknown) => {
        return (error as NodeJS.ErrnoException).code === "ENOENT";
      });
      assert.deepEqual(await fs.readFile(skillMdc), mdcBefore);
      assert.deepEqual(await fs.readFile(ruleText), textBefore);
    } finally {
      await fs.rm(appLibraryRoot, { recursive: true, force: true });
      await fs.rm(sources, { recursive: true, force: true });
    }
  });

  test("remove forgets the imported path and leaves the source file in place", async () => {
    const cursorHome = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-cursor-"));
    const appLibraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-app-"));
    const sources = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-src-"));
    const roots = { cursorHome, appLibraryRoot };
    const skillPath = path.join(sources, "keep.md");
    const rulePath = path.join(sources, "keep.mdc");
    try {
      await fs.writeFile(skillPath, skillDoc("Kept Skill", "Stay on disk"), "utf8");
      await fs.writeFile(rulePath, skillDoc("Kept Rule", "Stay listed"), "utf8");
      const before = await fs.readFile(skillPath);
      const skill = await importLibraryItem({ appLibraryRoot, kind: "skill", path: skillPath });
      const rule = await importLibraryItem({ appLibraryRoot, kind: "rule", path: rulePath });

      await forgetImport({ appLibraryRoot, id: skill.id });
      assert.deepEqual(await fs.readFile(skillPath), before);
      const snapshot = await scanLibrary(roots);
      assert.equal(snapshot.skills.some((item) => item.id === skill.id), false);
      assert.equal(snapshot.rules.some((item) => item.id === rule.id), true);
      const selection = await readSelection(appLibraryRoot);
      assert.equal(selection.skills.includes(skill.id), false);
      const stored = JSON.parse(await fs.readFile(path.join(appLibraryRoot, "imports.json"), "utf8")) as {
        skills: string[];
        rules: string[];
      };
      assert.deepEqual(stored.skills, []);
      assert.equal(stored.rules.length, 1);

      await assert.rejects(
        () => forgetImport({ appLibraryRoot, id: skill.id }),
        (error: unknown) => error instanceof LibraryError && error.status === 400,
      );
      assert.deepEqual(await fs.readFile(skillPath), before);
    } finally {
      await fs.rm(cursorHome, { recursive: true, force: true });
      await fs.rm(appLibraryRoot, { recursive: true, force: true });
      await fs.rm(sources, { recursive: true, force: true });
    }
  });

  test("scans cursor skills, rules, and mcp.json and ignores an app-library mcp.json", async () => {
    const cursorHome = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-cursor-"));
    const appLibraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-app-"));
    const roots = { cursorHome, appLibraryRoot };
    try {
      await writeSkill(cursorHome, ["visible"], "Cursor Skill", "From the cursor home");
      await writeRule(cursorHome, ["visible.mdc"], "Cursor Rule", "From the cursor rules folder");
      await fs.writeFile(
        path.join(cursorHome, "mcp.json"),
        JSON.stringify({ mcpServers: { local: { command: "echo", args: ["hi"], env: { TOKEN } } } }),
        "utf8",
      );
      await fs.mkdir(path.join(appLibraryRoot, "skills", "hidden"), { recursive: true });
      await fs.writeFile(
        path.join(appLibraryRoot, "skills", "hidden", "SKILL.md"),
        skillDoc("Hidden App Skill", "Must not be scanned"),
        "utf8",
      );
      await fs.mkdir(path.join(appLibraryRoot, "rules"), { recursive: true });
      await fs.writeFile(
        path.join(appLibraryRoot, "rules", "hidden.mdc"),
        skillDoc("Hidden App Rule", "Must not be scanned"),
        "utf8",
      );
      await fs.writeFile(
        path.join(appLibraryRoot, "mcp.json"),
        JSON.stringify({ mcpServers: { "app-only": { command: "app-cmd", env: { APP_TOKEN: APP_SECRET } } } }),
        "utf8",
      );

      const snapshot = await scanLibrary(roots);
      assert.equal(snapshot.skills.some((item) => item.title === "Cursor Skill"), true);
      assert.equal(snapshot.rules.some((item) => item.title === "Cursor Rule"), true);
      assert.equal(snapshot.mcps.some((item) => item.name === "local"), true);
      assert.equal(snapshot.skills.some((item) => item.title === "Hidden App Skill"), false);
      assert.equal(snapshot.rules.some((item) => item.title === "Hidden App Rule"), false);
      assert.equal(snapshot.mcps.some((item) => item.name === "app-only"), false);
      assert.equal(JSON.stringify(snapshot).includes(APP_SECRET), false);
      assert.equal(JSON.stringify(snapshot).includes(TOKEN), false);

      const local = snapshot.mcps.find((item) => item.name === "local");
      assert.ok(local);
      await writeSelection(appLibraryRoot, { skills: [], rules: [], mcps: [local.id, "app:mcp:app-only"] });
      const configs = await loadEnabledMcpConfigs(roots);
      assert.equal(configs.length, 1);
      assert.equal(configs[0]?.name, "local");
      assert.equal(configs[0]?.source, "cursor");
      assert.equal(configs[0]?.env.TOKEN, TOKEN);
      assert.equal(JSON.stringify(configs).includes(APP_SECRET), false);
      assert.equal(configs.some((item) => item.name === "app-only"), false);
    } finally {
      await fs.rm(cursorHome, { recursive: true, force: true });
      await fs.rm(appLibraryRoot, { recursive: true, force: true });
    }
  });

  test("lists a cursor file once when that path is also imported", async () => {
    const cursorHome = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-cursor-"));
    const appLibraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-app-"));
    const roots = { cursorHome, appLibraryRoot };
    try {
      await writeSkill(cursorHome, ["shared"], "Shared Skill", "Already in Cursor");
      const first = await scanLibrary(roots);
      const cursorRow = first.skills.find((item) => item.title === "Shared Skill");
      assert.ok(cursorRow);
      await fs.writeFile(
        path.join(appLibraryRoot, "imports.json"),
        `${JSON.stringify({ skills: [cursorRow.path], rules: [] }, null, 2)}\n`,
        "utf8",
      );
      const snapshot = await scanLibrary(roots);
      const rows = snapshot.skills.filter((item) => item.title === "Shared Skill");
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.source, "cursor");
      assert.equal(rows[0]?.id, cursorRow.id);
    } finally {
      await fs.rm(cursorHome, { recursive: true, force: true });
      await fs.rm(appLibraryRoot, { recursive: true, force: true });
    }
  });

  test("keeps a missing import path so it can be removed", async () => {
    const cursorHome = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-cursor-"));
    const appLibraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-app-"));
    const sources = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-library-src-"));
    const roots = { cursorHome, appLibraryRoot };
    const missing = path.join(sources, "gone.md");
    try {
      await fs.writeFile(
        path.join(appLibraryRoot, "imports.json"),
        `${JSON.stringify({ skills: [missing], rules: [] }, null, 2)}\n`,
        "utf8",
      );
      const snapshot = await scanLibrary(roots);
      const row = snapshot.skills.find((item) => item.path === missing);
      assert.ok(row);
      assert.equal(row.source, "import");
      assert.equal(row.title, missing);
      assert.equal(row.description, "");
      await forgetImport({ appLibraryRoot, id: row.id });
      const after = await scanLibrary(roots);
      assert.equal(after.skills.some((item) => item.id === row.id), false);
    } finally {
      await fs.rm(cursorHome, { recursive: true, force: true });
      await fs.rm(appLibraryRoot, { recursive: true, force: true });
      await fs.rm(sources, { recursive: true, force: true });
    }
  });
});

async function writeSkill(cursorHome: string, segments: string[], name: string, description: string): Promise<void> {
  const dir = path.join(cursorHome, "skills", ...segments);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), skillDoc(name, description), "utf8");
}

async function writeRule(
  cursorHome: string,
  segments: string[],
  name: string,
  description: string,
): Promise<void> {
  const file = path.join(cursorHome, "rules", ...segments);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, skillDoc(name, description), "utf8");
}

function skillDoc(name: string, description: string): string {
  return ["---", `name: ${name}`, `description: ${description}`, "---", ""].join("\n");
}
