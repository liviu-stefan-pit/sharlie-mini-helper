# ARCHITECTURE.md

Sharlie Easy Flow is a local Vite UI plus a Node API. The canvas edits a version 1 `PipelineDocument`. Run turns that document into ordered steps and drives one local Cursor agent per Agent node. Skills, rules, and MCP servers are an app-wide library, not canvas nodes.

## Modules

`src/modules/graph/types.ts` defines `NodeKind` (`agent` | `human`), `PipelineNode`, `PipelineEdge` (`kind: "execution"`), and `PipelineDocument` with `version: 1`. An agent node stores `modelId`, `agentPath`, and `agentName`. A human node stores status and artifact paths. There is no skill node, no prompt field, no custom model field, no human notes field, and no attachment edge kind in the written document.

`src/modules/storage/pipelines.ts` validates and stores pipeline JSON in `data/pipelines/<id>.json`. `data/pipelines/*.json` is gitignored. `normalizePipeline` keeps version 1 and drops legacy skill nodes and attachment edges on load. It also drops old agent prompt, `customModelId`, and human notes. Missing `agentPath` and `agentName` become empty strings. Edges whose endpoints are gone are dropped with them.

`src/modules/graph/resolve.ts` exports `resolvePipeline(doc)` and `GraphError`. The function is pure and does not read files. The resolver topologically sorts agent and human nodes. An agent step is `{ kind: "agent", nodeId, modelId, agentPath }`. An empty model id throws `GraphError` with message `Model id is empty`. An attachment edge still present throws `GraphError` (`Attachment edges are not supported`). A cycle throws `GraphError` with message `Cycle in pipeline`.

`src/modules/agents/agentFile.ts` lists `.md` files directly in `<cursorHome>/agents` and reads one markdown file. `scanAgents` does not walk subfolders. `readAgentInstruction` returns the body with YAML frontmatter stripped when present. `describeAgentFile` returns the name, description, and path. Nothing is copied.

`src/modules/skills/parseSkill.ts` exports `parseSkillMarkdown(markdown, skillPath)`. Frontmatter `name` (or `title`) and `description` win, quoted or plain. Without frontmatter, the title is the first markdown heading and the description is the following paragraph, clipped to 240 characters. The same parser reads rule files and agent files.

`src/modules/skills/scanSkills.ts` exports `scanSkills(cursorHome?)`. Discovery is `<cursorHome>/skills` and `SKILL.md` only, defaulting to `os.homedir()/.cursor` (`%USERPROFILE%/.cursor` on Windows). Pass `cursorHome` in tests. It does not read a workspace `.cursor` folder or plugins. Results are deduplicated by real path and sorted by title.

`src/modules/library/` is the app-wide library. Scan is read-only and limited to `%USERPROFILE%/.cursor/skills` (`SKILL.md`), `%USERPROFILE%/.cursor/rules` (`.md` and `.mdc`), and `%USERPROFILE%/.cursor/mcp.json`. Workspace `.cursor` and plugins are not scanned. The dashboard does not author those files. `data/library/` holds `selection.json` and `imports.json` and is gitignored. `scanLibrary({ cursorHome, appLibraryRoot })` marks the selection. `filterSelection` keeps known ids and ignores missing ids. List results omit env and header values. `loadEnabledMcpConfigs` is the server-side call that includes env, and it reads MCP servers only from the user `mcp.json`. Do not log secrets or `CURSOR_API_KEY`.

Import is by browse. `POST /api/library/browse` opens a native folder dialog for a skill and resolves the `SKILL.md` directly inside the chosen folder, or a file dialog for a `.mdc` or `.md` rule. `POST /api/library/import` records that absolute path in `data/library/imports.json` (`{ skills: string[], rules: string[] }`). The file is not copied. Remove forgets that path only. Imported rows use source `import`. A path that is already in the Cursor scan stays a single cursor row.

