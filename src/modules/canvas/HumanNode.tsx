/**
 * Responsibility: human node card and the fields shared with the inspector.
 * Inputs: human node data and review actions.
 * Outputs: status, artifact rows, and review buttons while the node is waiting.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { HumanNodeData } from "../graph/types";
import { useRunActions, type ReviewDecision } from "./runContext";
import { cardClass, ghostButtonClass } from "./ui";

export function HumanFields({ data }: { data: HumanNodeData }) {
  const { decide, previewPath } = useRunActions();
  const ready = data.status === "waiting";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-zinc-500">Status {data.status}</p>
      {data.artifactPaths.length === 0 ? (
        <p className="text-[11px] text-zinc-400">No artifacts yet</p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-1 overflow-auto">
          {data.artifactPaths.map((artifact) => (
            <li key={artifact} className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600 dark:text-zinc-300" title={artifact}>
                {artifact}
              </span>
              <button
                type="button"
                className={`${ghostButtonClass} nodrag nopan nowheel px-1.5 py-0.5`}
                onClick={(event) => {
                  event.stopPropagation();
                  copyText(artifact);
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className={`${ghostButtonClass} nodrag nopan nowheel px-1.5 py-0.5`}
                onClick={(event) => {
                  event.stopPropagation();
                  previewPath(artifact);
                }}
              >
                Preview
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={`${ghostButtonClass} nodrag nopan nowheel`}
          disabled={!ready}
          onClick={(event) => {
            event.stopPropagation();
            review(decide, "approve");
          }}
        >
          Approve
        </button>
        <button
          type="button"
          className={`${ghostButtonClass} nodrag nopan nowheel`}
          disabled={!ready}
          onClick={(event) => {
            event.stopPropagation();
            review(decide, "redo");
          }}
        >
          Redo
        </button>
        <button
          type="button"
          className={`${ghostButtonClass} nodrag nopan nowheel`}
          disabled={!ready}
          onClick={(event) => {
            event.stopPropagation();
            review(decide, "decline");
          }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

export function HumanNode({ data }: NodeProps<Node<HumanNodeData, "human">>) {
  const waiting = data.status === "waiting" ? " human-waiting" : "";
  return (
    <div className={`${cardClass}${waiting}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Human</p>
      <HumanFields data={data} />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-zinc-400 !bg-white dark:!bg-zinc-900" />
    </div>
  );
}

function review(decide: (decision: ReviewDecision) => void, decision: ReviewDecision): void {
  decide(decision);
}

function copyText(value: string): void {
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return;
    void clipboard.writeText(value).catch(() => {});
  } catch {
    // Clipboard is unavailable.
  }
}
