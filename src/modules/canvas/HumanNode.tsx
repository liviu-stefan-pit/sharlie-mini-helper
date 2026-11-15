/**
 * Responsibility: human node card and the fields shared with the inspector.
 * Inputs: human node data and review actions.
 * Outputs: status, artifact rows, and review buttons while the node is waiting.
 * A human that reviews two or more agents offers Redo all and Redo one.
 */
import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { HumanNodeData } from "../graph/types";
import { useCanvasGraph, type ReviewSourceOption } from "./graphContext";
import { useRunActions, type ReviewDecision } from "./runContext";
import { cardClass, ghostButtonClass, inputHandleClass, outputHandleClass } from "./ui";

const NO_SOURCES: ReviewSourceOption[] = [];

export function HumanFields({ nodeId, data }: { nodeId: string; data: HumanNodeData }) {
  const { decide, previewPath } = useRunActions();
  const sources = useCanvasGraph().reviewSources[nodeId] ?? NO_SOURCES;
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
      <ReviewButtons nodeId={nodeId} ready={ready} sources={sources} decide={decide} />
    </div>
  );
}

function ReviewButtons({
  nodeId,
  ready,
  sources,
  decide,
}: {
  nodeId: string;
  ready: boolean;
  sources: readonly ReviewSourceOption[];
  decide: (nodeId: string, decision: ReviewDecision, redoNodeId?: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const several = sources.length >= 2;
  const button = (label: string, onClick: () => void, title?: string) => (
    <button
      type="button"
      className={`${ghostButtonClass} nodrag nopan nowheel`}
      disabled={!ready}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
  const send = (decision: ReviewDecision, redoNodeId?: string) => {
    setPicking(false);
    decide(nodeId, decision, redoNodeId);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {button("Approve", () => send("approve"))}
        {several
          ? button("Redo all", () => send("redo"), "Run every reviewed agent again")
          : button("Redo", () => send("redo"))}
        {several && button(picking ? "Redo one ▴" : "Redo one ▾", () => setPicking((value) => !value), "Pick the agent to run again")}
        {button("Decline", () => send("decline"))}
      </div>
      {several && picking && ready && (
        <ul className="flex flex-col gap-1 rounded border border-zinc-200 p-1 dark:border-zinc-700">
          {sources.map((source) => (
            <li key={source.nodeId}>
              <button
                type="button"
                className={`${ghostButtonClass} nodrag nopan nowheel w-full truncate text-left`}
                title={`Run ${source.name} again`}
                onClick={(event) => {
                  event.stopPropagation();
                  send("redo", source.nodeId);
                }}
              >
                Redo {source.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HumanNode({ id, data }: NodeProps<Node<HumanNodeData, "human">>) {
  const waiting = data.status === "waiting" ? " human-waiting" : "";
  return (
    <div className={`${cardClass}${waiting}`}>
      <Handle type="target" position={Position.Left} className={inputHandleClass} />
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Human</p>
      <HumanFields nodeId={id} data={data} />
      <Handle type="source" position={Position.Right} className={outputHandleClass} />
    </div>
  );
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
