/**
 * Responsibility: agent node card and the fields shared with the inspector.
 * Inputs: agent node data, the model list, and a patch callback.
 * Outputs: model, agent file, status, and live run progress on the card.
 */
import { useContext, useEffect, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { AgentNodeData } from "../graph/types";
import type { AgentHealth } from "../workflow/health";
import { browseAgent, fetchAgents, type AgentChoice } from "./api";
import { HealthContext } from "./healthContext";
import { ModelsContext, type ModelChoice } from "./modelsContext";
import { usePatchNode } from "./patch";
import { cardClass, fieldClass, ghostButtonClass, labelClass } from "./ui";

export function AgentFields({
  data,
  models,
  onChange,
  compact = false,
  health,
}: {
  data: AgentNodeData;
  models: readonly ModelChoice[];
  onChange: (patch: Partial<AgentNodeData>) => void;
  compact?: boolean;
  health?: AgentHealth;
}) {
  const [agents, setAgents] = useState<AgentChoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const modelsReady = models.length > 0;
  const knownModel = models.some((model) => model.id === data.modelId);
  const knownAgent = agents.some((agent) => agent.path === data.agentPath);
  const agentMissing = health?.status === "missing";
  const modelMissing = modelsReady && data.modelId !== "" && !knownModel;
  const modelTitle = `Model "${data.modelId}" is not available for this API key. Pick another model.`;
  const seconds = Math.floor(data.elapsedMs / 1000);

  useEffect(() => {
    let cancelled = false;
    fetchAgents()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load agents");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onBrowse() {
    setBrowsing(true);
    setError(null);
    try {
      const picked = await browseAgent();
      if ("cancelled" in picked) return;
      onChange({ agentPath: picked.path, agentName: picked.name });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open the agent file");
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className={labelClass}>
        Model
        <select
          className={`${fieldClass} mt-1 disabled:cursor-not-allowed disabled:opacity-60${modelMissing ? " border-red-500 text-red-600" : ""}`}
          value={data.modelId}
          disabled={!modelsReady}
          title={modelMissing ? modelTitle : undefined}
          onChange={(event) => onChange({ modelId: event.target.value })}
        >
          {!modelsReady && <option value={data.modelId}>Connect an API key in Settings</option>}
          {modelsReady && data.modelId === "" && <option value="">Select a model</option>}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
          {modelsReady && data.modelId !== "" && !knownModel && <option value={data.modelId}>{data.modelId}</option>}
        </select>
      </label>
      {modelMissing && (
        <p className="cursor-help text-[11px] font-medium text-red-600 underline decoration-dotted" title={modelTitle}>
          {data.modelId} — not available
        </p>
      )}
      {!modelsReady && <p className="text-[11px] text-zinc-500">Connect an API key in Settings</p>}
      <label className={labelClass}>
        Agent
        <select
          className={`${fieldClass} mt-1${agentMissing ? " border-red-500 text-red-600" : ""}`}
          value={data.agentPath}
          title={health?.status === "missing" ? health.message : undefined}
          onChange={(event) => {
            const agentPath = event.target.value;
            const chosen = agents.find((agent) => agent.path === agentPath);
            onChange({ agentPath, agentName: chosen?.name ?? "" });
          }}
        >
          <option value="">Select an agent</option>
          {agents.map((agent) => (
            <option key={agent.path} value={agent.path}>
              {agent.name}
            </option>
          ))}
          {!knownAgent && data.agentPath !== "" && (
            <option value={data.agentPath}>{data.agentName || data.agentPath}</option>
          )}
        </select>
      </label>
      {health?.status === "missing" && (
        <p className="cursor-help text-[11px] font-medium text-red-600 underline decoration-dotted" title={health.message}>
          {data.agentName || "Agent"} — missing
        </p>
      )}
      <button
        type="button"
        className={`${ghostButtonClass} nodrag nopan nowheel`}
        disabled={browsing}
        onClick={(event) => {
          event.stopPropagation();
          void onBrowse();
        }}
      >
        Browse
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <p className="text-[11px] text-zinc-500">
        {data.status}
        {data.retryCount > 0 ? `, retry ${data.retryCount}` : ""}, elapsed {seconds}s, tokens {shown(data.tokens.input)}{" "}
        / {shown(data.tokens.output)} / {shown(data.tokens.total)}
      </p>
      {data.lastOutput && (
        <p
          className={`whitespace-pre-wrap text-[11px] text-zinc-600 dark:text-zinc-300 ${compact ? "line-clamp-4" : "max-h-40 overflow-auto"}`}
        >
          {data.lastOutput}
        </p>
      )}
    </div>
  );
}

export function AgentNode({ id, data }: NodeProps<Node<AgentNodeData, "agent">>) {
  const patch = usePatchNode(id);
  const models = useContext(ModelsContext);
  const health = useContext(HealthContext)?.agents[id];
  const modelMissing = models.length > 0 && data.modelId !== "" && !models.some((model) => model.id === data.modelId);
  const flagged = health?.status === "missing" || modelMissing;
  return (
    <div className={flagged ? `${cardClass} !border-red-500` : cardClass}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Agent</p>
        <AgentMark status={data.status} />
      </div>
      <AgentFields data={data} models={models} health={health} compact onChange={(next) => patch(next)} />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
    </div>
  );
}

function AgentMark({ status }: { status: AgentNodeData["status"] }) {
  if (status === "running" || status === "redoing") {
    return <span className="progress-ring" aria-hidden="true" />;
  }
  if (status === "done") {
    return (
      <svg className="status-check" viewBox="0 0 16 16" aria-label="done">
        <path d="M3.2 8.4 6.4 11.6 12.8 4.4" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  if (status === "error") {
    return <span className="text-[10px] font-medium text-red-600">error</span>;
  }
  return null;
}

function shown(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "\u2014";
}
