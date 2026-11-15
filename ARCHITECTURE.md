# ARCHITECTURE.md

Sharlie Easy Flow is a local Vite UI plus a Node API. The canvas edits a version 1 `PipelineDocument`. Run turns that document into ordered steps and drives one local Cursor agent per Agent node. Skills, rules, and MCP servers are an app-wide library, not canvas nodes.

## Modules

`src/modules/graph/types.ts` defines `NodeKind` (`agent` | `human`), `PipelineNode`, `PipelineEdge` (`kind: "execution"`), and `PipelineDocument` with `version: 1`. An agent node stores `modelId`, `effort`, `effortParamId`, `agentPath`, and `agentName`. An empty `effort` means not chosen yet. `effortParamId` is the catalog parameter id sent with that value, and an empty string means it was not stored. A human node stores status and artifact paths. There is no skill node, no prompt field, no custom model field, no human notes field, and no attachment edge kind in the written document.

`src/modules/storage/pipelines.ts` validates and stores pipeline JSON at `<workspace>/<id>/.sharlie/workflow.json`. `normalizePipeline` keeps version 1 and drops legacy skill nodes and attachment edges on load. It also drops old agent prompt, `customModelId`, and human notes. Missing `agentPath`, `agentName`, `effort`, and `effortParamId` become empty strings. Edges whose endpoints are gone are dropped with them.

`src/modules/graph/resolve.ts` exports `resolvePipeline(doc)` and `GraphError`. The function is pure and does not read files. The resolver topologically sorts agent and human nodes (ties by id). An agent step is `{ kind: "agent", nodeId, inputs, modelId, agentPath, agentName, effort, effortParamId }` and a human step is `{ kind: "human", nodeId, inputs }`. `inputs` lists the distinct sources of the edges into that node, in step order; a duplicate edge counts once. `agentName` is trimmed. `effort` and `effortParamId` are trimmed, and an empty `effort` means not chosen yet. At run time a blank effort becomes `medium` when the model lists it, otherwise the middle allowed value. The sent parameter id is the stored `effortParamId` when it is set, otherwise the catalog id for that model, otherwise `effort`. Models with no effort parameter send no params. An empty model id throws `GraphError` with message `Model id is empty`. An attachment edge still present throws `GraphError` (`Attachment edges are not supported`). A cycle throws `GraphError` with message `Cycle in pipeline`.

`src/modules/agents/agentFile.ts` lists `.md` files directly in `<cursorHome>/agents` and reads one markdown file. `scanAgents` does not walk subfolders. `readAgentInstruction` returns the body with YAML frontmatter stripped when present. `describeAgentFile` returns the name, description, and path. Nothing is copied. `resolveAgentPath` leaves an empty path empty, leaves an absolute path unchanged, and resolves a relative path against the workflow folder.

`src/modules/skills/parseSkill.ts` exports `parseSkillMarkdown(markdown, skillPath)`. Frontmatter `name` (or `title`) and `description` win, quoted or plain. Without frontmatter, the title is the first markdown heading and the description is the following paragraph, clipped to 240 characters. The same parser reads rule files and agent files.

`src/modules/skills/scanSkills.ts` exports `scanSkills(cursorHome?)`. Discovery is `<cursorHome>/skills` and `SKILL.md` only, defaulting to `os.homedir()/.cursor` (`%USERPROFILE%/.cursor` on Windows). Pass `cursorHome` in tests. It does not read a workspace `.cursor` folder or plugins. Results are deduplicated by real path and sorted by title.

`src/modules/library/` is the app-wide library. Scan is read-only and limited to `%USERPROFILE%/.cursor/skills` (`SKILL.md`), `%USERPROFILE%/.cursor/rules` (`.md` and `.mdc`), and `%USERPROFILE%/.cursor/mcp.json`. Workspace `.cursor` and plugins are not scanned. The dashboard does not author those files. `data/library/` holds `selection.json` and `imports.json` and is gitignored. `scanLibrary({ cursorHome, appLibraryRoot })` marks the selection. `filterSelection` keeps known ids and ignores missing ids. List results omit env and header values. `loadEnabledMcpConfigs` is the server-side call that includes env, and it reads MCP servers only from the user `mcp.json`. Do not log secrets or `CURSOR_API_KEY`.

