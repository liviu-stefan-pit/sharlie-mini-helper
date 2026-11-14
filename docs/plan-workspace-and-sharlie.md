# Plan: Workspaces, workflow folders, and `.sharlie` import/export

Status: proposed · Date: 2026-11-13 · Phases: 5

This plan adds three features to Sharlie Easy Flow:

1. **Workspace.** In Settings, the user browses for a folder and selects it as the workspace.
2. **Workflow folders.** Every workflow (pipeline) gets its own folder inside the workspace. The workflow JSON is saved there. Agents run with that folder as their working directory, so every artifact they create lands there.
3. **`.sharlie` files.** A workflow can be exported to one `.sharlie` file and imported on another machine. The file carries the skills, rules, and agent files the workflow uses. **An import never fails just because something is missing.** Missing items are imported anyway. Their names show in red, and hovering a red name explains what is missing and how to fix it.

---

## 0. How to use this plan (read first)

### 0.1 One phase = one fresh agent

**Each phase MUST be implemented by a separate, fresh agent session.** Do not let one agent run two phases. A fresh agent has a clean context and is less likely to invent code that does not exist.

Give each phase agent this prompt (replace `N`):

```text
You are implementing Phase N of docs/plan-workspace-and-sharlie.md in this repo.

1. Read AGENTS.md, ARCHITECTURE.md, and section 0, section 1, and the "Phase N" section of
   docs/plan-workspace-and-sharlie.md. Do not implement any other phase.
2. Read every file listed under "Files to read first" for Phase N before editing anything.
3. Implement exactly the steps of Phase N, in order. Use the names, paths, types, routes,
   and messages given in the plan, letter for letter.
4. If the plan does not match the code (a function, file, or field the plan names does not
   exist or looks different), STOP and report the mismatch. Do not guess and do not invent.
5. Finish with the "Done when" checklist of Phase N. All commands must pass.
6. Commit with the commit message given in the phase. Do not push.
```

### 0.2 Order

Phases must run in order: 1 → 2 → 3 → 4 → 5. Each phase assumes the previous phases are merged. Before starting phase N, check that `git log` shows the commit message of phase N-1.

### 0.3 Rules for every phase

These rules apply to every phase. They repeat and extend `AGENTS.md`.

- Only `src/modules/cursor/adapter.ts` may import `@cursor/sdk`. No phase touches that file.
- Never log or return `CURSOR_API_KEY`, MCP `env` values, or MCP `headers` values. `.sharlie` files never contain them either.
- Tests use `node:test` and `node:assert/strict` only. No new dependencies of any kind (runtime or dev). No UI tests, no snapshot tests.
- Every new test file must be added **by name** to the `"test"` script in `package.json` (Windows does not expand globs there).
- Tests that touch the filesystem create a temp folder with `fs.mkdtemp(path.join(os.tmpdir(), "sharlie-<topic>-"))` and remove it in `finally` with `fs.rm(dir, { recursive: true, force: true })`. Follow the style of `tests/library.test.ts`.
- Every new source file starts with the same header comment style the repo uses:
  ```ts
  /**
   * Responsibility: ...
   * Inputs: ...
   * Outputs: ...
   */
  ```
- JSON files are read with a BOM strip: `JSON.parse(raw.replace(/^\uFEFF/, ""))`. JSON files are written with `` `${JSON.stringify(value, null, 2)}\n` `` and `"utf8"`.
- Path comparisons on Windows are case-insensitive. Use `samePath` from `src/modules/library/paths.ts` (or the same rule) when comparing paths.
- `server/nativeDialog.ts`: never set `UseDescriptionForTitle` on a dialog. Windows PowerShell 5.1 runs on .NET Framework, which does not have that property. The scripts must stay static strings. Values that change (like a default file name) go in through an environment variable, never by string concatenation into the script.
- Pipeline JSON stays `version: 1`. New fields are optional, so old files still load.
- The only node kinds stay `agent` and `human`.
- Each phase updates `AGENTS.md`, `ARCHITECTURE.md`, and `README.md` for the behavior it changed (listed under "Docs" in each phase). Keep the existing writing style: short, plain, present-tense sentences.
- Commands that must pass at the end of every phase:
  ```bash
  npm test
  ```
  ```bash
  npm run build
  ```

### 0.4 Glossary

| Word | Meaning |
| --- | --- |
| App root | The folder of this repo, `process.cwd()` of the API process. Holds `.env`, `data/library/`, and (new) `data/app/settings.json`. |
| Workspace | A folder the user picks in Settings. Holds one folder per workflow. Stored in `data/app/settings.json`. |
| Workflow | Same thing as "pipeline" in the code (`PipelineDocument`). The UI may say "workflow". Code keeps the `pipeline` names. |
| Workflow folder | `<workspace>/<pipelineId>/`. Agents run here. Artifacts land here. |
| Meta folder | `<workflow folder>/.sharlie/`. Holds `workflow.json` and `bundle/`. Hidden from artifact tracking. |
| `.sharlie` file | One JSON file that packages a workflow plus its skill, rule, and agent files. |
| Dependency | A skill, rule, or MCP server a workflow needs. Stored in the new optional `PipelineDocument.dependencies`. |
| Missing | A dependency or agent file that cannot be found on this machine. Shown in red with a hover message. |

---

## 1. Target design (the whole picture)

Read this once so every phase points at the same end state.

### 1.1 Disk layout

```text
<app root>/                         (this repo, unchanged location)
  .env                              CURSOR_API_KEY (unchanged)
  data/library/                     selection.json, imports.json (unchanged)
  data/app/settings.json            NEW: { "version": 1, "workspacePath": "C:\\work\\flows" }
  data/pipelines/                   OLD location. No longer read or written after Phase 2.

<workspace>/                        picked by the user, e.g. C:\work\flows
  research-flow-1a2b3c4d/           one folder per workflow, folder name = pipeline id
    .sharlie/
      workflow.json                 the PipelineDocument (version 1)
      bundle/                       only for imported workflows
        skills/<slug>/SKILL.md      (+ the other files of that skill folder)
        rules/<slug>/<file>.mdc
        agents/<slug>/<file>.md
    report.md                       artifacts written by agents
    src/...                         artifacts written by agents
  other-flow-9f8e7d6c/
    ...
```

### 1.2 New API routes (all phases together)

| Phase | Method and path | Purpose |
| --- | --- | --- |
| 1 | `GET /api/workspace` | `{ path: string \| null, valid: boolean, error?: string }` |
| 1 | `POST /api/workspace/browse` | Native folder dialog. `{ cancelled: true }` or `{ path }`. Does not save. |
| 1 | `PUT /api/workspace` | Body `{ path: string \| null }`. Validates and saves. |
| 3 | `POST /api/sharlie/export` | Body `{ id, includeFiles }`. Native save dialog, writes the `.sharlie` file. |
| 4 | `POST /api/sharlie/import` | Native open dialog, reads a `.sharlie` file, creates a new workflow folder. |
| 5 | `POST /api/workflow/health` | Body = a `PipelineDocument`. Returns which agents and dependencies are missing. |

Existing routes change behavior in Phase 2: `/api/pipelines*`, `POST /api/runs`, and `GET /api/files` use the workspace instead of the app root. Without a workspace they answer `409` with `{ "error": "Select a workspace in Settings first" }`.

### 1.3 New `PipelineDocument` field (Phase 3)

```ts
export type DependencyKind = "skill" | "rule" | "mcp";

export type WorkflowDependency = {
  kind: DependencyKind;
  /** Skill or rule title, or MCP server name. Never empty. */
  name: string;
  /** May be "". */
  description: string;
  /**
   * Only for skill and rule. Posix path relative to the workflow folder, e.g.
   * ".sharlie/bundle/skills/code-review/SKILL.md". Absent when the file was not bundled.
   */
  bundledPath?: string;
};

export type PipelineDocument = {
  version: 1;
  id: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  updatedAt: string;
  dependencies?: WorkflowDependency[]; // NEW, optional
};
```

`AgentNodeData.agentPath` keeps its meaning, with one addition from Phase 4: **if `agentPath` is not absolute, it is relative to the workflow folder.** Imported agents use this (`.sharlie/bundle/agents/<slug>/<file>.md`), so moving the workspace does not break them.

### 1.4 How "missing" works (Phases 4 and 5)

