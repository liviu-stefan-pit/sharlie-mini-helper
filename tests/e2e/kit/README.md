# Sharlie test kit

Agents, rules, and skills for trying Sharlie Easy Flow. `npm run test:e2e` runs workflows 1 to 5 below automatically against the real Cursor SDK (see `tests/e2e/workflows.e2e.test.ts` and `docs/plan-e2e-tests.md`). It uses the key saved in the app settings and real tokens. To try them by hand, import them from the app:

- Agents: on an agent node, **Browse** and pick a file in `agents/`.
- Skills: **Library → Import skill**, pick a folder in `skills/`.
- Rules: **Library → Import rule**, pick a file in `rules/`.

Turn on every imported skill and rule in the Library before running.

## Agents

| File | Role | Writes |
| --- | --- | --- |
| `brief-writer.md` | Simple chain, step 1 | `status-note.md` |
| `note-checker.md` | Simple chain, step 2 | `check-result.md` |
| `topic-planner.md` | Fan-in test start | `plan.md` |
| `facts-writer.md` | Parallel branch 1 | `facts.md` |
| `risks-writer.md` | Parallel branch 2 | `risks.md` |
| `report-merger.md` | Join (two inputs) | `report.md` |
| `report-checker.md` | Checks the join | `report-check.md` |
| `slow-counter.md` | Long independent branch | `count.md` |

Every agent writes its own file, so parallel branches never edit the same file.

## Rules

- `stay-in-folder.mdc`: write only inside the workflow folder, never touch secrets.
- `short-replies.md`: one-line final reply.
- `own-files-only.mdc`: with parallel agents, write only your own file.
- `list-inputs.md`: end the written file with an `## Inputs received` list of upstream headings. Use it to see which connected nodes passed text along.

## Skills

- `status-note`, `note-check`: the simple chain.
- `fact-list`, `risk-list`, `merge-report`: the fan-in test.

## Workflows to build

### 1. Simple chain (sanity check)

`Brief writer → Note checker`. Expect `check-result.md` to start with `PASS`.

### 2. Fan-in (join waits for both)

```
Topic planner ─┬─► Facts writer ─┐
               └─► Risks writer ─┴─► Report merger ─► Report checker
```

Expect:
- Facts writer and Risks writer run at the same time.
- Report merger shows "Waiting for N of 2 inputs" until both finish, then starts.
- `report.md` lists two blocks under `## Inputs received` (Facts writer and Risks writer), and **not** Topic planner. Only directly connected nodes pass text.
- `report-check.md` starts with `PASS`.

### 3. Fan-in through a human, with Redo one

```
Topic planner ─┬─► Facts writer ─┐
               └─► Risks writer ─┴─► Human ─► Report merger
```

The human reviews both writers, so its card shows **Redo all** and **Redo one**. Try:
- **Redo one → Risks writer**: only Risks writer runs again and its retry count goes up. Facts writer stays done.
- **Redo all**: both writers run again.
- **Approve**: Report merger starts. Its headings end with `approved in human review`.

### 4. A review does not block another branch

```
Topic planner ─► Facts writer ─► Human ─┐
                                        ├─► Report merger
Slow counter ───────────────────────────┘
```

While Slow counter is still running, the human can already be approved or redone. Report merger starts only when both the human has approved and Slow counter is done. (The merge will report `MISSING INPUT: risks`. That is expected here.)

### 5. Decline

Any workflow with a human: **Decline** stops the whole run, including branches that are still running.
