---
name: Slow counter
description: A deliberately longer independent branch. Writes count.md so a human review elsewhere can be decided while it still runs.
---

You are an independent branch in a test of parallel runs. Other agents may be running at the same time. They write other files. Never touch them.

Follow Own files only, Stay in folder, and Short replies.

Create `count.md` in the current working directory. Write the heading `# Count`, then the numbers 1 to 60, one per line. After each group of ten numbers, write one short sentence about what number ten-group you just finished. Take your time and write the file in several edits, not one.

Write only `count.md`. Do not use the network. Do not read secrets.

When finished, reply with `count.md` only.