| Thing | Found when | Shown as |
| --- | --- | --- |
| Agent file of a node | `agentPath` (resolved against the workflow folder if relative) is an existing `.md` file | Normal. Otherwise the agent name is red with hover text. |
| Model of a node | `modelId` is in the `/api/models` list | Normal. Otherwise the model is red with hover text. |
| Skill / rule dependency | Its `bundledPath` file exists, **or** a library skill/rule with the same title (case-insensitive, trimmed) exists | Normal. Otherwise red. |
| MCP dependency | A server with the same name exists in `~/.cursor/mcp.json` and is enabled in the Library | Normal. Exists but disabled: amber. Not found: red. |

Run behavior: a missing **agent** blocks Run with a clear `400` message (the step would fail anyway). Missing **skills, rules, and MCP servers** do not block Run; the run starts without them and the UI shows a warning.

---

## Phase 1 — Workspace setting

**Run this phase in its own fresh agent.**

### Goal

The user can open Settings, click **Browse…**, pick a folder, and that folder is saved as the workspace. The top bar shows the workspace name. Nothing else changes yet: pipelines still live in `data/pipelines` until Phase 2.

### Files to read first

- `AGENTS.md`, `ARCHITECTURE.md`
- `server/index.ts`, `server/routes/context.ts`, `server/http.ts`, `server/nativeDialog.ts`
- `server/routes/settings.ts`, `server/routes/library.ts`, `server/routes/pipelines.ts`, `server/routes/runs.ts`, `server/routes/files.ts`, `server/routes/skills.ts`, `server/routes/agents.ts`
- `src/modules/library/paths.ts`, `src/modules/library/json.ts`
- `src/modules/canvas/SettingsModal.tsx`, `src/modules/canvas/TopBar.tsx`, `src/modules/canvas/api.ts`, `src/App.tsx`
- `tests/library.test.ts` (test style only), `package.json`, `.gitignore`

### Steps

**1.1 Rename `workspaceRoot` to `appRoot` in the server.**
The current `workspaceRoot` is really the app root. From now on "workspace" means the user's folder, so the old name must go.

- `server/routes/context.ts`: rename the field `workspaceRoot: string` to `appRoot: string`. Update the header comment ("Inputs: Node request, response, parsed URL, and app root.").
- `server/index.ts`: `const appRoot = process.cwd();` and `const ctx: RouteContext = { req, res, url, appRoot };`.
- Every `ctx.workspaceRoot` / destructured `workspaceRoot` in `server/routes/*.ts` becomes `appRoot`. Use search: `workspaceRoot` must not appear anywhere under `server/` afterwards.
- Do **not** rename the parameter names inside `src/modules/storage/pipelines.ts` or `src/modules/library/paths.ts` in this phase. Behavior must not change.

**1.2 Create `src/modules/workspace/settings.ts`.**

```ts
export type AppSettings = { version: 1; workspacePath: string | null };

export function appSettingsPath(appRoot: string): string;          // <appRoot>/data/app/settings.json
export async function readAppSettings(appRoot: string): Promise<AppSettings>;
export async function writeAppSettings(appRoot: string, settings: AppSettings): Promise<void>;
```

Rules:
- `readAppSettings`: file missing, unreadable (`isSoftFsError` from `src/modules/library/json.ts`), not valid JSON, not an object, or `workspacePath` not a non-empty string → return `{ version: 1, workspacePath: null }`. **Never throw for a bad file**; a broken settings file must not crash the API.
- `writeAppSettings`: `fs.mkdir(dirname, { recursive: true })`, then write to `settings.json.tmp`, then `fs.rename` to `settings.json` (atomic replace).

**1.3 Create `src/modules/workspace/validate.ts`.**

```ts
export type WorkspaceCheck = { ok: true; path: string } | { ok: false; error: string };
export async function validateWorkspacePath(candidate: string, appRoot: string): Promise<WorkspaceCheck>;
```

Check in this exact order and return the first failing message exactly as written:

| # | Check | Error message |
| --- | --- | --- |
| 1 | `candidate` is a string and `candidate.trim() !== ""` | `Workspace path is empty` |
| 2 | `path.isAbsolute(candidate.trim())` | `Workspace path must be absolute` |
| 3 | `fs.realpath` succeeds | `Workspace folder does not exist` |
| 4 | `fs.stat(real).isDirectory()` | `Workspace path is not a folder` |
| 5 | `real` is not a filesystem root (`path.parse(real).root === real` means root) | `Pick a folder, not a whole drive` |
| 6 | `real` is not the app root, not inside it, and does not contain it (compare `fs.realpath(appRoot)`, case-insensitive on Windows) | `The workspace cannot be the app folder, inside it, or contain it` |
| 7 | Writable: write `<real>/.sharlie-write-test` with `"ok"`, then delete it. Any error → fail | `Workspace folder is not writable` |

On success return `{ ok: true, path: real }` (the real path, not the typed one).

Why rule 6: the file preview route and the agents both work inside the workspace. If the workspace contained the app folder, agents and previews could reach the app `.env`.

**1.4 Create `src/modules/workspace/index.ts`.**

```ts
export { appSettingsPath, readAppSettings, writeAppSettings, type AppSettings } from "./settings";
export { validateWorkspacePath, type WorkspaceCheck } from "./validate";

export type ActiveWorkspace =
  | { path: string; valid: true }
  | { path: string; valid: false; error: string }
  | { path: null; valid: false };

/** Reads settings and re-validates the stored folder (it may have been deleted since). */
export async function getActiveWorkspace(appRoot: string): Promise<ActiveWorkspace>;
```

`getActiveWorkspace`: `workspacePath === null` → `{ path: null, valid: false }`. Otherwise run `validateWorkspacePath` (all 7 checks, including the write test; the cost is one tiny file write per call); ok → `{ path: check.path, valid: true }`; not ok → `{ path: storedPath, valid: false, error: check.error }`.

**1.5 Add a `workspace` dialog to `server/nativeDialog.ts`.**

- Add `WORKSPACE_SCRIPT`: copy `SKILL_SCRIPT` exactly, change only the description line to `"$dialog.Description = 'Select a workspace folder'"`. Also add `"$dialog.ShowNewFolderButton = $true"` right after the description line.
- Add `workspace: WORKSPACE_SCRIPT` to `DIALOG_SCRIPTS`.
- Change the signature to `openNativeDialog(kind: keyof typeof DIALOG_SCRIPTS)`.
- Update the file header comment ("Inputs: dialog kind (skill, rule, agent, workspace)...").

**1.6 Create `server/routes/workspace.ts`.**

```ts
export async function handleWorkspace(ctx: RouteContext): Promise<boolean>;
/** For other routes: returns the workspace path, or sends 409 and returns null. */
export async function requireWorkspace(ctx: RouteContext): Promise<string | null>;
```

Routes:

- `GET /api/workspace` → `200` with the `ActiveWorkspace` value from `getActiveWorkspace(ctx.appRoot)` (shape `{ path, valid, error? }`).
- `POST /api/workspace/browse` → `openNativeDialog("workspace")`. Dialog throws → `500 { error: "Could not open the folder dialog" }`. Cancelled → `200 { cancelled: true }`. Picked → `200 { path: picked.path }`. **Does not save.**
- `PUT /api/workspace` → body via `readJson`. Body must be an object with `path` being a string or `null`, else `400 { error: "path must be a string or null" }`.
  - `null` → `writeAppSettings(appRoot, { version: 1, workspacePath: null })` → `200 { path: null, valid: false }`.
  - string → `validateWorkspacePath`. Not ok → `400 { error }`. Ok → save `check.path` → `200 { path: check.path, valid: true }`.
- Any other method on these paths → `405 { error: "Method not allowed" }`.

`requireWorkspace`: calls `getActiveWorkspace`; if `valid` return `path`; else `sendJson(ctx.res, 409, { error: "Select a workspace in Settings first" })` and return `null`. (Used from Phase 2 on.)

Register `handleWorkspace` in `server/index.ts` **before** `handleSettings`.

Keep `server/routes/settings.ts` unchanged apart from the rename. Its responses stay `{ configured }` only.

**1.7 `.gitignore`.** Add the line `data/app/`.

**1.8 Browser API client (`src/modules/canvas/api.ts`).**

```ts
export type WorkspaceStatus = { path: string | null; valid: boolean; error?: string };
export async function fetchWorkspace(): Promise<WorkspaceStatus>;                 // GET /api/workspace
export async function browseWorkspace(): Promise<{ cancelled: true } | { path: string }>; // POST /api/workspace/browse
export async function saveWorkspace(path: string | null): Promise<WorkspaceStatus>;       // PUT /api/workspace
```

Use the existing `requestJson` helper.

**1.9 Settings modal (`src/modules/canvas/SettingsModal.tsx`).**

