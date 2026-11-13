# AGENTS.md

Map for coding agents working in this repo. Read this file and `ARCHITECTURE.md` before structural edits.

## Layout

- `server/` — local HTTP API on `127.0.0.1:8787`. `server/index.ts` dispatches requests. `server/http.ts` reads and writes JSON. `server/loadEnv.ts` loads the workspace `.env` and upserts a single key.
- `server/routes/` — one handler per area: `library.ts`, `agents.ts`, `skills.ts`, `settings.ts`, `pipelines.ts`, `runs.ts` (runs and models), `files.ts`, `workspace.ts`, `sharlie.ts`, plus the shared `context.ts` (`RouteContext` carries `appRoot`) and `coerce.ts` (`coercePipeline`).
- `src/modules/canvas/` — React Flow UI: agent and human node cards, inspector, top bar, `LibraryModal`, `DependenciesModal`, settings modal, file preview, theme, and the browser API client (`api.ts`). `src/App.tsx` owns the canvas state and registers `nodeTypes`. Missing agent names and models are red, and the hover text says how to fix them.
- `src/modules/graph/` — serializable pipeline shapes (`types.ts`) and `resolvePipeline` (`resolve.ts`).
- `src/modules/agents/` — `agentFile.ts` lists `.md` files in the user agents folder and reads one file's instruction. The file is not copied.
- `src/modules/skills/` — `parseSkill.ts` turns one markdown file into a title and description. `scanSkills.ts` discovers `SKILL.md` files under a Cursor home `skills` folder.
- `src/modules/library/` — app-wide skills, rules, and MCP servers: scan, selection, imported paths, catalog text, and server-side MCP configs. The library is not a canvas node. The dashboard does not author those files.
- `src/modules/storage/` — `pipelines.ts` reads and writes version 1 pipeline JSON at `<workspace>/<id>/.sharlie/workflow.json`. `normalizePipeline` drops legacy skill nodes and attachment edges, and drops old agent prompt, `customModelId`, and human notes on load. Missing `agentPath` and `agentName` become empty strings. Optional `dependencies` are parsed leniently.
- `src/modules/sharlie/` — `.sharlie` package format, packing, parsing, and import.
- `src/modules/workflow/` — `health.ts` checks agent files and workflow dependencies, and builds catalog entries for skills and rules that resolved.
- `src/modules/cursor/` — model id trimming (`models.ts`), MCP mapping (`mcpServers.ts`), and the Cursor runner (`adapter.ts`). `adapter.ts` is the SDK boundary.
- `src/modules/runs/` — `engine.ts` walks execution steps and streams events. `humanGate.ts` is the pure pause and decision logic.
- `src/modules/artifacts/` — `track.ts` snapshots the workspace and diffs mtimes into artifact paths.
- `src/modules/workspace/` — reads `data/app/settings.json` and validates the workspace folder.

`src/main.tsx` mounts the React app. Vite serves the UI and proxies `/api` to the local server.

## Data flow

Canvas edits stay in React state until Save (`PUT /api/pipelines/:id`) or Run.

Run: canvas → `POST /api/runs` → `resolvePipeline` in `src/modules/graph/resolve.ts` → `startRun` in `src/modules/runs/engine.ts` → `CursorAgentRunner` from `src/modules/cursor/adapter.ts` → SSE events → canvas. Run uses `<workspace>/<id>/` as the agent working directory. Artifact paths are relative to the workspace. `GET /api/pipelines`, `POST /api/runs`, and `GET /api/files` answer `409` without a workspace.

`resolvePipeline(doc)` is pure and does not read files. An agent step is `{ kind: "agent", nodeId, modelId, agentPath }`. An empty model id throws `GraphError` with message `Model id is empty`. Attachment edges still present throw `GraphError`. A cycle throws `GraphError` with message `Cycle in pipeline`.

An agent node stores `modelId`, `agentPath`, and `agentName`. There is no prompt field and no custom model field. `GET /api/agents` lists `.md` files directly in `%USERPROFILE%/.cursor/agents`. `POST /api/agents/browse` opens a native file dialog and returns the chosen `.md` path, name, and description. The node can also select one of the scanned agents. The file is not copied. The model dropdown is empty and disabled until `GET /api/models` returns a non-empty list. That route returns `{ configured: false, models: [] }` when `CURSOR_API_KEY` is missing, and only `listModels` results when the key is set. There is no preset fallback.

