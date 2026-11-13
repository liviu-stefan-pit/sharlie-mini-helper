/**
 * Responsibility: serializable pipeline shapes shared by the canvas and the API.
 * Inputs: none (type definitions only).
 * Outputs: node kinds, node data, PipelineNode, PipelineEdge, and PipelineDocument.
 */

export type NodeKind = "agent" | "skill" | "human";
export type AgentStatus = "idle" | "running" | "redoing" | "done" | "error";
export type HumanStatus = "idle" | "waiting" | "approved" | "declined";
export type TokenCounts = { input: number; output: number; total: number };

export type AgentNodeData = {
  modelId: string;
  customModelId?: string;
  prompt: string;
  status: AgentStatus;
  elapsedMs: number;
  retryCount: number;
  tokens: TokenCounts;
};

export type SkillNodeData = {
  source: "discovered" | "custom";
  skillPath: string;
  title: string;
  description: string;
};

export type HumanNodeData = {
  status: HumanStatus;
  notes: string;
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
      type: "skill";
      position: { x: number; y: number };
      data: SkillNodeData;
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
  kind: "attachment" | "execution";
};

export type PipelineDocument = {
  version: 1;
  id: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  updatedAt: string;
};

export type PipelineSummary = {
  id: string;
  name: string;
  updatedAt: string;
};