Import is by browse. `POST /api/library/browse` opens a native folder dialog for a skill and resolves the `SKILL.md` directly inside the chosen folder, or a file dialog for `.mdc` or `.md` rules. Both dialogs allow more than one pick. `POST /api/library/import` takes one `path` or a `paths` list and records each absolute path in `data/library/imports.json` (`{ skills: string[], rules: string[] }`). The file is not copied. Remove forgets that path only. Imported rows use source `import`. A path that is already in the Cursor scan stays a single cursor row.

On run, enabled skills and rules become a catalog (name, description, file path). `buildCatalogPrompt` tells the agent to read a file only when the description matches. `applyCatalog` prefixes that catalog onto the first send only. Redo sends the agent file body again and does not include the catalog.

`src/modules/cursor/models.ts` exports `resolveModelId()`, which trims the agent `modelId`. There is no preset list and no custom model field. An empty id is what makes `resolvePipeline` throw `Model id is empty`.

`src/modules/cursor/mcpServers.ts` exports `toSdkMcpServers`. It maps enabled configs to the SDK server shape and does not import `@cursor/sdk`.

`src/modules/cursor/adapter.ts` is the only module that imports `@cursor/sdk`. It exports `CursorAgentRunner` (`start`, `send`, `cancel`, `dispose`), `createCursorAgentRunner()`, and `listModels()`. `cancel` stops the active SDK run when that run supports cancel. With no active run yet, cancel is a no-op and `dispose` still drops the agent. `start` passes `apiKey`, the model id, `mcpServers` from the enabled library, and a local cwd. `Agent.create` receives those servers and `local.settingSources: []`. Ambient Cursor settings are not loaded. `send` forwards assistant text and usage. `dispose` always releases the agent. `listModels` returns the account model list and nothing else.

`src/modules/runs/engine.ts` holds in-memory runs. `pump` starts every ready node (see `src/modules/runs/schedule.ts`): a node is ready when every input is satisfied, an agent input when `done` and a human input when `approved`. Independent agents run in parallel, up to `MAX_PARALLEL_AGENTS` (3). Parallel agents share the workflow folder and are expected to work on different files; editing the same file from two parallel agents is a user error the app does not detect. `ensureRunner` keeps one `CursorAgentRunner` per agent node (`createRunner(nodeId)`, a test hook that defaults to the Cursor runner) and passes the enabled MCP configs into `start`. A runner is disposed once its agent is done and every human reviewing it is approved or declined; all runners are disposed when the run ends. `settle` emits `paused` only when nothing runs and a human waits, and `done` when every agent is done and every human approved. An agent error stops the run, disposes every runner, and ignores late results. User Stop (`stopRun`) sets `stopped` before any await, rewinds `running` and `redoing` nodes to `idle`, cancels and disposes runners, and writes `<workflow cwd>/.sharlie/run.json`. That stop is resumable. Resume continues unfinished nodes when the current graph fingerprint matches; a node that was mid-send starts over, and files it already wrote stay. Decline emits `stopped` without `resumable` and deletes the checkpoint. `done` deletes it too. A fresh `POST /api/runs` returns 409 while the checkpoint file exists. The engine resolves `agentPath` with `resolveAgentPath` before calling the runner. An empty path stays empty, an absolute path stays as it is, and a relative path is resolved against the workflow folder. The instruction is the markdown body with YAML frontmatter stripped when present. The first send is the catalog plus that body, and an upstream section with one block per direct input (`upstreamFor`): an agent input gives its latest output, a human input gives the latest outputs of the agents it reviewed. Agents that are not connected are not included. Each block is headed by the agent name and node id. A missing path or unreadable file fails the step before the SDK is called. Redo calls `send()` on the runner already started for that node with the file body only, then the human waits again. That send has no catalog and no feedback wrapper. After each send, `snapshotFiles` / `diffSnapshots` from `src/modules/artifacts/track.ts` become artifact events. A file changed while two agents overlap is reported for both. The canvas lists an artifact on a human node only when it came from an agent that human reviews. Run uses `<workspace>/<id>/` as `cwd`. Artifact paths are relative to the workspace. The `.sharlie` meta folder is skipped. Token events accumulate a run total and a process session total from reported usage.