- New optional prop `onWorkspaceChanged?: (status: WorkspaceStatus) => void`.
- On open, also call `fetchWorkspace()` and keep it in state `workspace`.
- Add a **Workspace** section **above** the `CURSOR_API_KEY` label:
  - Label text `WORKSPACE` (same classes as the `CURSOR_API_KEY` label).
  - Shows the path in a `font-mono text-[11px] break-all` paragraph, or `No workspace selected.` when `path` is null.
  - When `path !== null && !valid`, show `error` in `text-red-600 text-[11px]`.
  - Button **Browse…** (`type="button"`, `ghostButtonClass`): `browseWorkspace()` → if cancelled do nothing → else `saveWorkspace(path)` → set state → call `onWorkspaceChanged(status)`. Show errors from either call in the existing `message` line.
  - Button **Clear** (`type="button"`, `ghostButtonClass`, disabled when `path === null`): `saveWorkspace(null)` → same handling.
  - One help line in `text-xs text-zinc-500`: `Each workflow gets its own folder in the workspace. Agents save their files there.`
- Both buttons must be `type="button"` so they do not submit the API key form.

**1.10 App and top bar.**

- `src/App.tsx`: state `const [workspace, setWorkspace] = useState<WorkspaceStatus>({ path: null, valid: false });` loaded with `fetchWorkspace()` on mount (on error keep the default). Pass `onWorkspaceChanged={setWorkspace}` to `SettingsModal`.
- `src/modules/canvas/TopBar.tsx`: new props `workspaceName: string | null` and `workspaceValid: boolean`. Render a button right after the app title:
  - valid → text = folder name (last path segment), `title` = full path, `ghostButtonClass`.
  - path set but invalid → text `Workspace missing`, classes `ghostButtonClass` plus `text-red-600`, `title` = the error.
  - no path → text `Select workspace`, `ghostButtonClass` plus `text-red-600`.
  - Click → `onOpenSettings()`.
- In `App.tsx` compute `workspaceName` with a small helper: split on `/` and `\\`, take the last non-empty part.

### Tests

Create `tests/workspace.test.ts` and add it to the `npm test` script:

1. `validateWorkspacePath("", appRoot)` → `Workspace path is empty`.
2. Relative path `"some/folder"` → `Workspace path must be absolute`.
3. Absolute path that does not exist → `Workspace folder does not exist`.
4. A file instead of a folder → `Workspace path is not a folder`.
5. `path.parse(os.tmpdir()).root` → `Pick a folder, not a whole drive`.
6. With a temp `appRoot`: the app root itself, a folder inside it, and its parent → all `The workspace cannot be the app folder, inside it, or contain it`.
7. A fresh temp folder → `{ ok: true, path: <its realpath> }` and `.sharlie-write-test` does not exist afterwards.
8. `readAppSettings` on an empty temp app root → `{ version: 1, workspacePath: null }`.
9. `writeAppSettings` then `readAppSettings` round-trips the path.
10. Corrupt `data/app/settings.json` (`"{not json"`) → `readAppSettings` returns `workspacePath: null` and does not throw.
11. `getActiveWorkspace` returns `valid: false` with `error: "Workspace folder does not exist"` after the stored folder is deleted.

### Docs

- `AGENTS.md`: Layout gets `src/modules/workspace/` and `server/routes/workspace.ts`. Say `RouteContext` carries `appRoot`. Add the three workspace routes. Add `data/app/` to the gitignored list.
- `ARCHITECTURE.md`: a short "Workspace" paragraph (where it is stored, validation rules 1–7 summarized).
- `README.md`: Quickstart step "Open Settings and pick a workspace folder."

### Done when

- [ ] `grep -rn workspaceRoot server/` prints nothing.
- [ ] Settings → Browse… → pick a folder → the top bar shows the folder name; restarting the API keeps it.
- [ ] Picking the repo folder itself shows `The workspace cannot be the app folder, inside it, or contain it`.
- [ ] Saving, loading, and running pipelines behave exactly as before.
- [ ] `npm test` and `npm run build` pass.
- [ ] Commit: `Add a workspace folder setting with validation and a Settings picker.`

---

## Phase 2 — One folder per workflow

**Run this phase in its own fresh agent.**

### Goal

Workflows are saved to `<workspace>/<id>/.sharlie/workflow.json`. Runs use `<workspace>/<id>/` as the agent working directory, so artifacts land in the workflow folder. File preview reads from the workspace. Without a valid workspace, Save, Load, and Run are disabled.

### Files to read first

- Section 1.1 of this plan
- `src/modules/storage/pipelines.ts`, `server/routes/pipelines.ts`, `server/routes/runs.ts`, `server/routes/files.ts`, `server/routes/workspace.ts` (from Phase 1)
- `src/modules/runs/engine.ts`, `src/modules/artifacts/track.ts`
- `src/App.tsx`, `src/modules/canvas/TopBar.tsx`, `src/modules/canvas/flow.ts`, `src/modules/canvas/FilePreview.tsx`, `src/modules/canvas/HumanNode.tsx`
- `tests/graph.test.ts` (check whether it imports `pipelinesDir`)

### Steps

**2.1 Storage (`src/modules/storage/pipelines.ts`).**

Add constants and helpers:

```ts
export const WORKFLOW_META_DIR = ".sharlie";
export const WORKFLOW_FILE = "workflow.json";

export function workflowDir(workspace: string, id: string): string;   // path.join(workspace, id); throws PipelineValidationError("Invalid pipeline id") when !isSafePipelineId(id)
export function workflowFile(workspace: string, id: string): string;  // path.join(workflowDir(workspace, id), WORKFLOW_META_DIR, WORKFLOW_FILE)
export function newPipelineId(name: string): string;                  // server-side copy of makePipelineId from src/modules/canvas/flow.ts, using randomUUID from "node:crypto"
```

Change the existing functions (rename the first parameter from `workspaceRoot` to `workspace` in all of them):

- `listPipelines(workspace)`: `fs.readdir(workspace, { withFileTypes: true })`. For each entry: skip if not a directory, skip if `!isSafePipelineId(entry.name)`, skip if `workflowFile` does not exist. Read it with `readPipeline`; skip on any error (same `try/catch → continue` as today). **Do not create the workspace folder** (no `mkdir`). If `readdir` fails with a soft error, return `[]`.
- `readPipeline(workspace, id)`: reads `workflowFile(workspace, id)`. Missing → `null`. Rest unchanged.
- `writePipeline(workspace, input, id)`: `fs.mkdir(path.join(workflowDir(workspace, id), WORKFLOW_META_DIR), { recursive: true })`, then write `workflow.json.tmp` and `fs.rename` it to `workflow.json`.
- Delete `pipelinesDir`. Search for every use and remove it. Old files in `data/pipelines/` are left on disk untouched and are no longer read.

Note: the folder name is the pipeline id (for example `research-flow-1a2b3c4d`). Renaming a workflow in the UI does **not** rename its folder. That is intended.

**2.2 Pipelines route (`server/routes/pipelines.ts`).**

At the top of `handlePipelines`, after deciding the path belongs to this handler (both `/api/pipelines` and `/api/pipelines/:id`), call `const workspace = await requireWorkspace(ctx); if (!workspace) return true;`. Pass `workspace` instead of the app root to `listPipelines`, `readPipeline`, `writePipeline`. The `:id` regex stays `^\/api\/pipelines\/([^/]+)$`.

**2.3 Artifact tracking (`src/modules/artifacts/track.ts`).**

Add `".sharlie"` to `SKIP_SEGMENTS`. Update the header comment to say the meta folder is skipped.

**2.4 Engine (`src/modules/runs/engine.ts`).**

- `startRun` options get `artifactPrefix: string` (the pipeline id). Store it on `RunRecord`.
- In `finishSend`, every hit becomes `{ path: \`${run.artifactPrefix}/${hit.path}\`, agentNodeId: hit.agentNodeId }` before it is pushed to `run.artifacts` and emitted. So artifact paths are **relative to the workspace**, which is what the file preview route expects.
- Nothing else in the engine changes.

**2.5 Runs route (`server/routes/runs.ts`, `POST /api/runs` only).**

Order inside the handler:

1. `const workspace = await requireWorkspace(ctx); if (!workspace) return true;`
2. `const doc = coercePipeline(...)` (unchanged).
3. If `!isSafePipelineId(doc.id)` → `400 { error: "Save the workflow before running it" }`.
4. `resolvePipeline(doc)` (unchanged).
5. API key check (unchanged).
6. `const cwd = workflowDir(workspace, doc.id); await fs.mkdir(cwd, { recursive: true });`
7. `startRun({ steps, apiKey, cwd, artifactPrefix: doc.id, catalog, mcpServers })`.

