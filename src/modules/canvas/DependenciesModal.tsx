/**
 * Responsibility: list workflow agents and dependencies with missing items in red.
 * Inputs: workflow health, canvas nodes, and open state.
 * Outputs: a modal with hover text and a button that opens the library.
 */
import type { ReactNode } from "react";
import type { FlowNode } from "./flow";
import type { DependencyHealth, WorkflowHealth } from "../workflow/health";
import { ghostButtonClass, labelClass } from "./ui";

export function DependenciesModal({
  open,
  onClose,
  health,
  nodes,
  onOpenLibrary,
}: {
  open: boolean;
  onClose: () => void;
  health: WorkflowHealth | null;
  nodes: FlowNode[];
  onOpenLibrary: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Workflow dependencies</h2>
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            Close
          </button>
        </div>
        {health === null ? (
          <p className="text-xs text-zinc-500">Select a workspace to check dependencies.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Group title="Agents" count={agentRows(nodes, health).length}>
              {agentRows(nodes, health).map((row) => (
                <StatusRow key={row.key} name={row.name} status={row.status} message={row.message} />
              ))}
            </Group>
            <Group title="Skills" count={health.dependencies.filter((item) => item.kind === "skill").length}>
              {health.dependencies
                .filter((item) => item.kind === "skill")
                .map((item) => (
                  <StatusRow key={rowKey(item)} name={item.name} status={item.status} message={item.message} />
                ))}
            </Group>
            <Group title="Rules" count={health.dependencies.filter((item) => item.kind === "rule").length}>
              {health.dependencies
                .filter((item) => item.kind === "rule")
                .map((item) => (
                  <StatusRow key={rowKey(item)} name={item.name} status={item.status} message={item.message} />
                ))}
            </Group>
            <Group title="MCP servers" count={health.dependencies.filter((item) => item.kind === "mcp").length}>
              {health.dependencies
                .filter((item) => item.kind === "mcp")
                .map((item) => (
                  <StatusRow key={rowKey(item)} name={item.name} status={item.status} message={item.message} />
                ))}
            </Group>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {health !== null && health.problemCount > 0 && (
            <p className="text-xs text-zinc-500">Hover a red name to see how to fix it.</p>
          )}
          <div className="flex justify-end gap-2">
            {health !== null && health.problemCount > 0 && (
              <button type="button" className={ghostButtonClass} onClick={onOpenLibrary}>
                Open Library
              </button>
            )}
            <button type="button" className={ghostButtonClass} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h3 className={labelClass}>{title}</h3>
      {count === 0 ? <p className="text-zinc-400">None.</p> : <div className="flex flex-col gap-1">{children}</div>}
    </section>
  );
}

function agentRows(
  nodes: FlowNode[],
  health: WorkflowHealth,
): { key: string; name: string; status: "ok" | "missing"; message?: string }[] {
  const rows: { key: string; name: string; status: "ok" | "missing"; message?: string }[] = [];
  for (const node of nodes) {
    if (node.type !== "agent") continue;
    const item = health.agents[node.id];
    if (!item || item.status === "unset") continue;
    rows.push({
      key: node.id,
      name: node.data.agentName || "Unnamed agent",
      status: item.status,
      message: item.status === "missing" ? item.message : undefined,
    });
  }
  return rows;
}

function rowKey(item: DependencyHealth): string {
  return `${item.kind}:${item.name}`;
}

function StatusRow({
  name,
  status,
  message,
}: {
  name: string;
  status: "ok" | "missing" | "bundled" | "library" | "disabled";
  message?: string;
}) {
  const missing = status === "missing";
  const disabled = status === "disabled";
  const nameClass = missing
    ? "cursor-help font-medium text-red-600 underline decoration-dotted"
    : disabled
      ? "cursor-help font-medium text-amber-600 underline decoration-dotted"
      : undefined;
  const wordClass = missing
    ? "text-[10px] uppercase text-red-600"
    : disabled
      ? "text-[10px] uppercase text-amber-600"
      : "text-[10px] uppercase";
  return (
    <div className="flex items-center justify-between gap-2 text-xs" title={message}>
      <span className={nameClass} title={message}>
        {name}
      </span>
      <span className={wordClass}>{statusWord(status)}</span>
    </div>
  );
}

function statusWord(status: "ok" | "missing" | "bundled" | "library" | "disabled"): string {
  if (status === "missing") return "missing";
  if (status === "disabled") return "off";
  if (status === "bundled") return "bundled";
  return "found";
}
