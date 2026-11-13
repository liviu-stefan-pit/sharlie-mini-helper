import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { parseSkillMarkdown } from "../src/modules/skills/parseSkill";
import { scanSkills } from "../src/modules/skills/scanSkills";

describe("parseSkillMarkdown", () => {
  test("reads frontmatter name and description, quoted or plain", () => {
    const quoted = parseSkillMarkdown(
      ["---", 'name: "Quoted Name"', 'description: "Quoted description"', "---", "# Other heading", "", "Other paragraph"].join(
        "\n",
      ),
      "skills/quoted/SKILL.md",
    );
    assert.equal(quoted.title, "Quoted Name");
    assert.equal(quoted.description, "Quoted description");
    assert.equal(quoted.skillPath, "skills/quoted/SKILL.md");

    const plain = parseSkillMarkdown(
      ["---", "name: Plain Name", "description: Plain description", "---", ""].join("\n"),
      "skills/plain/SKILL.md",
    );
    assert.equal(plain.title, "Plain Name");
    assert.equal(plain.description, "Plain description");
    assert.equal(plain.skillPath, "skills/plain/SKILL.md");
  });

  test("falls back to the first heading and following paragraph, and clips at 240 characters", () => {
    const paragraph = "Sentence one stays. ".repeat(20).trim();
    assert.ok(paragraph.length > 240);
    const parsed = parseSkillMarkdown(
      ["# Fallback Title", "", paragraph, ""].join("\n"),
      "skills/fallback/SKILL.md",
    );
    assert.equal(parsed.title, "Fallback Title");
    assert.equal(parsed.skillPath, "skills/fallback/SKILL.md");
    assert.ok(parsed.description.length <= 240);
    assert.ok(parsed.description.length > 0);
    assert.ok(paragraph.startsWith(parsed.description));
  });
});

describe("scanSkills", () => {
  test("discovers user-level SKILL.md files from an injectable cursor home", async () => {
    const cursorHome = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-skills-"));
    try {
      const skillDir = path.join(cursorHome, "skills", "fixture-skill");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        ["---", "name: Phase4 Fixture Skill", "description: Fixture description", "---", ""].join("\n"),
        "utf8",
      );
      const decoyDir = path.join(cursorHome, ".cursor", "skills", "decoy-skill");
      await fs.mkdir(decoyDir, { recursive: true });
      await fs.writeFile(
        path.join(decoyDir, "SKILL.md"),
        ["---", "name: Decoy Skill", "description: Should stay hidden", "---", ""].join("\n"),
        "utf8",
      );
      const pluginDir = path.join(cursorHome, "plugins", "demo", "skills", "plugin-skill");
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(
        path.join(pluginDir, "SKILL.md"),
        ["---", "name: Plugin Skill", "description: Should stay hidden", "---", ""].join("\n"),
        "utf8",
      );

      const skills = await scanSkills(cursorHome);
      assert.equal(skills.length, 1);
      const found = skills[0];
      assert.ok(found);
      assert.equal(found.title, "Phase4 Fixture Skill");
      assert.equal(found.description, "Fixture description");
      assert.ok(found.skillPath.endsWith(`${path.sep}SKILL.md`) || found.skillPath.endsWith("SKILL.md"));
      assert.ok(found.skillPath.includes(path.join("skills", "fixture-skill")));
      assert.equal(
        skills.some((skill) => skill.title === "Decoy Skill" || skill.title === "Plugin Skill"),
        false,
      );
    } finally {
      await fs.rm(cursorHome, { recursive: true, force: true });
    }
  });
});
