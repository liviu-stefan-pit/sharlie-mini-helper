/**
 * Responsibility: slim command row for the canvas.
 * Inputs: pipeline name, saved pipelines, workspace status, theme, and actions.
 * Outputs: add, save, load, import, export, run, stop, resume, theme, library, dependencies, and settings controls.
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
  onImport,
  canImport,
  onExport,
  canExport,
  theme,
  onToggleTheme,
  onOpenLibrary,
  onOpenDependencies,
  problemCount,
  onOpenSettings,
  workspaceName,
  workspaceValid,
  workspacePath,
  workspaceError,
  workspaceTemporary,
  workspaceReady,
  notice,
  runPhase,
  onRun,
  onStop,
  onStartOver,
  runTotal,
  sessionTotal,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onAdd: (kind: NodeKind) => void;
  onSave: () => void;
  saving: boolean;
  pipelines: PipelineSummary[];
  currentId: string | null;
  onLoad: (id: string) => void;
  onImport: () => void;
  canImport: boolean;
  onExport: () => void;
  canExport: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenLibrary: () => void;
  onOpenDependencies: () => void;
  problemCount: number;
  onOpenSettings: () => void;
  workspaceName: string | null;
  workspaceValid: boolean;
  workspacePath: string | null;
  workspaceError?: string;
  workspaceTemporary: boolean;
  workspaceReady: boolean;
  notice: { tone: "ok" | "err"; text: string } | null;
  runPhase: "idle" | "connecting" | "running" | "paused" | "stopped";
  onRun: () => void;
  onStop: () => void;
  onStartOver: () => void;
  runTotal: number;
  sessionTotal: number;
}) {
  const running = runPhase === "connecting" || runPhase === "running";
  const paused = runPhase === "paused";
  const stopped = runPhase === "stopped";
  const live = running || paused;
  return (
    <header className="flex w-full min-w-0 flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="text-[13px] font-semibold tracking-tight">Sharlie Easy Flow</span>
      <button
        type="button"
        className={
          workspaceTemporary || (workspaceValid && workspaceName)
            ? ghostButtonClass
            : `${ghostButtonClass} text-red-600 dark:text-red-600`
        }
        title={workspaceButtonTitle(workspaceName, workspaceValid, workspacePath, workspaceError, workspaceTemporary)}
        onClick={onOpenSettings}
      >
        {workspaceButtonText(workspaceName, workspaceValid, workspaceTemporary)}
      </button>
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
        <button type="button" className={ghostButtonClass} onClick={() => onAdd("human")}>
          Human
        </button>
      </div>
      <button
        type="button"
        className={primaryButtonClass}
        onClick={onSave}
        disabled={saving || !workspaceReady}
        title={workspaceReady ? undefined : "Select a workspace in Settings"}
      >
        {saving ? "Saving" : "Save"}
      </button>
      <label className="flex items-center gap-1 text-xs text-zinc-500">
        Load
        <select
          aria-label="Load pipeline"
          className="max-w-40 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          value={currentId ?? ""}
          disabled={!workspaceReady}
          title={workspaceReady ? undefined : "Select a workspace in Settings"}
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
      <button type="button" className={ghostButtonClass} onClick={onImport} disabled={!canImport}>
        Import
      </button>
      <button type="button" className={ghostButtonClass} onClick={onExport} disabled={!canExport}>
        Export
      </button>
      <button
        type="button"
        className={ghostButtonClass}
        onClick={onRun}
        disabled={!workspaceReady || running || paused}
        title={!workspaceReady ? "Select a workspace in Settings" : paused ? "Waiting for review" : undefined}
      >
        {running ? "Running" : stopped ? "Resume" : "Run"}
      </button>
      {stopped && (
        <button type="button" className={ghostButtonClass} onClick={onStartOver} disabled={!workspaceReady}>
          Start over
        </button>
      )}
      {live && (
        <button
          type="button"
          className="rounded-md border border-red-700 bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onStop}
        >
          Stop
        </button>
      )}
      <span className="rounded-full border border-zinc-200 px-2 py-1 font-mono text-[11px] text-zinc-500 dark:border-zinc-700">
        run {runTotal} · session {sessionTotal}
      </span>
      <button type="button" className={ghostButtonClass} onClick={onToggleTheme}>
        {theme === "dark" ? "Light" : "Dark"}
      </button>
      <button type="button" className={ghostButtonClass} onClick={onOpenLibrary}>
        Library
      </button>
      <button
        type="button"
        className={
          problemCount > 0
            ? `${ghostButtonClass} border-red-300 text-red-600 dark:border-red-800 dark:text-red-600`
            : ghostButtonClass
        }
        title={problemCount > 0 ? `${problemCount} missing item(s). Click for details.` : undefined}
        onClick={onOpenDependencies}
      >
        {problemCount > 0 ? `Dependencies (${problemCount})` : "Dependencies"}
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

const temporaryWorkspaceNote = "Temporary folder. Windows may clean it up. Browse to pick a permanent folder.";

function workspaceButtonText(
  workspaceName: string | null,
  workspaceValid: boolean,
  workspaceTemporary: boolean,
): string {
  if (workspaceTemporary) return "Temp workspace";
  if (workspaceValid && workspaceName) return workspaceName;
  if (workspaceName) return "Workspace missing";
  return "Select workspace";
}

function workspaceButtonTitle(
  workspaceName: string | null,
  workspaceValid: boolean,
  workspacePath: string | null,
  workspaceError: string | undefined,
  workspaceTemporary: boolean,
): string | undefined {
  if (workspaceTemporary) {
    return workspacePath ? `${workspacePath}\n${temporaryWorkspaceNote}` : temporaryWorkspaceNote;
  }
  if (workspaceValid && workspaceName && workspacePath) return workspacePath;
  if (workspaceName) return workspaceError;
  return undefined;
}
