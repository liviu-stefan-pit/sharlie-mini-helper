/**
 * Responsibility: agent node card and the fields shared with the inspector.
 * Inputs: agent node data and a patch callback.
 * Outputs: model, prompt, and status controls bound to the node.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { MODEL_PRESETS } from "../cursor/models";
import type { AgentNodeData } from "../graph/types";
import { usePatchNode } from "./patch";
import { cardClass, fieldClass, labelClass } from "./ui";

export function AgentFields({
  data,
  onChange,
  compact = false,
}: {
  data: AgentNodeData;
  onChange: (patch: Partial<AgentNodeData>) => void;
  compact?: boolean;
}) {
  const known =
    MODEL_PRESETS.some((preset) => preset.id === data.modelId) || data.modelId === "custom";
  const seconds = Math.floor(data.elapsedMs / 1000);
  return (
    <div className="flex flex-col gap-2">
      <label className={labelClass}>
        Model
        <select
          className={`${fieldClass} mt-1`}
          value={data.modelId}
          onChange={(event) => onChange({ modelId: event.target.value })}
        >
          {MODEL_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          {!known && <option value={data.modelId}>{data.modelId}</option>}
          <option value="custom">Custom</option>
        </select>
      </label>
      {data.modelId === "custom" && (
        <label className={labelClass}>
          Custom model
          <input
            className={`${fieldClass} mt-1`}
            value={data.customModelId ?? ""}
            placeholder="model id"
            onChange={(event) => onChange({ customModelId: event.target.value })}
          />
        </label>
      )}
      <label className={labelClass}>
        Prompt / role
        <textarea
          className={`${fieldClass} mt-1 resize-y`}
          rows={compact ? 3 : 8}
          value={data.prompt}
          placeholder="Prompt / role"
          onChange={(event) => onChange({ prompt: event.target.value })}
        />
      </label>
      <p className="text-[11px] text-zinc-500">
        {data.status}, elapsed {seconds}s, tokens {data.tokens.input} / {data.tokens.output} / {data.tokens.total}
      </p>
    </div>
  );
}

export function AgentNode({ id, data }: NodeProps<Node<AgentNodeData, "agent">>) {
  const patch = usePatchNode(id);
  return (
    <div className={cardClass}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Agent</p>
      <AgentFields data={data} compact onChange={(next) => patch(next)} />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
    </div>
  );
}
