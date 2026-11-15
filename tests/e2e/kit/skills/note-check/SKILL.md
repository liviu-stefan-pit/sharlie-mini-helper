---
name: Note check
description: Check a local status note and write a pass or fail result when the task is to verify status-note.md.
---

# Note check

When the task is to verify `status-note.md`:

1. Read `status-note.md` in the current working directory.
2. It passes only if it has the heading `# Status note`, the line `Author: brief writer`, and exactly three bullet points.
3. Write `check-result.md` in the same folder. First line is `PASS` or `FAIL`. If `FAIL`, add one short line naming what is missing. If the source file is missing, write `FAIL` and `missing status-note.md`.
4. Do not call the network. Do not read or write `.env` files or credentials.
5. When finished, reply with `PASS` or `FAIL` only.