`src/modules/runs/humanGate.ts` is pure and works on the schedule state for one human node. Human nodes have no notes field. `enterHuman` sets the human to `waiting`. `applyHumanDecision(state, humanId, decision, redoNodeId?)` accepts `approve`, `redo`, or `decline`. The review sources of a human are the nearest agents behind it, walking back through other humans (`reviewSources` in `src/modules/graph/topology.ts`). Approve marks it `approved` and returns effect `resume`. Decline marks it `declined` and returns `halt`; the whole run stops. Redo returns `resend` for every review source (Redo all) or only `redoNodeId` (Redo one), marks them `redoing`, increments their `retryCounts`, and puts the human back to `idle` until they are done. The engine resends each agent file's body on that agent's own runner. Rejections: the human is not waiting (`Node is not waiting for review`), a review source is still running on Approve or Redo (`Upstream agent is still running`), no agent behind it on Redo (`No upstream agent`), `redoNodeId` not among its review sources (`Agent is not reviewed by this node`), or `redoNodeId` with Approve or Decline (`Only Redo takes an agent`). `POST /api/runs/:id/decision` takes `{ decision, nodeId, redoNodeId? }`; `nodeId` may be omitted when exactly one human waits. A human card that reviews two or more agents shows Redo all and Redo one.

`server/index.ts` mounts the routes. `server/routes/library.ts` serves the library snapshot, selection, browse, import, forget, and `GET /api/library/body`. List responses never include MCP env or header values. `server/routes/agents.ts` serves `GET /api/agents` and `POST /api/agents/browse`. `server/routes/runs.ts` calls `resolvePipeline(doc)`, checks workflow health, builds the catalog from enabled skills and rules plus bundled or matched workflow skills and rules, loads enabled MCP configs, returns `{ id, warnings }`, and streams SSE from the engine. `POST /api/runs/:id/stop` writes the checkpoint. `POST /api/runs/resume` continues it. `GET /api/pipelines/:id/checkpoint` returns `{ resumable }`. `DELETE /api/pipelines/:id/checkpoint` removes only `run.json`. `GET /api/models` returns `{ configured: false, models: [] }` when `CURSOR_API_KEY` is missing, and only `listModels()` results when the key is set. There is no preset fallback. The model dropdown is empty and disabled until that list is non-empty. `server/routes/files.ts` reads a file inside the workspace and refuses paths outside the workspace, the workspace `.env`, any `.env` or `.env.*` file, and `data/library/mcp.json`. With no workspace selected, the app uses `%TEMP%/sharlie-easy-flow`. `GET /api/pipelines`, `POST /api/runs`, and `GET /api/files` answer `409` only when a stored workspace is invalid or the temp folder cannot be created. Library bodies go through `GET /api/library/body`. `server/routes/settings.ts` reports and stores the key without returning it. `CURSOR_API_KEY` is stored in Windows Credential Manager (target `SharlieEasyFlow/CURSOR_API_KEY`), not in `.env`. A leftover `.env` value is migrated on startup and that line is removed. Do not log or return the key. Responses stay `{ configured }`.

`src/App.tsx` registers `agent` and `human` in `nodeTypes` and listens to the run stream. Library UI is a top-bar modal (`LibraryModal` in `src/modules/canvas/LibraryModal.tsx`), not a node. An agent card selects a scanned agent or browses for one `.md` file. The file is not copied.

## Workspace

The workspace is a folder the user picks in Settings. It is stored in `data/app/settings.json` as `{ version: 1, workspacePath }` under the app root. `data/app/` is gitignored. `GET /api/workspace` reads that file and re-validates the folder. `POST /api/workspace/browse` opens a native folder dialog and does not save. `PUT /api/workspace` saves `null`, or a path that passes validation. Each workflow is saved at `<workspace>/<id>/.sharlie/workflow.json`. Run uses that workflow folder as `cwd`. Artifact paths are relative to the workspace. With no workspace selected, the app uses `%TEMP%/sharlie-easy-flow`. `GET /api/pipelines`, `POST /api/runs`, and `GET /api/files` answer `409` only when a stored workspace is invalid or the temp folder cannot be created.