On run, enabled skills and rules become a catalog (name, description, file path). `buildCatalogPrompt` tells the agent to read a file only when the description matches. `applyCatalog` prefixes that catalog onto the first send only. Redo sends the agent file body again and does not include the catalog.

`src/modules/cursor/models.ts` exports `resolveModelId()`, which trims the agent `modelId`. There is no preset list and no custom model field. An empty id is what makes `resolvePipeline` throw `Model id is empty`.

`src/modules/cursor/mcpServers.ts` exports `toSdkMcpServers`. It maps enabled configs to the SDK server shape and does not import `@cursor/sdk`.

`src/modules/cursor/adapter.ts` is the only module that imports `@cursor/sdk`. It exports `CursorAgentRunner` (`start`, `send`, `dispose`), `createCursorAgentRunner()`, and `listModels()`. `start` passes `apiKey`, the model id, `mcpServers` from the enabled library, and a local cwd. `Agent.create` receives those servers and `local.settingSources: []`. Ambient Cursor settings are not loaded. `send` forwards assistant text and usage. `dispose` always releases the agent. `listModels` returns the account model list and nothing else.

`src/modules/runs/engine.ts` holds in-memory runs. `ensureRunner` keeps one `CursorAgentRunner` for the agent node that is executing and passes the enabled MCP configs into `start`. A different agent node disposes that runner and starts another. The engine reads `agentPath` before calling the runner. The instruction is the markdown body with YAML frontmatter stripped when present. The first send is the catalog plus that body, and upstream text when an earlier agent has output. A missing path or unreadable file fails the step before the SDK is called. Redo calls `send()` on the runner already started for that same node with the file body only, then the human step waits again. That send has no catalog and no feedback wrapper. After each send, `snapshotFiles` / `diffSnapshots` from `src/modules/artifacts/track.ts` become artifact events. Token events accumulate a run total and a process session total from reported usage.

`src/modules/runs/humanGate.ts` is pure. Human nodes have no notes field. `enterHuman` sets `paused` and `humanStatus: "waiting"`. `applyHumanDecision` accepts `approve`, `redo`, or `decline`. Approve advances `stepIndex` and returns effect `resume` (`running`, or `done` past the last step). Decline returns effect `halt` and status `stopped`. Redo returns effect `resend` and increments `retryCounts[agentId]`. The engine then resends that agent file's body on the same runner. A human step with no earlier agent rejects `No upstream agent`.

`server/index.ts` mounts the routes. `server/routes/library.ts` serves the library snapshot, selection, browse, import, forget, and `GET /api/library/body`. List responses never include MCP env or header values. `server/routes/agents.ts` serves `GET /api/agents` and `POST /api/agents/browse`. `server/routes/runs.ts` calls `resolvePipeline(doc)`, builds the catalog from enabled skills and rules, loads enabled MCP configs, and streams SSE from the engine. `GET /api/models` returns `{ configured: false, models: [] }` when `CURSOR_API_KEY` is missing, and only `listModels()` results when the key is set. There is no preset fallback. The model dropdown is empty and disabled until that list is non-empty. `server/routes/files.ts` previews a workspace file and refuses paths outside the workspace, the workspace `.env`, and `data/library/mcp.json`. Library bodies go through `GET /api/library/body`. `server/routes/settings.ts` reports and stores the key without returning it. Responses stay `{ configured }`.

`src/App.tsx` registers `agent` and `human` in `nodeTypes` and listens to the run stream. Library UI is a top-bar modal (`LibraryModal` in `src/modules/canvas/LibraryModal.tsx`), not a node. An agent card selects a scanned agent or browses for one `.md` file. The file is not copied.

## Workspace

The workspace is a folder the user picks in Settings. It is stored in `data/app/settings.json` as `{ version: 1, workspacePath }` under the app root. `data/app/` is gitignored. `GET /api/workspace` reads that file and re-validates the folder. `POST /api/workspace/browse` opens a native folder dialog and does not save. `PUT /api/workspace` saves `null`, or a path that passes validation. Pipelines still live in `data/pipelines`.