`POST /api/workflow/health` checks the open workflow. A missing agent name or model is shown in red. Hover text says what is missing and how to fix it. `DependenciesModal` lists the agents, skills, rules, and MCP servers.

Run checks health after the graph resolves. A missing agent file refuses the run. Bundled skills and rules, and library skills and rules with the same title, are merged into the catalog. MCP servers passed to the run stay the app-wide enabled ones. The run never auto-enables an MCP server. The response is `{ id, warnings }`.

On run, the engine resolves `agentPath` with `resolveAgentPath` before calling the runner. An empty path stays empty. An absolute path stays as it is. A relative path is resolved against the workflow folder. The instruction is the markdown body with YAML frontmatter stripped when present. Enabled skills and rules become a catalog (name, description, file path). `applyCatalog` prefixes that catalog onto the first send only. The agent is told to read a file only when the description matches. Upstream text from earlier agents is appended on that first send. A missing path or unreadable file fails the step before the SDK is called. Redo sends that agent file's body again on the same runner, with no catalog and no feedback wrapper. Enabled MCP servers are passed to `Agent.create` as `mcpServers`. `local.settingSources` is `[]`. Ambient Cursor settings are not loaded.

The human pause uses `enterHuman` and `applyHumanDecision` in `src/modules/runs/humanGate.ts`. Human nodes have no notes field. The canvas posts Approve, Redo, or Decline to `POST /api/runs/:id/decision`. File preview and artifact text go through `GET /api/files` (`server/routes/files.ts`). That route reads inside the workspace. It refuses paths outside the workspace, the workspace `.env`, any `.env` or `.env.*` file, and `data/library/mcp.json`. Library bodies go through `GET /api/library/body`.

`GET /api/workspace` returns `{ path, valid, error? }`. `POST /api/workspace/browse` opens a native folder dialog and does not save. `PUT /api/workspace` takes `{ path: string | null }`, validates a path, and saves it. `null` clears the workspace.

## State machine

Agent node status: `idle` | `running` | `redoing` | `done` | `error`.

Human node status: `idle` | `waiting` | `approved` | `declined`.

Run status: `running` | `paused` | `done` | `error` | `stopped`.

Entering a human step calls `enterHuman`, which sets the run to `paused` and the human status to `waiting`. Approve resumes at the next step (`running`, or `done` when the step index moves past the end). Decline halts the run (`stopped`). Redo calls `send()` on the same runner for the upstream agent, increments that agent's retry count, then waits on the human step again. That send is the agent file's body. It does not include the catalog and it has no feedback wrapper.

## Key files

