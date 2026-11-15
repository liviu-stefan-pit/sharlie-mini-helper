/**
 * Responsibility: agent node card and the fields shared with the inspector.
 * Inputs: agent node data, the model list, and a patch callback.
 * Outputs: model, effort, agent file, status, and live run progress on the card.
 */
import { useContext, useEffect, useRef, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { defaultEffort } from "../cursor/models";
import type { AgentNodeData } from "../graph/types";
import type { AgentHealth } from "../workflow/health";
import { browseAgent, fetchAgents, type AgentChoice } from "./api";
import { mergeAgentOptions } from "./flow";
import { useCanvasGraph } from "./graphContext";
import { HealthContext } from "./healthContext";
import { CanvasAgentsContext, ModelsContext, type ModelChoice } from "./modelsContext";
import { usePatchNode } from "./patch";
import { cardClass, fieldClass, ghostButtonClass, inputHandleClass, labelClass, outputHandleClass } from "./ui";

const NO_EFFORT: ModelChoice["effort"] = [];

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
  const canvasAgents = useContext(CanvasAgentsContext);
  const agentOptions = mergeAgentOptions(agents, canvasAgents);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const modelsReady = models.length > 0;
  const knownModel = models.some((model) => model.id === data.modelId);
  const selectedModel = models.find((model) => model.id === data.modelId);
  const effortOptions = selectedModel?.effort ?? NO_EFFORT;
  const effortReady = modelsReady && effortOptions.length > 0;
  const effortKnown = effortOptions.some((item) => item.value === data.effort);
  const effortParamId = effortReady ? (selectedModel?.effortParamId ?? "") : "";
  const requestedEffort = useRef("");
  const knownAgent = agentOptions.some((agent) => agent.path === data.agentPath);
  const agentMissing = health?.status === "missing";
  const modelMissing = modelsReady && data.modelId !== "" && !knownModel;
  const modelTitle = `Model "${data.modelId}" is not available for this API key. Pick another model.`;
  const seconds = Math.floor(data.elapsedMs / 1000);

  useEffect(() => {
    if (!compact || !modelsReady || !selectedModel) return;
    if (data.effort !== "" && effortKnown) {
      if (data.effortParamId !== effortParamId) onChange({ effortParamId });
      requestedEffort.current = "";
      return;
    }
    const next = defaultEffort(effortOptions);
    const mark = `${data.modelId}:${data.effort}:${next}:${effortParamId}`;
    if ((next === data.effort && data.effortParamId === effortParamId) || requestedEffort.current === mark) return;
    requestedEffort.current = mark;
    onChange({ effort: next, effortParamId });
  }, [
    compact,
    data.effort,
    data.effortParamId,
    data.modelId,
    effortKnown,
    effortOptions,
    effortParamId,
    modelsReady,
    onChange,
    selectedModel,
  ]);

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
          onChange={(event) => {
            const modelId = event.target.value;
            const model = models.find((item) => item.id === modelId);
            onChange({
              modelId,
              effortParamId: model && model.effort.length > 0 ? model.effortParamId : "",
            });
          }}
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
        Effort
        <select
          className={`${fieldClass} mt-1 disabled:cursor-not-allowed disabled:opacity-60`}
          value={effortKnown ? data.effort : defaultEffort(effortOptions)}
          disabled={!effortReady}
          onChange={(event) => onChange({ effort: event.target.value, effortParamId })}
        >
          {effortOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Agent
        <select
          className={`${fieldClass} mt-1${agentMissing ? " border-red-500 text-red-600" : ""}`}
          value={data.agentPath}
          title={health?.status === "missing" ? health.message : undefined}
          onChange={(event) => {
            const agentPath = event.target.value;
            const chosen = agentOptions.find((agent) => agent.path === agentPath);
            onChange({ agentPath, agentName: chosen?.name ?? "" });
          }}
        >
          <option value="">Select an agent</option>
          {agentOptions.map((agent) => (
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
      <Handle type="target" position={Position.Left} className={inputHandleClass} />
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Agent</p>
        <AgentMark status={data.status} />
      </div>
      <InputsHint nodeId={id} status={data.status} />
      <AgentFields data={data} models={models} health={health} compact onChange={(next) => patch(next)} />
      <Handle type="source" position={Position.Right} className={outputHandleClass} />
    </div>
  );
}

/** For an agent with two or more inputs: it starts only when all of them are finished. */
function InputsHint({ nodeId, status }: { nodeId: string; status: AgentNodeData["status"] }) {
  const graph = useCanvasGraph();
  const inputs = graph.inputs[nodeId];
  if (!inputs || inputs.total < 2 || status !== "idle") return null;
  const text = graph.running
    ? `Waiting for ${inputs.total - inputs.satisfied} of ${inputs.total} inputs`
    : `Starts when all ${inputs.total} inputs finish`;
  return <p className="mb-2 text-[11px] text-zinc-500">{text}</p>;
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