`validateWorkspacePath` checks, in order: the path is a non-empty string; it is absolute; `realpath` succeeds; it is a directory; it is not a drive root; it is not the app folder, inside the app folder, or a parent of the app folder; and the folder is writable. The write check creates `.sharlie-write-test` and deletes it. A stored folder that fails those checks stays invalid until the user picks another one.

## .sharlie format

A `.sharlie` file is one JSON package. `format` is `sharlie-workflow` and `formatVersion` is `1`. `workflow` is a version 1 pipeline with run state reset, empty agent paths, and no `dependencies` field. `nodeAgents` maps an agent node id to an item ref. `items` are skills, rules, and agents. An item's `files` is null when the file was not bundled. `mcps` is `{ name }` only.

The whole file is limited to 20 MB. One bundled file is limited to 1 MB. One skill folder is limited to 5 MB and 100 files. MCP command, args, url, env, headers, and `CURSOR_API_KEY` are never written into the file.

`src/modules/sharlie/format.ts` defines the shape and the limits. `pack.ts` builds a package. `parse.ts` reads one. `unpack.ts` imports one into a new workflow folder. `POST /api/sharlie/export` writes the file through a native Save dialog. `POST /api/sharlie/import` reads a `.sharlie` file, creates `<workspace>/<id>/`, and extracts bundled skills, rules, and agents into `.sharlie/bundle/`. A missing skill, rule, agent, or MCP server does not fail the import. Import fails only for the hard parse errors: invalid JSON, a file that is not a `.sharlie` package, a missing format version, a newer format version, or a damaged workflow. `dependencies` on a workflow is optional. `parseDependencies` drops bad entries and keeps the first of each kind and name.

## Workflow health

`POST /api/workflow/health` and the start of a run use `checkWorkflowHealth` in `src/modules/workflow/health.ts`. The canvas paints the result. A missing name is red. Hover text says what is missing and how to fix it. `DependenciesModal` lists the same items.

| Thing | Found when | Shown as |
| --- | --- | --- |
| Agent file of a node | `agentPath` (resolved against the workflow folder if relative) is an existing `.md` file | Normal. Otherwise the agent name is red with hover text. |
| Model of a node | `modelId` is in the `/api/models` list | Normal. Otherwise the model is red with hover text. |
| Skill / rule dependency | Its `bundledPath` file exists, or a library skill/rule with the same title (case-insensitive, trimmed) exists | Normal. Otherwise red. |
| MCP dependency | A server with the same name exists in `~/.cursor/mcp.json` and is enabled in the Library | Normal. Exists but disabled: amber. Not found: red. |

A missing agent blocks Run with a clear `400` message. Missing skills, rules, and MCP servers do not block Run. The run starts without them and the UI shows a warning. Resolved skills and rules are merged into the catalog. An MCP server is never enabled because a workflow lists it.

## SSE events

`GET /api/runs/:id/events` writes these event names: `node-status`, `token`, `assistant`, `artifact`, `paused`, `done`, `error`, `stopped`. `paused` carries `{ nodeIds }` of the waiting humans and is sent only when nothing is running. The stream closes on `paused`, `done`, `error`, and `stopped`; the canvas reopens it after a decision. User Stop sends `stopped` with `{ resumable: true }` and the canvas stays on Resume. Decline sends `stopped` without `resumable`, and the canvas returns to idle.

## Extension recipes

### 1. Add a node type

Example: a Router node.

- Extend the `NodeKind` union and the `PipelineNode` union in `src/modules/graph/types.ts`.
- Add a canvas component and register it in the `nodeTypes` object in `src/App.tsx`.
- Handle the kind in `resolvePipeline` (`src/modules/graph/resolve.ts`), in readiness (`src/modules/runs/schedule.ts`), and in `pump` in `src/modules/runs/engine.ts`.
- If the new node runs, give it an execution edge (`kind: "execution"`) between agent and human nodes. `resolvePipeline` rejects any other edge kind.

Keep the document, the canvas, the resolver, and the engine on the same set of kinds. Pipeline JSON stays version 1. `normalizePipeline` is what old files pass through on load.

### 2. Models