- `src/modules/cursor/models.ts` — `resolveModelId()` trims the agent `modelId`. There is no preset list.
- `src/modules/cursor/adapter.ts` — `CursorAgentRunner` (`start`, `send`, `dispose`), `createCursorAgentRunner()`, `listModels()`. `start` calls `Agent.create` with `mcpServers` and `local.settingSources: []`. This is the only file that may import `@cursor/sdk`.
- `src/modules/cursor/mcpServers.ts` — `toSdkMcpServers`. Maps enabled MCP configs. Does not import the SDK.
- `src/modules/graph/types.ts` — `PipelineDocument` version 1, `PipelineNode` (`agent` | `human`), `PipelineEdge` (`kind: "execution"`). An agent node stores `modelId`, `agentPath`, and `agentName`. There is no skill node, no prompt field, and no attachment edge kind in the written document.
- `src/modules/graph/resolve.ts` — `resolvePipeline(doc)` and `GraphError`. The function is pure and does not read files.
- `src/modules/agents/agentFile.ts` — `scanAgents`, `describeAgentFile`, `readAgentInstruction`, and `resolveAgentPath`. Scan reads `.md` files directly in `<cursorHome>/agents`. `resolveAgentPath` leaves an empty path empty, leaves an absolute path unchanged, and resolves a relative path against the workflow folder.
- `src/modules/skills/parseSkill.ts` — `parseSkillMarkdown(markdown, skillPath)`.
- `src/modules/skills/scanSkills.ts` — `scanSkills(cursorHome?)` reads `<cursorHome>/skills` for `SKILL.md` only. The default cursor home is `os.homedir()/.cursor` (`%USERPROFILE%/.cursor` on Windows). Workspace `.cursor` and plugins are not scanned.
- `src/modules/library/` — `scanLibrary`, selection read/write, import and forget, `buildCatalogPrompt`, `applyCatalog`, and server-side `loadEnabledMcpConfigs` (includes env). List APIs never return MCP env or header values.
- `src/modules/storage/pipelines.ts` — pipeline ids, validation, `normalizePipeline`, and `<workspace>/<id>/.sharlie/workflow.json` IO.
- `src/modules/sharlie/format.ts` — `SharliePackage` shape, format constants, and size limits.
- `src/modules/sharlie/pack.ts` — `readBundleFiles` and `buildSharliePackage`.
- `src/modules/sharlie/parse.ts` — `parseSharliePackage`.
- `src/modules/sharlie/unpack.ts` — `importSharliePackage` extracts bundled files into `.sharlie/bundle/`.
- `src/modules/workflow/health.ts` — `checkWorkflowHealth` and `healthCatalogEntries`. Missing agents and missing or disabled dependencies increment `problemCount`.
- `server/routes/coerce.ts` — `coercePipeline` for run and health request bodies.
- `server/routes/sharlie.ts` — `POST /api/sharlie/export`, `POST /api/sharlie/import`, and `POST /api/workflow/health`.
- `src/modules/artifacts/track.ts` — `snapshotFiles` and `diffSnapshots`.
- `src/modules/runs/humanGate.ts` — `enterHuman` and `applyHumanDecision`. Redo has no notes.
- `src/modules/runs/engine.ts` — in-memory runs, `ensureRunner`, catalog on the first send, agent file body on redo, SSE event buffer. The run working directory is the workflow folder. Artifact paths are relative to the workspace.
- `server/index.ts` — process entry and route order.
- `server/routes/library.ts` — `GET /api/library`, selection, browse, import, forget, and `GET /api/library/body`.
- `server/routes/agents.ts` — `GET /api/agents` and `POST /api/agents/browse`. Browse does not copy the file.
- `server/routes/skills.ts` — `GET /api/skills` lists `SKILL.md` files from the user skills folder and from `data/library/skills` when that folder exists. The dashboard does not write skill files.
- `server/routes/runs.ts` — `POST /api/runs`, decisions, the event stream, and `GET /api/models`. A run refuses missing agents, merges workflow skills and rules into the catalog, and returns `{ id, warnings }`.
- `server/routes/files.ts` — reads a file inside the workspace. Refuses paths outside the workspace, the workspace `.env`, any `.env` or `.env.*` file, and `data/library/mcp.json`.
- `server/routes/settings.ts` — key configured flag and `.env` update. Responses stay `{ configured }`.
- `server/routes/workspace.ts` — `GET /api/workspace`, `POST /api/workspace/browse`, and `PUT /api/workspace`.
- `src/modules/workspace/` — `readAppSettings`, `writeAppSettings`, `validateWorkspacePath`, and `getActiveWorkspace`.
- `src/App.tsx` — canvas, `nodeTypes` (`agent`, `human`), and the SSE client.
- `src/modules/canvas/LibraryModal.tsx` — top-bar library modal, not a node.
- `src/modules/canvas/DependenciesModal.tsx` — top-bar list of workflow agents and dependencies. Missing names are red. Hover text says how to fix them. An MCP server that exists but is turned off is amber.

## Conventions

