import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultEffort, effortListing, modelSelection } from "../src/modules/cursor/models";
import { GraphError, resolvePipeline } from "../src/modules/graph/resolve";
import { graphShape, reviewSources, wouldCreateCycle } from "../src/modules/graph/topology";
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

function agent(
  id: string,
  agentPath: string,
  modelId = "auto",
  effort = "",
  effortParamId = "",
): PipelineNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      modelId,
      effort,
      effortParamId,
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
      assert.equal(step.effort, "");
      assert.equal(step.effortParamId, "");
      assert.equal("prompt" in step, false);
      assert.doesNotMatch(step.agentPath, /## Skills/);
    }
  });
});

describe("effort", () => {
  test("puts a saved effort on the agent step and trims it", () => {
    const steps = resolvePipeline(
      document([agent("agent-1", "agents/a.md", "grok-4.7", "  high  ", "  reasoning_effort  ")], []),
    );
    const step = steps[0];
    assert.equal(step?.kind, "agent");
    if (step?.kind === "agent") {
      assert.equal(step.effort, "high");
      assert.equal(step.effortParamId, "reasoning_effort");
    }
  });

  test("resolves a missing effort to an empty string", () => {
    const doc = normalizePipeline(
      {
        version: 1,
        name: "Pipeline",
        updatedAt: "2026-01-01T00:00:00.000Z",
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
      },
      "pipeline",
    );
    const node = doc.nodes[0];
    assert.equal(node?.type, "agent");
    if (node?.type === "agent") {
      assert.equal(node.data.effort, "");
      assert.equal(node.data.effortParamId, "");
    }
    const step = resolvePipeline(doc)[0];
    assert.equal(step?.kind, "agent");
    if (step?.kind === "agent") {
      assert.equal(step.effort, "");
      assert.equal(step.effortParamId, "");
    }
  });

  test("defaultEffort prefers medium, otherwise the earlier center value", () => {
    assert.equal(defaultEffort([{ value: "low" }, { value: "medium" }, { value: "high" }]), "medium");
    assert.equal(defaultEffort([{ value: "low" }, { value: "high" }, { value: "xhigh" }]), "high");
    assert.equal(defaultEffort([{ value: "low" }, { value: "high" }]), "low");
    assert.equal(defaultEffort([]), "");
  });

  test("modelSelection omits params when effort is blank", () => {
    assert.deepEqual(modelSelection("composer", ""), { id: "composer" });
    assert.deepEqual(modelSelection("composer", "   "), { id: "composer" });
    assert.deepEqual(modelSelection("composer", "high"), {
      id: "composer",
      params: [{ id: "effort", value: "high" }],
    });
    assert.deepEqual(modelSelection("grok-4.6", "high", "effort"), {
      id: "grok-4.6",
      params: [{ id: "effort", value: "high" }],
    });
    assert.deepEqual(modelSelection("grok-4.7", "high", "reasoning_effort"), {
      id: "grok-4.7",
      params: [{ id: "reasoning_effort", value: "high" }],
    });
    assert.deepEqual(modelSelection("grok-4.7", "high", "   "), {
      id: "grok-4.7",
      params: [{ id: "effort", value: "high" }],
    });
  });

  test("effortListing reads Effort by display name and ignores other parameters", () => {
    const listing = effortListing({
      parameters: [
        {
          id: "context",
          displayName: "Context",
          values: [{ value: "256k", displayName: "256K" }],
        },
        {
          id: "reasoning_effort",
          displayName: "Effort",
          values: [
            { value: "low", displayName: "Low" },
            { value: "medium", displayName: "Medium" },
            { value: "high", displayName: "High" },
            { value: "xhigh", displayName: "Extra High" },
          ],
        },
        {
          id: "fast",
          displayName: "Fast",
          values: [{ value: "false" }, { value: "true", displayName: "Fast" }],
        },
      ],
    });
    assert.equal(listing.paramId, "reasoning_effort");
    assert.deepEqual(
      listing.choices.map((choice) => choice.value),
      ["low", "medium", "high", "xhigh"],
    );
    assert.equal(listing.choices[3]?.label, "Extra High");
  });

  test("effortListing keeps a parameter whose id is effort", () => {
    const listing = effortListing({
      parameters: [
        {
          id: "effort",
          displayName: "Effort",
          values: [
            { value: "low", displayName: "Low" },
            { value: "medium", displayName: "Medium" },
            { value: "high", displayName: "High" },
          ],
        },
        { id: "fast", displayName: "Fast", values: [{ value: "true", displayName: "Fast" }] },
      ],
    });
    assert.equal(listing.paramId, "effort");
    assert.deepEqual(listing.choices, [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ]);
  });

  test("effortListing reads effort values that exist only on variants", () => {
    const listing = effortListing({
      variants: [
        { params: [{ id: "fast", value: "false" }, { id: "reasoning_effort", value: "low" }] },
        { params: [{ id: "reasoning_effort", value: "medium" }, { id: "context", value: "256k" }] },
        { params: [{ id: "reasoning_effort", value: "low" }, { id: "fast", value: "true" }] },
      ],
    });
    assert.equal(listing.paramId, "reasoning_effort");
    assert.deepEqual(listing.choices, [
      { value: "low", label: "low" },
      { value: "medium", label: "medium" },
    ]);
  });

  test("effortListing returns nothing when the catalog has no effort parameter", () => {
    assert.deepEqual(
      effortListing({
        parameters: [{ id: "fast", displayName: "Fast", values: [{ value: "true", displayName: "Fast" }] }],
        variants: [{ params: [{ id: "fast", value: "true" }, { id: "context", value: "256k" }] }],
      }),
      { paramId: "", choices: [] },
    );
  });
});