`loadEnabledLibrary(ctx.appRoot)` keeps using the app root (the library lives in the app, not the workspace).

**2.6 File preview (`server/routes/files.ts`).**

- Root becomes the workspace: `const workspace = await requireWorkspace(ctx); if (!workspace) return true;` then `root = await fs.realpath(workspace)`.
- Keep the existing `.env` refusal and the `data/library/mcp.json` refusal as they are.
- Add one more refusal (→ `403 { error: "Forbidden" }`): the **file name** of `real` is `.env` or starts with `.env.` (any folder depth).
- Update the header comment.

**2.7 UI.**

- `src/App.tsx`:
  - `const workspaceReady = workspace.valid;`
  - Pipelines list: fetch only when `workspaceReady`. Re-fetch whenever `workspace.path` changes. When not ready, `setPipelines([])`.
  - When the workspace changes (in the `onWorkspaceChanged` handler from Phase 1), reset the canvas: `setCurrentId(null)`, `setName("Untitled")`, `setNodes([])`, `setEdges([])`, `setSelectedId(null)`, `setPreviewFile(null)`.
  - Empty-canvas hint: when `!workspaceReady` show `Select a workspace in Settings to start.` instead of the current hint.
- `src/modules/canvas/TopBar.tsx`: new prop `workspaceReady: boolean`. When false: Save, the Load `<select>`, and Run are `disabled` and have `title="Select a workspace in Settings"`. The Agent and Human add buttons stay enabled.

### Tests

Create `tests/pipelines-storage.test.ts` and add it to `npm test`:

1. `writePipeline(tmp, doc, "flow-a")` creates `tmp/flow-a/.sharlie/workflow.json`, and no `workflow.json.tmp` is left.
2. `listPipelines(tmp)` returns that summary.
3. `listPipelines` ignores: a folder without `.sharlie/workflow.json`, a folder with an unsafe name (e.g. `bad name`), a plain file in the workspace root, and a folder whose `workflow.json` is invalid JSON.
4. `readPipeline(tmp, "missing")` → `null`.
5. `workflowDir(tmp, "../evil")` throws `PipelineValidationError`.
6. `newPipelineId("My Flow!")` matches `/^my-flow-[0-9a-f]{8}$/`.
7. `snapshotFiles` on a folder containing `.sharlie/workflow.json` and `out.md` returns only `out.md`.

Use a minimal valid document (copy the agent and human node shapes from `tests/graph.test.ts` or build them with all required fields: `modelId`, `agentPath`, `agentName`, `status`, `elapsedMs`, `retryCount`, `tokens`).

### Docs

- `AGENTS.md` and `ARCHITECTURE.md`: replace every "`data/pipelines`" statement with the workflow folder layout. Say Run uses the workflow folder as `cwd`, artifact paths are relative to the workspace, and `GET /api/files` reads inside the workspace and also refuses any `.env` / `.env.*` file. Say routes answer `409` without a workspace.
- `README.md`: "Save writes `<workspace>/<id>/.sharlie/workflow.json`." Remove the `data/pipelines` sentences.

### Done when

- [ ] With a workspace set: Save creates `<workspace>/<id>/.sharlie/workflow.json`. Load lists it.
- [ ] A run creates files inside `<workspace>/<id>/`, and the human node lists them as `<id>/<file>`; Preview opens them.
- [ ] Without a workspace: Save, Load, and Run are disabled; `GET /api/pipelines` answers `409`.
- [ ] `npm test` and `npm run build` pass.
- [ ] Commit: `Save each workflow in its own workspace folder and run agents there.`

---

## Phase 3 — `.sharlie` format and Export

**Run this phase in its own fresh agent.**

### Goal

Define the `.sharlie` file format, add the optional `dependencies` field to workflows, and let the user export the current workflow to a `.sharlie` file with a native **Save as** dialog. No import yet.

### Files to read first

- Sections 1.3 and 1.4 of this plan
- `src/modules/graph/types.ts`, `src/modules/storage/pipelines.ts`, `server/routes/runs.ts` (`coercePipeline`)
- `src/modules/library/index.ts`, `src/modules/library/scan.ts`, `src/modules/library/types.ts`, `src/modules/library/paths.ts`, `src/modules/library/json.ts`
- `src/modules/agents/agentFile.ts`
- `server/nativeDialog.ts`, `server/routes/workspace.ts`, `server/index.ts`
- `src/App.tsx`, `src/modules/canvas/TopBar.tsx`, `src/modules/canvas/api.ts`, `src/modules/canvas/SettingsModal.tsx` (modal styling to copy)

### Steps

**3.1 Types (`src/modules/graph/types.ts`).** Add `DependencyKind`, `WorkflowDependency`, and `dependencies?: WorkflowDependency[]` on `PipelineDocument` exactly as in section 1.3.

**3.2 Parse dependencies leniently (`src/modules/storage/pipelines.ts`).**

```ts
export function parseDependencies(value: unknown): WorkflowDependency[];
export function isSafeRelativePath(value: string): boolean;
```

- `isSafeRelativePath`: true only if the string is non-empty, at most 240 characters, contains no `\0` and no `\\`, does not start with `/`, does not match `/^[a-zA-Z]:/`, and no segment of `value.split("/")` is `""`, `"."`, or `".."`.
- `parseDependencies`: not an array → `[]`. For each entry: **drop it silently** (no throw) unless it is an object with `kind` in `skill | rule | mcp` and a `name` string that is non-empty after trim. `description` = string or `""`. `bundledPath` kept only when `kind !== "mcp"` and it is a string passing `isSafeRelativePath`. Drop exact duplicates of `kind` + lower-cased trimmed `name` (first wins).
- `normalizePipeline`: if `input.dependencies !== undefined`, set `dependencies: parseDependencies(input.dependencies)` on the result. If undefined, do not add the field.
- `server/routes/runs.ts` `coercePipeline`: same rule, using `parseDependencies`.

**3.3 Keep dependencies on the canvas (`src/App.tsx`).** Without this, Save would silently drop them.

- State: `const [dependencies, setDependencies] = useState<WorkflowDependency[]>([]);`
- `onLoad`: `setDependencies(doc.dependencies ?? [])`.
- Workspace reset (Phase 2): `setDependencies([])`.
- `pipelineDocument()`: add `dependencies` to the returned object.

**3.4 Format module `src/modules/sharlie/format.ts`.**

```ts
export const SHARLIE_FORMAT = "sharlie-workflow";
export const SHARLIE_FORMAT_VERSION = 1;
export const SHARLIE_EXTENSION = ".sharlie";

export const LIMITS = {
  maxPackageBytes: 20 * 1024 * 1024,   // whole file
  maxFileBytes: 1024 * 1024,           // one bundled file
  maxSkillBytes: 5 * 1024 * 1024,      // one skill folder
  maxSkillFiles: 100,                  // one skill folder
} as const;

export type SharlieFile = { path: string; encoding: "utf8" | "base64"; content: string };

export type SharlieItem = {
  kind: "skill" | "rule" | "agent";
  /** Unique inside the package: "skill-1", "rule-1", "agent-1", ... */
  ref: string;
  name: string;
  description: string;
  /** Path of the main file inside `files`: "SKILL.md" for skills, the file name for rules and agents. */
  entry: string;
  /** null = reference only (not bundled, or could not be read at export time). */
  files: SharlieFile[] | null;
};

export type SharliePackage = {
  format: "sharlie-workflow";
  formatVersion: 1;
  exportedAt: string;                     // ISO time
  app: { name: "Sharlie Easy Flow"; version: string };
  workflow: PipelineDocument;             // run state reset, agentPath "", no dependencies field
  nodeAgents: Record<string, string>;     // agent node id -> agent item ref
  items: SharlieItem[];
  mcps: { name: string }[];               // names only, never command/args/url/env/headers
};

export class SharlieFormatError extends Error {} // name = "SharlieFormatError"
```

**3.5 Packing `src/modules/sharlie/pack.ts`.**

```ts
export async function readBundleFiles(
  rootDir: string,
  options: { maxFiles: number; maxTotalBytes: number; maxFileBytes: number },
): Promise<{ files: SharlieFile[]; warnings: string[]; truncated: boolean }>;

export async function buildSharliePackage(input: {
  doc: PipelineDocument;               // the saved workflow
  workflowDir: string;                 // <workspace>/<id>
  enabledSkills: CatalogEntry[];       // title, description, path (absolute SKILL.md)
  enabledRules: CatalogEntry[];
  enabledMcpNames: string[];
  includeFiles: boolean;
  appVersion: string;
}): Promise<{ pkg: SharliePackage; warnings: string[] }>;
```