`resolveModelId()` in `src/modules/cursor/models.ts` trims the agent `modelId`. `resolvePipeline` throws `GraphError` `Model id is empty` when that trim is empty. `GET /api/models` (`server/routes/runs.ts`) returns `{ configured: false, models: [] }` when `CURSOR_API_KEY` is missing, and only `listModels()` from the adapter when the key is set. There is no preset list and no custom model field. The model dropdown stays empty and disabled until the returned list is non-empty.

### 3. Library, agents, parsing, and artifacts

Skills, rules, and MCP servers are an app-wide library, not canvas nodes. The Library screen is `LibraryModal`, opened from the top bar. The dashboard does not author skill, rule, or MCP files.

Scan is read-only. `scanLibrary` in `src/modules/library/scan.ts` reads only:

- `%USERPROFILE%/.cursor/skills` — `SKILL.md`, through `scanSkills(cursorHome?)` in `src/modules/skills/scanSkills.ts`. The default cursor home is `os.homedir()/.cursor`. Tests pass a cursor home and do not need the real home directory.
- `%USERPROFILE%/.cursor/rules` — `.md` and `.mdc`.
- `%USERPROFILE%/.cursor/mcp.json`.

Workspace `.cursor` and plugins are not scanned. MCP servers come only from the user `mcp.json`.

Import is by browse. `POST /api/library/browse` opens a native folder dialog for a skill and resolves the `SKILL.md` directly inside the chosen folder, or a file dialog for `.mdc` or `.md` rules. Both dialogs allow more than one pick. `POST /api/library/import` takes one `path` or a `paths` list and records each absolute path in `data/library/imports.json` (`{ skills: string[], rules: string[] }`). The file is not copied. Remove forgets that path only. Imported rows use source `import`. A path that is already in the Cursor scan stays a single cursor row. `data/library/` also holds `selection.json`. `data/library/` is gitignored.

`GET /api/agents` lists `.md` files directly in `%USERPROFILE%/.cursor/agents`. `POST /api/agents/browse` opens a native file dialog and returns the chosen `.md` path, name, and description. The node can also select one of the scanned agents. The file is not copied. On run, `resolveAgentPath` resolves `agentPath` against the workflow folder when the path is relative, then `readAgentInstruction` in `src/modules/agents/agentFile.ts` supplies the markdown body with YAML frontmatter stripped when present.

`filterSelection` omits ids that are not in the current snapshot. `buildCatalogPrompt` and `applyCatalog` in `src/modules/library/catalog.ts` turn enabled skills and rules into a catalog (name, description, file path) and prefix it onto the first send. The catalog tells the agent to read a file only when the description matches. Redo sends the agent file body again and does not include the catalog.

`GET /api/library` and the other list responses never return MCP env or header values. `loadEnabledMcpConfigs` in `src/modules/library/mcpConfig.ts` is server-side and includes env. `toSdkMcpServers` in `src/modules/cursor/mcpServers.ts` maps those configs and does not import `@cursor/sdk`. Enabled servers are passed to `Agent.create` as `mcpServers`. `local.settingSources` is `[]`. Ambient Cursor settings are not loaded. Do not log secrets or `CURSOR_API_KEY`.

Parsing of one markdown file stays in `src/modules/skills/parseSkill.ts` (`parseSkillMarkdown`). Artifact capture is `src/modules/artifacts/track.ts` (`snapshotFiles`, `diffSnapshots`). The `.sharlie` meta folder is skipped. Preview is `server/routes/files.ts`. That route reads inside the workspace and refuses paths outside the workspace, the workspace `.env`, any `.env` or `.env.*` file, and `data/library/mcp.json`. Library bodies go through `GET /api/library/body`.

### 4. Swap the Cursor adapter

Implement the `CursorAgentRunner` interface in `src/modules/cursor/adapter.ts`: `start`, `send`, and `dispose`. The engine depends on that interface and on `listModels()`. Local runtime only: pass `apiKey`, the model id, the enabled `mcpServers`, and the local cwd with `settingSources: []`. Always dispose the agent. Do not import `@cursor/sdk` from the engine, the library, `mcpServers.ts`, or the UI.

The engine creates one runner per agent node through `ensureRunner`, and several may be live at once. It resolves `agentPath` with `resolveAgentPath` and reads that file before that call. The first `send` for that node includes the catalog. Redo calls `send()` on that same runner with the file body and without the catalog. A missing path or unreadable file fails the step before the SDK is called.