- The only node kinds are `agent` and `human`. Pipeline JSON stays version 1. `normalizePipeline` drops legacy skill nodes and attachment edges, and drops old agent prompt, `customModelId`, and human notes on load. Missing `agentPath` and `agentName` become empty strings. Adding a kind means updating `src/modules/graph/types.ts`, the canvas `nodeTypes` in `src/App.tsx`, `src/modules/graph/resolve.ts`, and `src/modules/runs/engine.ts` together.
- The only file that may import `@cursor/sdk` is `src/modules/cursor/adapter.ts`. `src/modules/cursor/mcpServers.ts` maps configs and does not import the SDK.
- Never log or return `CURSOR_API_KEY`. Settings responses stay `{ configured }`. List APIs never return MCP env or header values. `loadEnabledMcpConfigs` is server-side and includes env. Do not log secrets.
- A `.sharlie` file never contains MCP command, args, url, env, or headers, and never contains `CURSOR_API_KEY`. `dependencies` is optional and parsed leniently.
- `agentPath` may be relative to the workflow folder. `resolveAgentPath` resolves it before the engine reads the file. `POST /api/sharlie/import` creates `<workspace>/<id>/` and extracts bundled skills, rules, and agents into `.sharlie/bundle/`. Import does not fail when a skill, rule, agent, or MCP server is missing. It fails only for the hard parse errors: invalid JSON, a file that is not a `.sharlie` package, a missing format version, a newer format version, or a damaged workflow.
- Each workflow is saved at `<workspace>/<id>/.sharlie/workflow.json`. The folder name is the pipeline id. `data/app/` is gitignored.
- Skills, rules, and MCP servers are an app-wide library, not canvas nodes. Scan is read-only and limited to `%USERPROFILE%/.cursor/skills` (`SKILL.md`), `%USERPROFILE%/.cursor/rules` (`.md` and `.mdc`), and `%USERPROFILE%/.cursor/mcp.json`. Workspace `.cursor` and plugins are not scanned. The dashboard does not author those files.
- Import is by browse. `POST /api/library/browse` opens a native folder dialog for a skill and resolves the `SKILL.md` directly inside the chosen folder, or a file dialog for a `.mdc` or `.md` rule. `POST /api/library/import` records that absolute path in `data/library/imports.json` (`{ skills: string[], rules: string[] }`). The file is not copied. Remove forgets that path only. Imported rows use source `import`. A path that is already in the Cursor scan stays a single cursor row. MCP servers come only from the user `mcp.json`. `data/library/` also holds `selection.json` and is gitignored.
- `GET /api/agents` lists `.md` files directly in `%USERPROFILE%/.cursor/agents`. `POST /api/agents/browse` returns the chosen `.md` path, name, and description. The node can also select a scanned agent. The file is not copied.
- Execution edges connect agent and human nodes. There is no skill node and no attachment edge kind in the written document. Attachment edges still present throw `GraphError`. The cycle message remains `Cycle in pipeline`. An agent step is `{ kind: "agent", nodeId, modelId, agentPath }`. An empty model id throws `GraphError` `Model id is empty`. `resolvePipeline(doc)` is pure and does not read files.
- On run, the engine resolves `agentPath` with `resolveAgentPath` before calling the runner. An empty path stays empty. An absolute path stays as it is. A relative path is resolved against the workflow folder. The instruction is the markdown body with YAML frontmatter stripped when present. Enabled skills and rules become a catalog (name, description, file path) prefixed onto the first send via `applyCatalog`. The agent is told to read a file only when the description matches. Redo resends that agent file's body with no catalog and no feedback wrapper. A missing path or unreadable file fails the step before the SDK is called.
- Enabled MCP servers are passed to `Agent.create` as `mcpServers`. `local.settingSources` is `[]`. Ambient Cursor settings are not loaded.
- `GET /api/files` reads inside the workspace. It refuses paths outside the workspace, the workspace `.env`, any `.env` or `.env.*` file, and `data/library/mcp.json`. `GET /api/pipelines`, `POST /api/runs`, and `GET /api/files` answer `409` without a workspace. Library bodies go through `GET /api/library/body`.
- Library UI is a top-bar modal (`LibraryModal`), not a node.
- The model dropdown is empty and disabled until `GET /api/models` returns a non-empty list. That route returns `{ configured: false, models: [] }` when `CURSOR_API_KEY` is missing, and only `listModels` results when the key is set. There is no preset fallback.
- Do not add UI test suites, snapshot tests, or new test dependencies. Use `node:test` and `node:assert/strict`.
- New behavior for `parseSkillMarkdown`, `resolvePipeline`, the human gate, the library, agent files, the workspace, workflow health, or the `.sharlie` format needs a test in `tests/`. The `npm test` script lists `tests/skills.test.ts`, `tests/graph.test.ts`, `tests/human-gate.test.ts`, `tests/library.test.ts`, `tests/mcp-servers.test.ts`, `tests/agents.test.ts`, `tests/workspace.test.ts`, `tests/pipelines-storage.test.ts`, `tests/sharlie.test.ts`, `tests/sharlie-import.test.ts`, and `tests/workflow-health.test.ts` explicitly so Windows does not depend on shell globbing.
