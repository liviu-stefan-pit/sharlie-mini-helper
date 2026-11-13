import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { AgentFileError, agentBody, describeAgentFile, scanAgents } from "../src/modules/agents/agentFile";

describe("agent files", () => {
  test("reads a markdown body and strips YAML frontmatter", () => {
    const withFrontmatter = ["---", "name: Reviewer", "description: Reviews diffs", "---", "", "Review the change.", ""].join(
      "\n",
    );
    assert.equal(agentBody(withFrontmatter), "Review the change.");
    assert.equal(agentBody("\uFEFF  Whole file.\n"), "Whole file.");
  });

  test("lists only top-level markdown files under a cursor home agents folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-agents-"));
    try {
      const agents = path.join(root, "agents");
      await fs.mkdir(path.join(agents, "nested"), { recursive: true });
      await fs.writeFile(
        path.join(agents, "review.md"),
        ["---", "name: Reviewer", "description: Reviews diffs", "---", "", "Review the change.", ""].join("\n"),
        "utf8",
      );
      await fs.writeFile(path.join(agents, "plain.md"), "Just the body.\n", "utf8");
      await fs.writeFile(path.join(agents, "notes.txt"), "skip me\n", "utf8");
      await fs.writeFile(path.join(agents, "nested", "hidden.md"), "hidden\n", "utf8");
      await fs.mkdir(path.join(agents, "folder.md"), { recursive: true });

      const listed = await scanAgents(root);
      assert.deepEqual(
        listed.map((agent) => agent.name),
        ["plain", "Reviewer"],
      );
      const reviewer = listed.find((agent) => agent.name === "Reviewer");
      const plain = listed.find((agent) => agent.name === "plain");
      assert.ok(reviewer);
      assert.equal(reviewer.description, "Reviews diffs");
      assert.equal(reviewer.path, await fs.realpath(path.join(agents, "review.md")));
      assert.ok(plain);
      assert.equal(plain.description, "Just the body.");
      assert.equal(
        listed.some((agent) => agent.path.includes(`${path.sep}nested${path.sep}`) || agent.name === "hidden"),
        false,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a directory and a non-md extension", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-agents-validate-"));
    try {
      const folder = path.join(root, "folder.md");
      const text = path.join(root, "notes.txt");
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(text, "not markdown\n", "utf8");

      await assert.rejects(() => describeAgentFile(folder), (error: unknown) => {
        assert.ok(error instanceof AgentFileError);
        assert.equal(error.message, "Agent file must be an existing .md file");
        return true;
      });
      await assert.rejects(() => describeAgentFile(text), (error: unknown) => {
        assert.ok(error instanceof AgentFileError);
        assert.equal(error.message, "Agent file must be an existing .md file");
        return true;
      });
      await assert.rejects(() => describeAgentFile(root), AgentFileError);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
