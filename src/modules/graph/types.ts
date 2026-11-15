/**
 * Responsibility: serializable pipeline shapes shared by the canvas and the API.
 * Inputs: none (type definitions only).
 * Outputs: node kinds, node data, workflow dependencies, PipelineNode, PipelineEdge, and PipelineDocument.
 */

export type NodeKind = "agent" | "human";
export type AgentStatus = "idle" | "running" | "redoing" | "done" | "error";
export type HumanStatus = "idle" | "waiting" | "approved" | "declined";
export type TokenCounts = { input?: number; output?: number; total?: number };

export type AgentNodeData = {
  modelId: string;
  /** "" means not chosen yet. A run fills a blank from the model catalog. */
  effort: string;
  /**
   * Parameter id sent with effort, such as "effort" or "reasoning_effort".
   * "" means it was not stored. A run then uses the catalog id, or "effort" when the catalog has none.
   */
  effortParamId: string;
  agentPath: string;
  agentName: string;
  status: AgentStatus;
  elapsedMs: number;
  retryCount: number;
  tokens: TokenCounts;
  lastOutput?: string;
};

export type HumanNodeData = {
  status: HumanStatus;
  artifactPaths: string[];
};

export type PipelineNode =
  | {
      id: string;
      type: "agent";
      position: { x: number; y: number };
      data: AgentNodeData;
    }
  | {
      id: string;
      type: "human";
      position: { x: number; y: number };
      data: HumanNodeData;
    };

export type PipelineEdge = {
  id: string;
  source: string;
  target: string;
  kind: "execution";
};

export type DependencyKind = "skill" | "rule" | "mcp";

export type WorkflowDependency = {
  kind: DependencyKind;
  /** Skill or rule title, or MCP server name. Never empty. */
  name: string;
  /** May be "". */
  description: string;
  /**
   * Only for skill and rule. Posix path relative to the workflow folder, e.g.
   * ".sharlie/bundle/skills/code-review/SKILL.md". Absent when the file was not bundled.
   */
  bundledPath?: string;
};

export type PipelineDocument = {
  version: 1;
  id: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  updatedAt: string;
  dependencies?: WorkflowDependency[];
};

export type PipelineSummary = {
  id: string;
  name: string;
  updatedAt: string;
};