`validateWorkspacePath` checks, in order: the path is a non-empty string; it is absolute; `realpath` succeeds; it is a directory; it is not a drive root; it is not the app folder, inside the app folder, or a parent of the app folder; and the folder is writable. The write check creates `.sharlie-write-test` and deletes it. A stored folder that fails those checks stays invalid until the user picks another one.

## SSE events

`GET /api/runs/:id/events` writes these event names: `node-status`, `token`, `assistant`, `artifact`, `paused`, `done`, `error`, `stopped`.

## Extension recipes

### 1. Add a node type

Example: a Router node.

- Extend the `NodeKind` union and the `PipelineNode` union in `src/modules/graph/types.ts`.
- Add a canvas component and register it in the `nodeTypes` object in `src/App.tsx`.
- Handle the kind in `resolvePipeline` (`src/modules/graph/resolve.ts`) and in the step loop in `src/modules/runs/engine.ts`.
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

Import is by browse. `POST /api/library/browse` opens a native folder dialog for a skill and resolves the `SKILL.md` directly inside the chosen folder, or a file dialog for a `.mdc` or `.md` rule. `POST /api/library/import` records that absolute path in `data/library/imports.json` (`{ skills: string[], rules: string[] }`). The file is not copied. Remove forgets that path only. Imported rows use source `import`. A path that is already in the Cursor scan stays a single cursor row. `data/library/` also holds `selection.json`. `data/library/` is gitignored.

`GET /api/agents` lists `.md` files directly in `%USERPROFILE%/.cursor/agents`. `POST /api/agents/browse` opens a native file dialog and returns the chosen `.md` path, name, and description. The node can also select one of the scanned agents. The file is not copied. On run, `readAgentInstruction` in `src/modules/agents/agentFile.ts` supplies the markdown body with YAML frontmatter stripped when present.

`filterSelection` omits ids that are not in the current snapshot. `buildCatalogPrompt` and `applyCatalog` in `src/modules/library/catalog.ts` turn enabled skills and rules into a catalog (name, description, file path) and prefix it onto the first send. The catalog tells the agent to read a file only when the description matches. Redo sends the agent file body again and does not include the catalog.

`GET /api/library` and the other list responses never return MCP env or header values. `loadEnabledMcpConfigs` in `src/modules/library/mcpConfig.ts` is server-side and includes env. `toSdkMcpServers` in `src/modules/cursor/mcpServers.ts` maps those configs and does not import `@cursor/sdk`. Enabled servers are passed to `Agent.create` as `mcpServers`. `local.settingSources` is `[]`. Ambient Cursor settings are not loaded. Do not log secrets or `CURSOR_API_KEY`.

Parsing of one markdown file stays in `src/modules/skills/parseSkill.ts` (`parseSkillMarkdown`). Artifact capture is `src/modules/artifacts/track.ts` (`snapshotFiles`, `diffSnapshots`). Preview is `server/routes/files.ts`. That route refuses paths outside the workspace, the workspace `.env`, and `data/library/mcp.json`. Library bodies go through `GET /api/library/body`.

### 4. Swap the Cursor adapter

Implement the `CursorAgentRunner` interface in `src/modules/cursor/adapter.ts`: `start`, `send`, and `dispose`. The engine depends on that interface and on `listModels()`. Local runtime only: pass `apiKey`, the model id, the enabled `mcpServers`, and the local cwd with `settingSources: []`. Always dispose the agent. Do not import `@cursor/sdk` from the engine, the library, `mcpServers.ts`, or the UI.

The engine creates one runner per agent node through `ensureRunner`. It reads the agent file before that call. The first `send` for that node includes the catalog. Redo calls `send()` on that same runner with the file body and without the catalog. A missing path or unreadable file fails the step before the SDK is called.
