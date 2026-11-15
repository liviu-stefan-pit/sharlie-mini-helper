import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { agentDefaultsFromNodes, mergeAgentOptions, type FlowNode } from "../src/modules/canvas/flow";
import type { AgentNodeData } from "../src/modules/graph/types";

function agent(id: string, data: Partial<AgentNodeData> = {}): FlowNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      modelId: "",
      effort: "",
      effortParamId: "",
      agentPath: "",
      agentName: "",
      status: "running",
      elapsedMs: 40,
      retryCount: 2,
      tokens: { input: 1, output: 2, total: 3 },
      lastOutput: "not copied",
      ...data,
    },
  };
}

function human(id: string): FlowNode {
  return {
    id,
    type: "human",
    position: { x: 1, y: 1 },
    data: { status: "waiting", artifactPaths: ["out.txt"] },
  };
}

const empty = {
  modelId: "",
  effort: "",
  effortParamId: "",
  agentPath: "",
  agentName: "",
};

describe("agentDefaultsFromNodes", () => {
  test("no prior agent node returns empty settings", () => {
    assert.deepEqual(agentDefaultsFromNodes([]), empty);
  });

  test("the nearest node that has both still supplies both", () => {
    const result = agentDefaultsFromNodes([
      agent("earlier", {
        modelId: "old",
        effort: "low",
        effortParamId: "effort",
        agentPath: "C:\\old.md",
        agentName: "Old",
      }),
      agent("browsed", {
        modelId: "composer-2.5",
        effort: "high",
        effortParamId: "reasoning_effort",
        agentPath: "D:\\outside\\reviewer.md",
        agentName: "Reviewer",
      }),
    ]);
    assert.deepEqual(result, {
      modelId: "composer-2.5",
      effort: "high",
      effortParamId: "reasoning_effort",
      agentPath: "D:\\outside\\reviewer.md",
      agentName: "Reviewer",
    });
    assert.equal("status" in result, false);
    assert.equal("elapsedMs" in result, false);
    assert.equal("retryCount" in result, false);
    assert.equal("tokens" in result, false);
    assert.equal("lastOutput" in result, false);
  });

  test("a later blank agent does not hide an earlier configured one", () => {
    assert.deepEqual(
      agentDefaultsFromNodes([
        agent("configured", {
          modelId: "gpt",
          effort: "medium",
          effortParamId: "effort",
          agentPath: "C:\\browse\\writer.md",
          agentName: "Writer",
        }),
        agent("blank"),
        human("after"),
      ]),
      {
        modelId: "gpt",
        effort: "medium",
        effortParamId: "effort",
        agentPath: "C:\\browse\\writer.md",
        agentName: "Writer",
      },
    );
  });

  test("a later model with an empty agent path does not hide an earlier agent file", () => {
    assert.deepEqual(
      agentDefaultsFromNodes([
        agent("dev", {
          modelId: "old",
          effort: "low",
          effortParamId: "effort",
          agentPath: "C:\\agents\\dev.md",
          agentName: "Dev",
        }),
        agent("model-only", {
          modelId: "grok-4.7",
          effort: "high",
          effortParamId: "effort",
        }),
      ]),
      {
        modelId: "grok-4.7",
        effort: "high",
        effortParamId: "effort",
        agentPath: "C:\\agents\\dev.md",
        agentName: "Dev",
      },
    );
  });

  test("a later agent file with an empty model does not hide an earlier model", () => {
    assert.deepEqual(
      agentDefaultsFromNodes([
        agent("model", {
          modelId: "grok-4.7",
          effort: "high",
          effortParamId: "effort",
        }),
        agent("file-only", {
          agentPath: "D:\\outside\\dev.md",
          agentName: "",
        }),
      ]),
      {
        modelId: "grok-4.7",
        effort: "high",
        effortParamId: "effort",
        agentPath: "D:\\outside\\dev.md",
        agentName: "",
      },
    );
  });

  test("human nodes are ignored", () => {
    assert.deepEqual(agentDefaultsFromNodes([human("only")]), empty);
    assert.deepEqual(
      agentDefaultsFromNodes([
        human("before"),
        agent("configured", {
          modelId: "m",
          effort: "low",
          effortParamId: "effort",
          agentPath: "C:\\a.md",
          agentName: "A",
        }),
        human("after"),
      ]).agentName,
      "A",
    );
  });
});

describe("mergeAgentOptions", () => {
  test("scan row wins, canvas-only paths are included, and empty paths are dropped", () => {
    assert.deepEqual(
      mergeAgentOptions(
        [
          { name: "Scan name", description: "from scan", path: "C:\\shared.md" },
          { name: "Dropped", description: "nope", path: "" },
        ],
        [
          { name: "Canvas name", path: "C:\\shared.md" },
          { name: "Outside", path: "D:\\outside.md" },
          { name: "", path: "E:\\unnamed.md" },
          { name: "Blank", path: "" },
        ],
      ),
      [
        { name: "Scan name", description: "from scan", path: "C:\\shared.md" },
        { name: "Outside", description: "", path: "D:\\outside.md" },
        { name: "E:\\unnamed.md", description: "", path: "E:\\unnamed.md" },
      ],
    );
  });
});
