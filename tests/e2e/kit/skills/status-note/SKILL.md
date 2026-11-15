---
name: Status note
description: Write a short status note file when the task is to leave a local markdown status note in the workflow folder.
---

# Status note

When the task is to leave a status note:

1. Create `status-note.md` in the current working directory (the workflow folder). Do not write outside that folder.
2. The file must contain a heading `# Status note`, the line `Author: brief writer`, and exactly three bullet points about what a test run proved (the app started a step, the agent could write a file, the note is ready for a human to read).
3. Do not call the network. Do not read or write `.env` files or credentials.
4. When finished, reply with the relative path `status-note.md` and nothing else.