`readBundleFiles` rules:
- Walk `rootDir` recursively. Skip folders named `node_modules`, `.git`, `dist`, `.sharlie`. Skip symbolic links. Skip files named `.env` or starting with `.env.`.
- Paths in the result are posix and relative to `rootDir` (`path.relative(...).split(path.sep).join("/")`). Sort by path.
- A file larger than `maxFileBytes` is skipped with warning `Skipped <relPath>: larger than 1 MB`.
- Stop adding when the file count reaches `maxFiles` or the byte total would pass `maxTotalBytes`; set `truncated: true`.
- Encoding: read as a `Buffer`. If it contains a `0` byte in the first 8000 bytes → `base64`. Otherwise decode as utf8 and check `Buffer.from(text, "utf8").equals(buffer)`; equal → `utf8`, else `base64`.

`buildSharliePackage` rules, in order:

1. **Workflow copy.** Deep copy `doc` with `structuredClone`. Remove `dependencies`. For agent nodes set `status: "idle"`, `elapsedMs: 0`, `retryCount: 0`, `tokens: {}`, delete `lastOutput`, set `agentPath: ""` (keep `agentName` and `modelId`). For human nodes set `status: "idle"`, `artifactPaths: []`.
2. **Agents.** For every agent node of the original `doc` with a non-empty `agentPath`: resolve it (`path.isAbsolute(p) ? p : path.resolve(workflowDir, p)`). Nodes that point to the same file (`samePath`) share one item. New item: `kind: "agent"`, `ref: "agent-<n>"`, `name: node.data.agentName || file stem`, `description` from `describeAgentFile` when readable else `""`, `entry: path.basename(file)`. `files`: when `includeFiles` and the file is readable → `[{ path: entry, encoding: "utf8", content }]`; otherwise `null`, and if it was not readable add warning `Agent "<name>" could not be read and was exported as a name only`. Set `nodeAgents[node.id] = ref`. Nodes with an empty `agentPath` get no entry.
3. **Skills.** Candidate list = `enabledSkills` (as `{ name: title, description, path }`) followed by `doc.dependencies` of kind `skill` (path = `path.resolve(workflowDir, bundledPath)` when `bundledPath` is set, else no path). Deduplicate by lower-cased trimmed name, first wins. For each: `ref: "skill-<n>"`, `entry: "SKILL.md"` by default. When `includeFiles` and a path exists and is readable: `rootDir = path.dirname(skillPath)`, `entry` = posix relative path of the skill file from `rootDir`, `files` = `readBundleFiles(rootDir, { maxFiles: LIMITS.maxSkillFiles, maxTotalBytes: LIMITS.maxSkillBytes, maxFileBytes: LIMITS.maxFileBytes })`. If the result does not contain `entry`, put the entry file first and skip the rest (warning `Skill "<name>" is too large; only its main file was exported`). If `truncated`, add warning `Skill "<name>" was cut to the first 100 files / 5 MB`. No path or unreadable → `files: null` and warning `Skill "<name>" could not be read and was exported as a name only` (only when `includeFiles`).
4. **Rules.** Same as skills, but single file: `ref: "rule-<n>"`, `entry: path.basename(rulePath)`, `files: [that one file]`.
5. **MCPs.** `enabledMcpNames` plus `doc.dependencies` of kind `mcp`, deduplicated case-insensitively, sorted by name, mapped to `{ name }`.
6. Return the package with `format`, `formatVersion`, `exportedAt: new Date().toISOString()`, `app: { name: "Sharlie Easy Flow", version: appVersion }`.

**3.6 Parsing `src/modules/sharlie/parse.ts`.**

```ts
export function parseSharliePackage(text: string): { pkg: SharliePackage; warnings: string[] };
```

Hard errors (throw `SharlieFormatError` with exactly these messages) — these are the **only** reasons an import may fail:

| Condition | Message |
| --- | --- |
| Not valid JSON (after BOM strip) | `This is not a .sharlie file (invalid JSON)` |
| Not an object, or `format !== "sharlie-workflow"` | `This is not a .sharlie file` |
| `formatVersion` is not a number | `This .sharlie file has no format version` |
| `formatVersion > 1` | `This .sharlie file was made by a newer Sharlie Easy Flow. Update the app to import it.` |
| `normalizePipeline(workflow, "import-check")` throws | `The workflow inside this .sharlie file is damaged: <original message>` |

Everything else is lenient. Collect a warning and continue:
- `items` not an array → `[]`. An item that is not an object, has an unknown `kind`, or has an empty `name` → dropped with warning `Dropped an unreadable item from the file`.
- `ref` missing or duplicated → generate `<kind>-x<n>`.
- `files` not an array → `null`. A file with an unsafe `path` (`isSafeRelativePath` false), an unknown `encoding`, or non-string `content` → dropped with warning `Dropped unsafe file "<path>" from <kind> "<name>"`. If the item's `entry` is no longer among its files → `files: null` and warning `<Kind> "<name>" has no main file and will be treated as missing`.
- `nodeAgents` not an object → `{}`. Values that are not refs of an `agent` item are dropped.
- `mcps` not an array → `[]`. Keep only entries with a non-empty string `name`.

**3.7 Dialog for saving (`server/nativeDialog.ts`).**

- New kind `"sharlie-save"`: `System.Windows.Forms.SaveFileDialog` with `Title = 'Export workflow'`, `Filter = 'Sharlie workflow (*.sharlie)|*.sharlie'`, `DefaultExt = 'sharlie'`, `AddExtension = $true`, `OverwritePrompt = $true`, `FileName = $env:SHARLIE_DEFAULT_NAME`. Rest identical to `RULE_SCRIPT` (owner form, `try/finally`, writes `$dialog.FileName`).
- New signature: `openNativeDialog(kind, options?: { defaultFileName?: string })`. `runStaticScript(script, env?)` passes `env: { ...process.env, SHARLIE_DEFAULT_NAME: safeName }` to `spawn` when given.
- `safeName`: remove characters `<>:"/\|?*` and all control characters, trim, cut to 100 characters, fallback `workflow`, then make sure it ends with `.sharlie`.
- The script text stays static. Do **not** build the script with the file name.

**3.8 Route `server/routes/sharlie.ts`** (new), registered in `server/index.ts` **before** `handlePipelines`.

`POST /api/sharlie/export`, body `{ id: string, includeFiles: boolean }`:
1. `requireWorkspace`. Body must be an object with a safe `id` (`isSafePipelineId`) and boolean `includeFiles`; else `400 { error: "id and includeFiles are required" }`.
2. `readPipeline(workspace, id)`; `null` → `404 { error: "Save the workflow before exporting it" }`.
3. `scanLibrary({ cursorHome: defaultCursorHome(), appLibraryRoot: libraryRoot(ctx.appRoot) })`; take enabled skills, rules (as `CatalogEntry`: `{ title, description, path }`), and enabled MCP names.
4. `appVersion`: read `<appRoot>/package.json` `.version`; any error → `"0.0.0"`.
5. `buildSharliePackage(...)`. `const text = \`${JSON.stringify(pkg, null, 2)}\n\``. If `Buffer.byteLength(text) > LIMITS.maxPackageBytes` → `413 { error: "The workflow package is larger than 20 MB. Export without files or remove large skills." }`.
6. `openNativeDialog("sharlie-save", { defaultFileName: doc.name })`. Throws → `500 { error: "Could not open the save dialog" }`. Cancelled → `200 { cancelled: true }`.
7. If the chosen path does not end with `.sharlie` (case-insensitive), append it. Write the file (`utf8`).
8. `200 { path, bytes, warnings }`.

**3.9 UI.**

