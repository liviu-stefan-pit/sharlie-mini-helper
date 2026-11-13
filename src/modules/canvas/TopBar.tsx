/**
 * Responsibility: slim command row for the canvas.
 * Inputs: pipeline name, saved pipelines, theme, and actions.
 * Outputs: add, save, load, theme, and settings controls.
 */
import type { NodeKind, PipelineSummary } from "../graph/types";
import type { Theme } from "./theme";
import { ghostButtonClass, primaryButtonClass } from "./ui";

export function TopBar({
  name,
  onNameChange,
  onAdd,
  onSave,
  saving,
  pipelines,
  currentId,
  onLoad,
  theme,
  onToggleTheme,
  onOpenSettings,
  notice,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onAdd: (kind: NodeKind) => void;
  onSave: () => void;
  saving: boolean;
  pipelines: PipelineSummary[];
  currentId: string | null;
  onLoad: (id: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  notice: { tone: "ok" | "err"; text: string } | null;
}) {
  return (
    <header className="flex w-full min-w-0 flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="text-[13px] font-semibold tracking-tight">sharlie-mini-helper</span>
      <input
        aria-label="Pipeline name"
        className="min-w-32 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-zinc-200 focus:border-zinc-300 dark:hover:border-zinc-700 dark:focus:border-zinc-600"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
      />
      <div className="flex items-center gap-1">
        <button type="button" className={ghostButtonClass} onClick={() => onAdd("agent")}>
          Agent
        </button>
        <button type="button" className={ghostButtonClass} onClick={() => onAdd("skill")}>
          Skill
        </button>
        <button type="button" className={ghostButtonClass} onClick={() => onAdd("human")}>
          Human
        </button>
      </div>
      <button type="button" className={primaryButtonClass} onClick={onSave} disabled={saving}>
        {saving ? "Saving" : "Save"}
      </button>
      <label className="flex items-center gap-1 text-xs text-zinc-500">
        Load
        <select
          aria-label="Load pipeline"
          className="max-w-40 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          value={currentId ?? ""}
          onChange={(event) => {
            if (event.target.value) onLoad(event.target.value);
          }}
        >
          <option value="">Select</option>
          {pipelines.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={ghostButtonClass} disabled title="Execution arrives in the next phase">
        Run
      </button>
      <span className="rounded-full border border-zinc-200 px-2 py-1 font-mono text-[11px] text-zinc-500 dark:border-zinc-700">
        run 0 · session 0
      </span>
      <button type="button" className={ghostButtonClass} onClick={onToggleTheme}>
        {theme === "dark" ? "Light" : "Dark"}
      </button>
      <button type="button" className={ghostButtonClass} onClick={onOpenSettings}>
        Settings
      </button>
      {notice && (
        <span className={`text-xs ${notice.tone === "err" ? "text-red-600" : "text-zinc-500"}`} role="status">
          {notice.text}
        </span>
      )}
    </header>
  );
}
