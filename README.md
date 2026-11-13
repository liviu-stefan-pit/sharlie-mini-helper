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

Run posts the canvas graph to `POST /api/runs`. The server resolves the graph and starts local `@cursor/sdk` agents: one local agent per Agent node, with the workspace as the working directory. Skills on attachment edges are injected into that agent's prompt. Execution follows topological order of the agent and human nodes. Skill nodes are not execution steps.

Events come back on `GET /api/runs/:id/events`. A human decision goes to `POST /api/runs/:id/decision`.

## Human review

When the run reaches a Human node, the pipeline pauses and the top bar shows Waiting for review.

- **Approve** continues at the next step.
- **Redo** sends the note plus the previous output back to the upstream agent and increments that agent's retry count.
- **Decline** stops the run.

Artifact paths on the human card can be copied and previewed. Preview reads the file through `GET /api/files`.

## Token pill

The token pill is reported usage only. It shows the current run total and the process session total from usage events. It does not estimate cost.

## Tests

```bash
npm test
```

`npm test` runs the three critical-path files with `node:test`: `tests/skills.test.ts`, `tests/graph.test.ts`, and `tests/human-gate.test.ts`.
