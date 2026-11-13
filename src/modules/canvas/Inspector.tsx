/**
 * Responsibility: slide-over editor for the selected node.
 * Inputs: the selected flow node and a close action.
 * Outputs: the same fields as the node card, kept in sync.
 */
import { useContext } from "react";
import type { FlowNode } from "./flow";
import { AgentFields } from "./AgentNode";
import { HumanFields } from "./HumanNode";
import { ModelsContext } from "./modelsContext";
import { usePatchNode } from "./patch";

export function Inspector({ node, onClose }: { node: FlowNode; onClose: () => void }) {
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-80 max-w-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{node.type}</p>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <InspectorBody node={node} />
      </div>
    </aside>
  );
}

function InspectorBody({ node }: { node: FlowNode }) {
  const patch = usePatchNode(node.id);
  const models = useContext(ModelsContext);
  if (node.type === "agent") {
    return <AgentFields data={node.data} models={models} onChange={(next) => patch(next)} />;
  }
  return <HumanFields data={node.data} />;
}