- `src/modules/canvas/api.ts`: `exportWorkflow(id: string, includeFiles: boolean): Promise<{ cancelled: true } | { path: string; bytes: number; warnings: string[] }>`.
- New `src/modules/canvas/WarningsModal.tsx`: props `{ open: boolean; title: string; intro?: string; warnings: string[]; onClose: () => void }`. Same overlay and card classes as `SettingsModal`. Renders `intro` (if any) and a `<ul>` of warnings in `text-xs text-amber-700 dark:text-amber-400`. A **Close** button. Phase 4 reuses it.
- New `src/modules/canvas/ExportModal.tsx`: props `{ open: boolean; onClose: () => void; onExport: (includeFiles: boolean) => void; busy: boolean }`. Content: title `Export workflow`; a checkbox, checked by default, label `Include skill, rule, and agent files (recommended)`; help line `Without files, the person who imports it must already have the same skills, rules, and agents. MCP servers are always exported by name only, without secrets.`; buttons **Cancel** and **Export…**.
- `TopBar.tsx`: new props `onExport: () => void` and `canExport: boolean`. Button **Export** after the Load select, disabled when `!canExport`.
- `App.tsx`: `canExport = workspaceReady && runPhase === "idle"`. Clicking Export opens `ExportModal`. On confirm: run `onSave()` first (so the file on disk matches the canvas; make `onSave` return the saved id or `null` on failure), then `exportWorkflow(savedId, includeFiles)`. Cancelled → close quietly. Success → notice `Exported to <file name>`; if `warnings.length > 0` open `WarningsModal` with title `Exported with warnings`. Error → error notice.

### Tests

Create `tests/sharlie.test.ts` and add it to `npm test`. Use temp folders for a fake workflow folder, a skill folder, a rule file, and an agent file.

1. `readBundleFiles` skips `node_modules/`, `.git/`, `.env`, `.env.local`; returns posix paths sorted; a file with a `0` byte is `base64` and decodes back to the same bytes; a 2 MB file is skipped with the warning.
2. `buildSharliePackage` with `includeFiles: true`: skill item has `entry: "SKILL.md"` and contains `scripts/run.py`; rule item has one file; two agent nodes pointing at the same file share one item and both appear in `nodeAgents`; workflow copy has `agentPath: ""`, `status: "idle"`, `tokens: {}`, no `lastOutput`, human `artifactPaths: []`, and no `dependencies`.
3. `includeFiles: false` → every item has `files: null` and there are no warnings.
4. A missing agent file with `includeFiles: true` → item `files: null` and the warning text from step 3.5.2.
5. `mcps` contains names only; check `JSON.stringify(pkg)` does not contain an env value you put in a fake MCP (there is no MCP input with env, so assert the object keys of each `mcps` entry are exactly `["name"]`).
6. `parseSharliePackage(JSON.stringify(pkg))` round-trips with no warnings.
7. Each hard error message from the 3.6 table.
8. An item with a file path `../evil.md` → that file dropped with warning; the import result still has the item.
9. `parseDependencies` drops bad entries, drops `bundledPath: "../x"`, and dedupes by kind + name.
10. `normalizePipeline` keeps `dependencies` when present and does not add the field when absent.

### Docs

- `AGENTS.md`: Layout gets `src/modules/sharlie/`. Key files: `format.ts`, `pack.ts`, `parse.ts`, `server/routes/sharlie.ts`. Conventions: `.sharlie` never contains MCP command/args/url/env/headers or `CURSOR_API_KEY`; `dependencies` is optional and parsed leniently.
- `ARCHITECTURE.md`: a "`.sharlie` format" section (the `SharliePackage` shape and limits).
- `README.md`: an "Export" section.

### Done when

- [ ] Export opens a Save dialog with `<workflow name>.sharlie` prefilled and writes a readable JSON file.
- [ ] Opening the file in a text editor shows skill/rule/agent contents and no secrets.
- [ ] Saving and reloading a workflow keeps `dependencies` (test it by hand-editing a `workflow.json` to add one, then Load + Save).
- [ ] `npm test` and `npm run build` pass.
- [ ] Commit: `Add the .sharlie format, workflow dependencies, and workflow export.`

---

## Phase 4 — Import `.sharlie`

**Run this phase in its own fresh agent.**

### Goal

The user clicks **Import**, picks a `.sharlie` file, and gets a new workflow folder in the workspace. Bundled skills, rules, and agents are extracted into `.sharlie/bundle/`. **Anything that cannot be bundled or found is imported as missing, never as an error.** The user sees a warnings list.

### Files to read first

- Sections 1.1, 1.3, 1.4 of this plan
- `src/modules/sharlie/format.ts`, `src/modules/sharlie/parse.ts`, `src/modules/sharlie/pack.ts`
- `src/modules/storage/pipelines.ts`, `src/modules/agents/agentFile.ts`, `src/modules/skills/scanSkills.ts` (`defaultCursorHome`)
- `src/modules/runs/engine.ts`
- `server/routes/sharlie.ts`, `server/nativeDialog.ts`
- `src/App.tsx`, `src/modules/canvas/TopBar.tsx`, `src/modules/canvas/api.ts`, `src/modules/canvas/WarningsModal.tsx`

### Steps

**4.1 Relative agent paths (`src/modules/agents/agentFile.ts`).**

```ts
/** "" stays "". Absolute stays as is. Relative is resolved against the workflow folder. */
export function resolveAgentPath(workflowDir: string, agentPath: string): string;
```

`src/modules/runs/engine.ts`: in `runAgent` call `readAgentInstruction(resolveAgentPath(run.cwd, step.agentPath))`. In `resendUpstream` do the same for `step.agentPath`. `resolvePipeline` does not change (it stays pure and does not read files).

**4.2 Open dialog (`server/nativeDialog.ts`).** New kind `"sharlie-open"`: copy `RULE_SCRIPT`; change `Title` to `'Import workflow'` and `Filter` to `'Sharlie workflow (*.sharlie)|*.sharlie'`.

**4.3 Unpacking `src/modules/sharlie/unpack.ts`.**

```ts
export async function importSharliePackage(input: {
  pkg: SharliePackage;
  workspace: string;
  newId: string;                       // from newPipelineId(pkg.workflow.name)
  libraryAgents: AgentFile[];          // scanAgents(defaultCursorHome())
}): Promise<{ doc: PipelineDocument; warnings: string[] }>;
```

Steps, in order:

1. `const dir = workflowDir(workspace, newId)`. If it already exists → throw `SharlieFormatError("A workflow folder with this id already exists")` (should not happen with a random id). Create `dir/.sharlie/bundle` with `recursive: true`.
2. **Extract items.** For each item with `files !== null`:
   - `kindDir` = `skills`, `rules`, or `agents`. `slug` = lower-case name, non `[a-z0-9_-]` → `-`, trim dashes, max 48 chars, fallback = `ref`. If `bundle/<kindDir>/<slug>` already exists, append `-2`, `-3`, … until free.
   - For each file: check `isSafeRelativePath(file.path)` again (defense in depth). Target = `path.join(itemDir, ...file.path.split("/"))`; check that `path.relative(itemDir, target)` does not start with `..` and is not absolute. `mkdir` its parent. Write with `{ flag: "wx" }` — `utf8` → `fs.writeFile(target, content, { encoding: "utf8", flag: "wx" })`; `base64` → `fs.writeFile(target, Buffer.from(content, "base64"), { flag: "wx" })`.
   - Any error for this item → the item is treated as **not bundled** (remember `bundledPath = undefined`) and add warning `Could not unpack <kind> "<name>"; it is marked as missing`. Do not stop the import.
   - On success remember `bundledPath = posix(".sharlie/bundle/<kindDir>/<slug>/<entry>")` for this ref.
3. **Workflow.** `structuredClone(pkg.workflow)`, set `id = newId`.
4. **Agent nodes.** For each agent node:
   - `ref = pkg.nodeAgents[node.id]`; item = the agent item with that ref.
   - Bundled → `agentPath = bundledPath` (relative), `agentName = node.data.agentName || item.name`.
   - Else, item exists → look for a library agent whose `name` equals `item.name` (case-insensitive, trimmed). Found → `agentPath = that.path` (absolute), warning `Agent "<name>" was not in the file; using your local agent with the same name`. Not found → `agentPath = ""`, `agentName = node.data.agentName || item.name`, warning `Agent "<name>" is missing. Pick an agent file on the red node.`
   - No ref and empty name → leave as is (a node that never had an agent).
5. **Dependencies.** `doc.dependencies` =
   - every `skill` and `rule` item → `{ kind, name, description, bundledPath? }` (`bundledPath` only when extracted). For a skill/rule without `bundledPath`, add warning `<Kind> "<name>" was not in the file. It works only if you have a <kind> with the same name.`
   - every `mcps` entry → `{ kind: "mcp", name, description: "" }`, plus one warning per MCP: `MCP server "<name>" is used by this workflow. Add it to your ~/.cursor/mcp.json and enable it in Library if you do not have it.`
6. `const saved = await writePipeline(workspace, doc, newId)` (this also runs `normalizePipeline`). Return `{ doc: saved, warnings }`.

