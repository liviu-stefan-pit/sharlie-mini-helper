# sharlie-mini-helper

Local-first web dashboard for chaining Cursor skills and agents on a visual canvas. Graphs stay on your machine as JSON files.

## Quickstart

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`. When you have a Cursor API key, put it in `CURSOR_API_KEY`. The key stays in that local file.

3. Start the dev servers:

```bash
npm run dev
```

4. Open the Vite URL printed in the terminal, usually http://127.0.0.1:5173.

## Nodes

The canvas has three node types:

- **Agent** — pick a model (or a custom model id), write a prompt, and see status, elapsed time, and token counts.
- **Skill** — choose a discovered `SKILL.md` or type a custom path. The card shows the skill title and description.
- **Human** — a review step with notes, an artifact list, and approve, redo, and decline actions.

Save writes the current graph to `data/pipelines/<id>.json`. Load opens a pipeline you already saved.
