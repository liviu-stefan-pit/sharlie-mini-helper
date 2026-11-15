# Plan: real end-to-end workflow tests

Status: implemented.

## Goal

Run real workflows against the Cursor SDK with the user's own key, and check that fan-in, the human gate, and the upstream text work end to end. The unit tests keep using fakes. These tests cost real tokens, so they are opt-in.

## Where things live

- `tests/e2e/kit/` is the test kit, moved from `C:\prod\workspace_testing\Sharlie-flows`. It is laid out like a Cursor home:
  - `agents/*.md`: the eight test agents.
  - `rules/*.md|.mdc`: the four test rules.
  - `skills/<name>/SKILL.md`: the five test skills.
  - `README.md`: how to use the kit by hand in the app.
- `tests/e2e/harness.ts` has the shared helpers. It is not a test file.
- `tests/e2e/workflows.e2e.test.ts` has the tests.
- `npm run test:e2e` runs them. `npm test` does not include them.

## How a test runs

1. **Key.** Read `CURSOR_API_KEY` from the environment first, then from Windows Credential Manager through `readApiKey()` in `server/credentials.ts`. If there is no key, every test is skipped with a message. The key is never printed.
2. **Model.** Use `SHARLIE_E2E_MODEL` when it is set, otherwise `composer-2.5`, which is fast and has no effort parameter. The model must be in `listModels`, otherwise the suite fails with the list of valid ids.
3. **Library.** `scanLibrary` reads the kit as a Cursor home, with an empty temporary app library root. Every scanned skill and rule goes into `buildCatalogPrompt`. This is the same scan and catalog code the server uses.
4. **Workflow.** Each test builds a version 1 `PipelineDocument` with absolute `agentPath`s into the kit, then calls `resolvePipeline`. That is the real resolver.
5. **Run.** `startRun` from `src/modules/runs/engine.ts` runs it with the real `CursorAgentRunner`, in a fresh temporary workflow folder. The test listens through `subscribeRun` and decides through `decideRun`. The HTTP layer is left out, because the server reads the user's saved workspace from `data/app/settings.json`.
6. **Observation.** `createRunner` receives the node id (a small engine change, which the fakes ignore). The harness wraps each real runner to:
   - record every prompt sent to that node, so upstream blocks, the catalog and redo bodies can be checked exactly;
   - optionally hold a node's send behind a gate the test opens later. This makes "a branch is still running" deterministic instead of depending on model speed.
7. **Cleanup.** The temporary folder is removed after a passing test. It is kept, and its path printed, when a test fails or `SHARLIE_E2E_KEEP=1`.

## Checks

Checks on what the app does are strict. Checks on what the model wrote are kept loose, so that model wording does not make the tests flaky.

| Test | Graph | App checks (strict) | Model checks (loose) |
| --- | --- | --- | --- |
| Simple chain | Brief writer → Note checker | Run `done`. The checker's first prompt has one upstream block, from Brief writer. The catalog is on the first send. | `status-note.md` exists. `check-result.md` starts with `PASS`. |
| Fan-in join | Topic planner → Facts writer and Risks writer → Report merger → Report checker | The two writers are running at the same time. The merger starts only after both are done. The merger's prompt has blocks from Facts writer and Risks writer, and none from Topic planner. | `facts.md`, `risks.md` and `report.md` exist. `report.md` has `# Report`. `report-check.md` starts with `PASS`. |
| Human, Redo one, Redo all, Approve | Topic planner → both writers → Human → Report merger | The run pauses with the human waiting. Redo one re-sends only Risks writer: the retry count becomes 1, and the prompt is the agent body with no catalog and no upstream. Redo all re-sends both. The merger does not start before Approve. Its blocks end with `approved in human review`. | `report.md` exists. |
| Review while another branch runs | Topic planner → Facts writer → Human, plus Slow counter → Report merger, and Human → Report merger | Slow counter is held. While it is held, the human waits and the run stays `running`, not `paused`. Approve is accepted, but the merger does not start. Once Slow counter is released, the merger starts and the run ends `done`. | `count.md` exists. |
| Decline | Same graph as the previous test | With Slow counter held, Decline stops the run (`stopped`). The merger never starts, and Slow counter's late result is ignored. | none |

## Limits

- The tests use real tokens. Expect about 15 agent sends over a full run.
- Each test has a 10 minute timeout.
- The tests do not check the UI, the HTTP routes or MCP servers. The canvas was already checked by hand in the browser.
- The kit's original folder outside the repo is left as it is.