describe("fan-in inputs", () => {
  test("a join step lists every distinct input in step order", () => {
    const steps = resolvePipeline(
      document(
        [agent("d", "d.md"), agent("c", "c.md"), agent("b", "b.md"), agent("a", "a.md")],
        [edge("ab", "a", "b"), edge("ac", "a", "c"), edge("cd", "c", "d"), edge("bd", "b", "d"), edge("bd2", "b", "d")],
      ),
    );
    assert.deepEqual(
      steps.map((step) => [step.nodeId, step.inputs]),
      [
        ["a", []],
        ["b", ["a"]],
        ["c", ["a"]],
        ["d", ["b", "c"]],
      ],
    );
  });

  test("a duplicate edge counts once and the agent name is trimmed onto the step", () => {
    const named = agent("b", "b.md");
    if (named.type === "agent") named.data.agentName = "  Writer ";
    const steps = resolvePipeline(document([agent("a", "a.md"), named], [edge("1", "a", "b"), edge("2", "a", "b")]));
    const second = steps[1];
    assert.equal(second?.kind, "agent");
    if (second?.kind !== "agent") return;
    assert.deepEqual(second.inputs, ["a"]);
    assert.equal(second.agentName, "Writer");
  });

  test("a human with two inputs keeps both", () => {
    const steps = resolvePipeline(
      document([agent("a", "a.md"), agent("b", "b.md"), human("h")], [edge("1", "a", "h"), edge("2", "b", "h")]),
    );
    assert.deepEqual(steps.find((step) => step.nodeId === "h")?.inputs, ["a", "b"]);
  });

  test("reviewSources finds the nearest agents through other human nodes", () => {
    const shape = graphShape(
      [
        { id: "a", type: "agent" },
        { id: "b", type: "agent" },
        { id: "h1", type: "human" },
        { id: "h2", type: "human" },
        { id: "x", type: "agent" },
      ],
      [
        { source: "x", target: "a" },
        { source: "a", target: "h1" },
        { source: "h1", target: "h2" },
        { source: "b", target: "h2" },
      ],
    );
    assert.deepEqual(reviewSources(shape, "h2"), ["a", "b"]);
    assert.deepEqual(reviewSources(shape, "h1"), ["a"]);
  });

  test("reviewSources returns nothing for a human with no agent behind it", () => {
    const shape = graphShape([{ id: "h", type: "human" }], []);
    assert.deepEqual(reviewSources(shape, "h"), []);
  });

  test("wouldCreateCycle catches self-loops and back edges and allows a join", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    assert.equal(wouldCreateCycle(edges, "a", "a"), true);
    assert.equal(wouldCreateCycle(edges, "c", "a"), true);
    assert.equal(wouldCreateCycle(edges, "a", "c"), false);
    assert.equal(wouldCreateCycle(edges, "d", "c"), false);
  });
});
