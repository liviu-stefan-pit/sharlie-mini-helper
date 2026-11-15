import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { snapshotFiles } from "../src/modules/artifacts/track";
import type { PipelineDocument } from "../src/modules/graph/types";
import {
  PipelineValidationError,
  listPipelines,
  newPipelineId,
  normalizePipeline,
  readPipeline,
  workflowDir,
  writePipeline,
} from "../src/modules/storage/pipelines";

function document(id: string, name = "Flow"): PipelineDocument {
  return {
    version: 1,
    id,
    name,
    nodes: [
      {
        id: "agent-1",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          modelId: "auto",
          effort: "",
          effortParamId: "",
          agentPath: "agents/a.md",
          agentName: "",
          status: "idle",
          elapsedMs: 0,
          retryCount: 0,
          tokens: {},
        },
      },
      {
        id: "human-1",
        type: "human",
        position: { x: 0, y: 0 },
        data: { status: "idle", artifactPaths: [] },
      },
    ],
    edges: [{ id: "e1", source: "agent-1", target: "human-1", kind: "execution" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("workflow folder storage", () => {
  test("writes workflow.json and leaves no temp file", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-pipelines-"));
    try {
      const saved = await writePipeline(tmp, document("flow-a", "Flow A"), "flow-a");
      const file = path.join(tmp, "flow-a", ".sharlie", "workflow.json");
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as { id: string; name: string };
      assert.equal(parsed.id, "flow-a");
      assert.equal(parsed.name, "Flow A");
      assert.equal(saved.id, "flow-a");
      await assert.rejects(fs.access(path.join(tmp, "flow-a", ".sharlie", "workflow.json.tmp")));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("lists the saved workflow", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-pipelines-"));
    try {
      const saved = await writePipeline(tmp, document("flow-a", "Flow A"), "flow-a");
      const listed = await listPipelines(tmp);
      assert.deepEqual(listed, [{ id: saved.id, name: saved.name, updatedAt: saved.updatedAt }]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("ignores folders and files that are not a workflow", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-pipelines-"));
    try {
      await writePipeline(tmp, document("flow-a", "Flow A"), "flow-a");
      await fs.mkdir(path.join(tmp, "lonely"));
      await fs.mkdir(path.join(tmp, "bad name", ".sharlie"), { recursive: true });
      await fs.writeFile(
        path.join(tmp, "bad name", ".sharlie", "workflow.json"),
        `${JSON.stringify(document("bad name"), null, 2)}\n`,
        "utf8",
      );
      await fs.writeFile(path.join(tmp, "notes.txt"), "plain\n", "utf8");
      await fs.mkdir(path.join(tmp, "broken", ".sharlie"), { recursive: true });
      await fs.writeFile(path.join(tmp, "broken", ".sharlie", "workflow.json"), "{", "utf8");

      const listed = await listPipelines(tmp);
      assert.deepEqual(
        listed.map((item) => item.id),
        ["flow-a"],
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("returns null when the workflow file is missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-pipelines-"));
    try {
      assert.equal(await readPipeline(tmp, "missing"), null);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("rejects an unsafe pipeline id", () => {
    assert.throws(
      () => workflowDir(os.tmpdir(), "../evil"),
      (error: unknown) => {
        assert.ok(error instanceof PipelineValidationError);
        assert.equal(error.message, "Invalid pipeline id");
        return true;
      },
    );
  });

  test("loads a missing effort as blank and keeps a saved effort", () => {
    const base = {
      version: 1,
      name: "Flow",
      nodes: [
        {
          id: "agent-1",
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            modelId: "auto",
            agentPath: "agents/a.md",
            agentName: "",
            status: "idle",
            elapsedMs: 0,
            retryCount: 0,
            tokens: {},
          },
        },
      ],
      edges: [],
    };
    const missing = normalizePipeline(base, "flow-a");
    const missingNode = missing.nodes[0];
    assert.equal(missingNode?.type, "agent");
    if (missingNode?.type === "agent") {
      assert.equal(missingNode.data.effort, "");
      assert.equal(missingNode.data.effortParamId, "");
    }

    const saved = normalizePipeline(
      {
        ...base,
        nodes: [
          {
            ...base.nodes[0],
            data: { ...base.nodes[0].data, effort: "high", effortParamId: "reasoning_effort" },
          },
        ],
      },
      "flow-a",
    );
    const savedNode = saved.nodes[0];
    assert.equal(savedNode?.type, "agent");
    if (savedNode?.type === "agent") {
      assert.equal(savedNode.data.effort, "high");
      assert.equal(savedNode.data.effortParamId, "reasoning_effort");
    }
  });

  test("builds a slug id from the workflow name", () => {
    assert.match(newPipelineId("My Flow!"), /^my-flow-[0-9a-f]{8}$/);
  });

  test("skips the .sharlie meta folder when snapshotting files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-pipelines-"));
    try {
      await fs.mkdir(path.join(tmp, ".sharlie"), { recursive: true });
      await fs.writeFile(path.join(tmp, ".sharlie", "workflow.json"), "{}\n", "utf8");
      await fs.writeFile(path.join(tmp, "out.md"), "hello\n", "utf8");
      const found = await snapshotFiles(tmp);
      assert.deepEqual([...found.keys()], ["out.md"]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