**4.4 Route `POST /api/sharlie/import`** (in `server/routes/sharlie.ts`). No request body.

1. `requireWorkspace`.
2. `openNativeDialog("sharlie-open")`. Throws → `500 { error: "Could not open the file dialog" }`. Cancelled → `200 { cancelled: true }`.
3. `fs.stat` the file. Larger than `LIMITS.maxPackageBytes` → `413 { error: "This .sharlie file is larger than 20 MB" }`.
4. Read as utf8. `parseSharliePackage(text)`. `SharlieFormatError` → `400 { error: message }`.
5. `newId = newPipelineId(pkg.workflow.name)`; `libraryAgents = await scanAgents(defaultCursorHome())`.
6. `importSharliePackage(...)`. `SharlieFormatError` → `400 { error: message }`.
7. `200 { id: doc.id, name: doc.name, warnings: [...parseWarnings, ...importWarnings] }`.

Errors other than `SharlieFormatError` fall through to the global `500` handler. If step 6 fails after the folder was created, delete the new folder with `fs.rm(dir, { recursive: true, force: true })` before rethrowing (only that new folder).

**4.5 UI.**

- `api.ts`: `importWorkflow(): Promise<{ cancelled: true } | { id: string; name: string; warnings: string[] }>`.
- `TopBar.tsx`: new props `onImport: () => void` and `canImport: boolean`. Button **Import** right before **Export**. Disabled when `!canImport`.
- `App.tsx`: `canImport = workspaceReady && runPhase === "idle"`. On click: `importWorkflow()` → cancelled: nothing → success: refresh `fetchPipelines()`, call `onLoad(id)`, notice `Imported "<name>"`; if `warnings.length > 0` open `WarningsModal` with title `Imported with warnings` and intro `The workflow was imported. Items below are missing or need attention. Missing names are shown in red.`. Error → error notice.

### Tests

Create `tests/sharlie-import.test.ts` and add it to `npm test`. Build packages in memory (or with `buildSharliePackage` from temp files), then import into a temp workspace.

1. Bundled skill with `SKILL.md` and `scripts/run.py` → both files exist under `<ws>/<id>/.sharlie/bundle/skills/<slug>/`; dependency `bundledPath` is `.sharlie/bundle/skills/<slug>/SKILL.md`; `.sharlie/workflow.json` exists.
2. Two skills with the same name → second goes into `<slug>-2`.
3. Bundled agent → node `agentPath` is relative and `resolveAgentPath(dir, agentPath)` points at an existing file.
4. Agent item with `files: null` and a library agent of the same name → absolute library path and the "using your local agent" warning.
5. Agent item with `files: null` and no match → `agentPath: ""`, name kept, "is missing" warning, **and the import still succeeds**.
6. A hand-made package whose item has a file `../../evil.md` that bypassed parsing (call `importSharliePackage` directly) → no file is written outside the item folder, the item has no `bundledPath`, warning present, import succeeds.
7. MCP entries → `dependencies` of kind `mcp` and one warning each.
8. `resolveAgentPath("C:/w/flow", "")` → `""`; absolute stays; relative resolves under the folder.

### Docs

- `AGENTS.md` and `ARCHITECTURE.md`: `agentPath` may be relative to the workflow folder (`resolveAgentPath`); import extracts into `.sharlie/bundle/`; import never fails for missing items, only for the hard errors in the 3.6 table.
- `README.md`: an "Import" section.

### Done when

- [ ] Export a workflow (Phase 3), then Import it: a second workflow folder appears with the bundle, and it runs.
- [ ] Export with files unticked, rename your local agent file, Import: import succeeds, warnings list the missing agent.
- [ ] `npm test` and `npm run build` pass.
- [ ] Commit: `Import .sharlie workflows into new workspace folders without failing on missing items.`

---

## Phase 5 — Missing items in red, hover help, and run integration

**Run this phase in its own fresh agent.**

### Goal

Missing agents, models, skills, rules, and MCP servers are shown in **red** with a **hover message** that says what is missing and how to fix it. A **Dependencies** panel lists everything the workflow needs. Runs use the workflow's bundled or matched skills and rules, refuse to start when an agent file is missing, and start with a warning when skills, rules, or MCP servers are missing.

### Files to read first

- Section 1.4 of this plan
- `src/modules/graph/types.ts`, `src/modules/library/types.ts`, `src/modules/library/catalog.ts`, `src/modules/library/scan.ts`, `src/modules/library/paths.ts`
- `src/modules/agents/agentFile.ts`, `src/modules/storage/pipelines.ts`
- `server/routes/runs.ts`, `server/routes/sharlie.ts`, `server/index.ts`
- `src/App.tsx`, `src/modules/canvas/AgentNode.tsx`, `src/modules/canvas/Inspector.tsx`, `src/modules/canvas/TopBar.tsx`, `src/modules/canvas/api.ts`, `src/modules/canvas/LibraryModal.tsx`, `src/modules/canvas/ui.ts`, `src/modules/canvas/modelsContext.ts`

### Steps

**5.1 Health module `src/modules/workflow/health.ts`** (new folder).

```ts
export type AgentHealth =
  | { status: "ok" }
  | { status: "unset" }                          // new node, never had an agent: not red
  | { status: "missing"; message: string };

export type DependencyHealth = {
  kind: "skill" | "rule" | "mcp";
  name: string;
  /** Copied from the WorkflowDependency. May be "". */
  description: string;
  status: "bundled" | "library" | "disabled" | "missing";
  /** Absolute path for bundled/library skills and rules. */
  path?: string;
  message: string;                              // always set; shown on hover
};

export type WorkflowHealth = {
  agents: Record<string, AgentHealth>;          // by node id
  dependencies: DependencyHealth[];
  problemCount: number;                         // agents missing + dependencies missing + disabled
};

export async function checkWorkflowHealth(input: {
  doc: PipelineDocument;
  workflowDir: string;
  library: LibrarySnapshot;
}): Promise<WorkflowHealth>;

/** Skills and rules that resolved, as catalog entries for the run. */
export function healthCatalogEntries(health: WorkflowHealth): { skills: CatalogEntry[]; rules: CatalogEntry[] };
```

Rules (messages exactly as written; `<x>` is the name):

- **Agent node**
  - `agentPath === ""` and `agentName === ""` → `{ status: "unset" }`.
  - `agentPath === ""` and `agentName !== ""` → missing: `Agent "<x>" is not on this machine. Use Browse or pick another agent.`
  - Otherwise `const file = resolveAgentPath(workflowDir, agentPath)`; existing regular `.md` file → `ok`; else missing: `Agent file not found: <file>. Use Browse or pick another agent.`
- **Skill / rule dependency**
  1. `bundledPath` set and `path.resolve(workflowDir, bundledPath)` is an existing file → `bundled`, `path` = that absolute path, message `Bundled with this workflow`.
  2. Else a library skill (or rule) whose `title` equals `name` (case-insensitive, trimmed) → `library`, `path` = its path, message `Found in your library: <path>`.
  3. Else → `missing`, message for skills: `Skill "<x>" is missing. Add it to ~/.cursor/skills or import it in Library.`; for rules: `Rule "<x>" is missing. Add it to ~/.cursor/rules or import it in Library.`
- **MCP dependency**
  - Library MCP with the same name (case-insensitive) and `enabled` → `library`, message `Enabled in your library`.
  - Same name but not enabled → `disabled`, message `MCP server "<x>" exists but is turned off. Enable it in Library.`
  - None → `missing`, message `MCP server "<x>" is not in ~/.cursor/mcp.json. Add it there, then enable it in Library.`
- `problemCount` = number of agents with `missing` + number of dependencies with `missing` or `disabled`.
- `healthCatalogEntries`: dependencies with status `bundled` or `library` and kind `skill` / `rule` → `{ title: name, description, path }`. When `description` is `""` and the status is `library`, use the matched library item's description instead.

**5.2 Move `coercePipeline` to `server/routes/coerce.ts`.** Export `coercePipeline` (and its private helpers) from the new file; import it in `runs.ts`. No behavior change. This lets the health route reuse it.

**5.3 Route `POST /api/workflow/health`** in `server/routes/sharlie.ts` (same file, before the export/import handlers or after — order does not matter since paths differ).

1. `requireWorkspace`.
2. Body → `coercePipeline` (`GraphError` → `400 { error }`).
3. If `!isSafePipelineId(doc.id)` → use `workflowDir = path.join(workspace, "__unsaved__")` for resolution only (do not create it). Otherwise `workflowDir(workspace, doc.id)`.
4. `scanLibrary(...)` with the app root library roots.
5. `200` with the `WorkflowHealth`.

