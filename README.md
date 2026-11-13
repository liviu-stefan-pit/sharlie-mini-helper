# Sharlie Easy Flow

Local-first web dashboard for chaining Cursor skills and agents on a visual canvas. Graphs stay on your machine as JSON files.

## Quickstart

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`. `CURSOR_API_KEY` is read from that file when the API process starts. The Settings modal can save a key later: `POST /api/settings` writes `CURSOR_API_KEY` into the workspace `.env` and updates the running process. `GET /api/settings` and the save response return `{ configured }` only. The API never returns the key.

3. Start the dev servers:

```bash
npm run dev
```

4. Open the Vite URL printed in the terminal, usually http://127.0.0.1:5173.

5. Open Settings and pick a workspace folder.

## Nodes

The canvas has three node types:

- **Agent** — pick a model (or a custom model id), write a prompt, and see status, elapsed time, and token counts.
- **Skill** — choose a discovered `SKILL.md` or type a custom path. The card shows the skill title and description.
- **Human** — a review step with notes, an artifact list, and approve, redo, and decline actions.

Save writes `<workspace>/<id>/.sharlie/workflow.json`. Load opens a pipeline you already saved.

Pipelines are version 1 JSON.

## Run

Run posts the canvas graph to `POST /api/runs`. The server resolves the graph and starts local `@cursor/sdk` agents: one local agent per Agent node, with `<workspace>/<id>/` as the working directory. Skills on attachment edges are injected into that agent's prompt. Execution follows topological order of the agent and human nodes. Skill nodes are not execution steps.

Events come back on `GET /api/runs/:id/events`. A human decision goes to `POST /api/runs/:id/decision`.

## Human review

When the run reaches a Human node, the pipeline pauses and the top bar shows Waiting for review.

- **Approve** continues at the next step.
- **Redo** sends the note plus the previous output back to the upstream agent and increments that agent's retry count.
- **Decline** stops the run.

Artifact paths on the human card can be copied and previewed. Preview reads the file through `GET /api/files`.

## Token pill

The token pill is reported usage only. It shows the current run total and the process session total from usage events. It does not estimate cost.

## Export

Export is in the top bar. It saves the current workflow, then opens a native Save dialog with `<workflow name>.sharlie` filled in. `POST /api/sharlie/export` writes the file.

The export can include skill, rule, and agent files. MCP servers are stored as names only. A `.sharlie` file does not contain MCP command, args, url, env, headers, or `CURSOR_API_KEY`.

## Import

Import is in the top bar, beside Export. It opens a native file dialog for a `.sharlie` file. `POST /api/sharlie/import` creates a new workflow folder and extracts bundled skills, rules, and agents into `.sharlie/bundle/`.

A missing skill, rule, agent, or MCP server does not fail the import. The workflow loads, and a warnings list names what is missing. Import fails when the file is not valid JSON, is not a `.sharlie` package, has no format version, was made by a newer app, or contains a damaged workflow. A file larger than 20 MB is rejected.

## Missing items

A missing agent, model, skill, rule, or MCP server is shown in red. Hover the red name to see what is missing and how to fix it. The Dependencies button in the top bar opens that list. A count on the button means something needs attention. An MCP server that exists but is turned off is shown in amber.

A missing agent blocks Run. A missing skill, rule, or MCP server does not. The run starts, and a notice names what was left out.

## Tests

```bash
npm test
```

`npm test` runs the three critical-path files with `node:test`: `tests/skills.test.ts`, `tests/graph.test.ts`, and `tests/human-gate.test.ts`.
