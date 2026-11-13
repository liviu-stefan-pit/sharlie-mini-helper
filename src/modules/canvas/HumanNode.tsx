/**
 * Responsibility: human node card and the fields shared with the inspector.
 * Inputs: human node data and a patch callback.
 * Outputs: status, artifacts, notes, and inert review buttons.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { HumanNodeData } from "../graph/types";
import { usePatchNode } from "./patch";
import { cardClass, fieldClass, ghostButtonClass, labelClass } from "./ui";

export function HumanFields({
  data,
  onChange,
  compact = false,
}: {
  data: HumanNodeData;
  onChange: (patch: Partial<HumanNodeData>) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-zinc-500">Status {data.status}</p>
      {data.artifactPaths.length === 0 ? (
        <p className="text-[11px] text-zinc-400">No artifacts yet</p>
      ) : (
        <ul className="max-h-24 overflow-auto text-[11px] text-zinc-600 dark:text-zinc-300">
          {data.artifactPaths.map((artifact) => (
            <li key={artifact} className="truncate">
              {artifact}
            </li>
          ))}
        </ul>
      )}
      <label className={labelClass}>
        Notes
        <textarea
          className={`${fieldClass} mt-1 resize-y`}
          rows={compact ? 3 : 8}
          value={data.notes}
          placeholder="Notes"
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </label>
      <div className="flex gap-1">
        <button type="button" className={ghostButtonClass} disabled>
          Approve
        </button>
        <button type="button" className={ghostButtonClass} disabled>
          Redo
        </button>
        <button type="button" className={ghostButtonClass} disabled>
          Decline
        </button>
      </div>
    </div>
  );
}

export function HumanNode({ id, data }: NodeProps<Node<HumanNodeData, "human">>) {
  const patch = usePatchNode(id);
  return (
    <div className={cardClass}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Human</p>
      <HumanFields data={data} compact onChange={(next) => patch(next)} />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
    </div>
  );
}