**5.4 Runs (`server/routes/runs.ts`, `POST /api/runs`).** After `resolvePipeline` and the API key check:

1. `const snapshot = await scanLibrary(roots)` (change `loadEnabledLibrary` to also return the snapshot so the library is scanned once).
2. `const health = await checkWorkflowHealth({ doc, workflowDir: cwd, library: snapshot })`.
3. If any agent has `status: "missing"` → `400 { error: "Fix the red agent nodes before running: <names joined with ', '>" }` (use `agentName` or the node id).
4. Catalog: `buildCatalogPrompt(mergeEntries(enabledSkills, extra.skills), mergeEntries(enabledRules, extra.rules))` where `extra = healthCatalogEntries(health)` and `mergeEntries` concatenates and drops later entries whose `path` is `samePath` with an earlier one.
5. `warnings` = for each dependency with `missing` or `disabled`: `` `${kindLabel} "${name}"` `` (kindLabel = `Skill`, `Rule`, `MCP server`).
6. MCP servers passed to the run stay **only** the app-wide enabled ones (`loadEnabledMcpConfigs`). Never auto-enable an MCP server because a workflow asks for it.
7. Response becomes `201 { id, warnings }`.

**5.5 UI — health state.**

- `api.ts`: `fetchWorkflowHealth(doc: PipelineDocument): Promise<WorkflowHealth>` (POST). `startRun` return type becomes `{ id: string; warnings?: string[] }`.
- New `src/modules/canvas/healthContext.ts`: `export const HealthContext = createContext<WorkflowHealth | null>(null);`
- `App.tsx`:
  - State `health: WorkflowHealth | null`.
  - A `healthKey` string computed with `useMemo` from: `currentId`, each agent node's `id|agentPath|agentName`, and `JSON.stringify(dependencies)`. Node positions must **not** be part of the key.
  - `useEffect` on `healthKey` and `workspaceReady`: when not ready → `setHealth(null)`; else wait 400 ms (`setTimeout`, cleared on change), then `fetchWorkflowHealth(pipelineDocument())` → `setHealth`; on error `setHealth(null)`.
  - Also refresh health when the Library modal closes (wrap its `onClose`).
  - Wrap the tree in `<HealthContext.Provider value={health}>`.
  - Run: if the response has `warnings?.length`, show notice `Running without: <first 3 joined by ", ">` plus ` and <n> more` when needed, tone `err`.
  - After a successful import (Phase 4 handler): when the fresh health has `problemCount > 0`, open the Dependencies modal automatically.

**5.6 UI — red agent and model (`src/modules/canvas/AgentNode.tsx`).**

- `AgentFields` gets an optional prop `health?: AgentHealth`.
- `AgentNode`: `const health = useContext(HealthContext)?.agents[id];` pass it to `AgentFields`. When `health?.status === "missing"` or the model is unavailable (below), add `!border-red-500` to the card `className`.
- `Inspector.tsx`: read `HealthContext` the same way and pass `health` for agent nodes.
- Inside `AgentFields`:
  - `const agentMissing = health?.status === "missing";`
  - `const modelMissing = modelsReady && data.modelId !== "" && !knownModel;`
  - Agent `<select>`: when `agentMissing`, add `border-red-500 text-red-600` and `title={health.message}`.
  - Under the agent select, when `agentMissing`, render:
    ```tsx
    <p className="cursor-help text-[11px] font-medium text-red-600 underline decoration-dotted" title={health.message}>
      {data.agentName || "Agent"} — missing
    </p>
    ```
  - Model `<select>`: when `modelMissing`, add `border-red-500 text-red-600` and `title={\`Model "${data.modelId}" is not available for this API key. Pick another model.\`}`; render the same kind of red `<p>` with `{data.modelId} — not available`.
  - Native `title` is the hover text. Do not add a tooltip library.

**5.7 UI — Dependencies modal (`src/modules/canvas/DependenciesModal.tsx`, new).**

Props: `{ open: boolean; onClose: () => void; health: WorkflowHealth | null; nodes: FlowNode[]; onOpenLibrary: () => void }`. Same overlay and card style as `SettingsModal`, width `max-w-md`.

- Title `Workflow dependencies`.
- `health === null` → `Select a workspace to check dependencies.`
- Four groups, each with a small uppercase heading (`labelClass`): **Agents**, **Skills**, **Rules**, **MCP servers**. Empty group → `None.` in `text-zinc-400`.
- **Agents**: one row per agent node whose health is not `unset`. Name = `agentName || "Unnamed agent"`.
- Row layout: `flex items-center justify-between gap-2 text-xs`. Left: the name. Right: a status word in `text-[10px] uppercase`.
  - `missing` → name classes `cursor-help font-medium text-red-600 underline decoration-dotted`, status word `missing` in red, `title={message}` on **both** the name and the row.
  - `disabled` → same but `text-amber-600`, status word `off`.
  - `bundled` → normal text, status word `bundled`, `title={message}`.
  - `library` / agent `ok` → normal text, status word `found`, `title={message}`.
- Footer: when `problemCount > 0`, a line `Hover a red name to see how to fix it.` and a button **Open Library** (`onOpenLibrary`, which closes this modal and opens `LibraryModal`). Always a **Close** button.

**5.8 UI — top bar.** `TopBar.tsx` gets props `problemCount: number` and `onOpenDependencies: () => void`. Button after **Library**:
- `problemCount === 0` → text `Dependencies`, `ghostButtonClass`.
- `problemCount > 0` → text `Dependencies (<n>)`, `ghostButtonClass` plus `border-red-300 text-red-600 dark:border-red-800`, `title={\`${n} missing item(s). Click for details.\`}`.

### Tests

Create `tests/workflow-health.test.ts` and add it to `npm test`. Use temp folders and a hand-built `LibrarySnapshot` object (no real home folder).

1. Agent with relative `agentPath` to an existing file → `ok`. Agent with `agentPath: ""` and a name → `missing` with the exact message. Agent with both empty → `unset`. Agent with an absolute path that does not exist → `missing` with `Agent file not found: ...`.
2. Skill with an existing `bundledPath` → `bundled`. Skill whose bundled file was deleted but the library has the same title in a different case → `library`. Neither → `missing` with the exact message.
3. Rule → same three cases with the rule message.
4. MCP enabled → `library`; present but disabled → `disabled`; absent → `missing`.
5. `problemCount` counts missing agents + missing + disabled dependencies, and not `unset` agents.
6. `healthCatalogEntries` returns only bundled/library skills and rules with absolute paths.

### Docs

- `AGENTS.md`: Layout gets `src/modules/workflow/health.ts` and `server/routes/coerce.ts`. Data flow: Run checks health, refuses missing agents, merges bundled/library skills and rules into the catalog, never auto-enables MCP servers, returns `{ id, warnings }`. Add the `POST /api/workflow/health` route. Mention `DependenciesModal` and the red/hover rule.
- `ARCHITECTURE.md`: a "Workflow health" section with the status table from section 1.4.
- `README.md`: a "Missing items" section: red names, hover for help, the Dependencies button.

### Done when

- [ ] Import a workflow whose agent and one skill are not bundled: the agent node card has a red border, the agent name is red, and hovering shows the fix message.
- [ ] The top bar shows `Dependencies (2)` in red; the modal lists the red names with hover messages.
- [ ] Browse for an agent file on the red node: within a second the red state disappears.
- [ ] Run with a missing agent → error notice `Fix the red agent nodes before running: ...`.
- [ ] Run with only a missing skill → the run starts and the notice says `Running without: Skill "..."`.
- [ ] A model id that is not in the model list shows red with hover text.
- [ ] `npm test` and `npm run build` pass.
- [ ] Commit: `Show missing workflow items in red with hover help and use workflow skills in runs.`

---

## Out of scope (do not build)

- Moving old `data/pipelines/*.json` into the workspace automatically. They stay on disk; a user can open the JSON, copy it into `<workspace>/<id>/.sharlie/workflow.json` by hand.
- Renaming a workflow folder when the workflow is renamed.
- Exporting artifacts (files agents created) inside `.sharlie`.
- Exporting MCP server commands, URLs, or secrets. MCP servers travel by name only.
- Zip compression of `.sharlie` (it is plain JSON so it needs no new dependency).
- Multiple workspaces at once, or a recent-workspaces list.
- Non-Windows native dialogs (the existing dialogs are Windows-only too).
