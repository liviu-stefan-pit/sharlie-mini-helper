import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GraphError, resolvePipeline } from "../src/modules/graph/resolve";
import type { PipelineDocument, PipelineEdge, PipelineNode } from "../src/modules/graph/types";
import { normalizePipeline } from "../src/modules/storage/pipelines";

function document(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineDocument {
  return {
    version: 1,
    id: "pipeline",
    name: "Pipeline",
    nodes,
    edges,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function agent(id: string, agentPath: string, modelId = "auto"): PipelineNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      modelId,
      agentPath,
      agentName: "",
      status: "idle",
      elapsedMs: 0,
      retryCount: 0,
      tokens: {},
    },
  };
}

function human(id: string): PipelineNode {
  return {
    id,
    type: "human",
    position: { x: 0, y: 0 },
    data: { status: "idle", artifactPaths: [] },
  };
}

function edge(id: string, source: string, target: string): PipelineEdge {
  return { id, source, target, kind: "execution" };
}

describe("resolvePipeline", () => {
  test("orders agent and human steps and keeps the agent path", () => {
    const steps = resolvePipeline(
      document(
        [human("human-1"), agent("agent-b", "agents/b.md"), agent("agent-a", "agents/a.md")],
        [edge("ab", "agent-a", "agent-b"), edge("bh", "agent-b", "human-1")],
      ),
    );

    assert.deepEqual(
      steps.map((step) => ({ kind: step.kind, nodeId: step.nodeId })),
      [
        { kind: "agent", nodeId: "agent-a" },
        { kind: "agent", nodeId: "agent-b" },
        { kind: "human", nodeId: "human-1" },
      ],
    );
    const first = steps[0];
    const second = steps[1];
    assert.equal(first?.kind, "agent");
    assert.equal(second?.kind, "agent");
    if (first?.kind !== "agent" || second?.kind !== "agent") return;
    assert.equal(first.agentPath, "agents/a.md");
    assert.equal(second.agentPath, "agents/b.md");
    assert.equal(first.modelId, "auto");
    assert.equal("prompt" in first, false);
    assert.doesNotMatch(first.agentPath, /## Skills/);
    assert.doesNotMatch(second.agentPath, /## Skills/);
  });

  test("allows an empty agent path and rejects an empty model id", () => {
    const steps = resolvePipeline(document([agent("agent-1", "")], []));
    const step = steps[0];
    assert.equal(step?.kind, "agent");
    if (step?.kind === "agent") {
      assert.equal(step.agentPath, "");
      assert.equal(step.modelId, "auto");
    }
    assert.throws(
      () => resolvePipeline(document([agent("agent-2", "agents/a.md", "  ")], [])),
      (error: unknown) => {
        assert.ok(error instanceof GraphError);
        assert.equal(error.message, "Model id is empty");
        return true;
      },
    );
  });

  test("throws GraphError when two agents cycle", () => {
    assert.throws(
      () =>
        resolvePipeline(
          document(
            [agent("agent-a", "agents/a.md"), agent("agent-b", "agents/b.md")],
            [edge("forward", "agent-a", "agent-b"), edge("back", "agent-b", "agent-a")],
          ),
        ),
      (error: unknown) => {
        assert.ok(error instanceof GraphError);
        assert.match(error.message, /Cycle in pipeline/);
        return true;
      },
    );
  });

  test("rejects a skill node that is still in the document", () => {
    const skillNode = {
      id: "skill-1",
      type: "skill",
      position: { x: 0, y: 0 },
      data: {
        source: "custom",
        skillPath: "skill-1/SKILL.md",
        title: "Loose",
        description: "Skill description",
      },
    };
    assert.throws(
      () => resolvePipeline(document([agent("agent-1", "agents/a.md"), skillNode as unknown as PipelineNode], [])),
      (error: unknown) => {
        assert.ok(error instanceof GraphError);
        assert.match(error.message, /Unknown node type/);
        return true;
      },
    );
  });

  test("rejects an attachment edge", () => {
    const attached = {
      id: "attach",
      source: "agent-a",
      target: "agent-b",
      kind: "attachment",
    };
    assert.throws(
      () =>
        resolvePipeline(
          document([agent("agent-a", "agents/a.md"), agent("agent-b", "agents/b.md")], [attached as unknown as PipelineEdge]),
        ),
      (error: unknown) => {
        assert.ok(error instanceof GraphError);
        assert.match(error.message, /Attachment edges are not supported/);
        return true;
      },
    );
  });
});

describe("normalizePipeline", () => {
  test("drops skill nodes, attachment edges, and edges with missing endpoints", () => {
    const doc = normalizePipeline(
      {
        version: 1,
        name: "Legacy",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [
          {
            id: "agent-1",
            type: "agent",
            position: { x: 0, y: 0 },
            data: {
              modelId: "auto",
              customModelId: "other",
              prompt: "  Role A  ",
              status: "idle",
              elapsedMs: 0,
              retryCount: 0,
              tokens: {},
            },
          },
          { id: "skill-1", type: "skill", position: { x: 1, y: 2 } },
          {
            id: "human-1",
            type: "human",
            position: { x: 0, y: 0 },
            data: { status: "idle", notes: "old notes", artifactPaths: [] },
          },
        ],
        edges: [
          edge("run", "agent-1", "human-1"),
          { id: "attach", source: "skill-1", target: "agent-1", kind: "attachment" },
          { id: "dangling", source: "agent-1", target: "missing", kind: "execution" },
        ],
      },
      "pipeline",
    );

    assert.equal(doc.version, 1);
    assert.deepEqual(
      doc.nodes.map((node) => node.type),
      ["agent", "human"],
    );
    assert.deepEqual(
      doc.nodes.map((node) => node.id),
      ["agent-1", "human-1"],
    );
    assert.deepEqual(doc.edges, [edge("run", "agent-1", "human-1")]);

    const steps = resolvePipeline(doc);
    assert.deepEqual(
      steps.map((step) => ({ kind: step.kind, nodeId: step.nodeId })),
      [
        { kind: "agent", nodeId: "agent-1" },
        { kind: "human", nodeId: "human-1" },
      ],
    );
    const loaded = doc.nodes[0];
    const humanNode = doc.nodes[1];
    assert.equal(loaded?.type, "agent");
    assert.equal(humanNode?.type, "human");
    if (loaded?.type === "agent") {
      assert.equal(loaded.data.agentPath, "");
      assert.equal(loaded.data.agentName, "");
      assert.equal("prompt" in loaded.data, false);
      assert.equal("customModelId" in loaded.data, false);
    }
    if (humanNode?.type === "human") {
      assert.equal("notes" in humanNode.data, false);
    }

    const step = steps[0];
    assert.equal(step?.kind, "agent");
    if (step?.kind === "agent") {
      assert.equal(step.agentPath, "");
      assert.equal("prompt" in step, false);
      assert.doesNotMatch(step.agentPath, /## Skills/);
    }
  });
});
