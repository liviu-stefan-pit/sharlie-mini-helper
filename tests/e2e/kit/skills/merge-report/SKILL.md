---
name: Merge report
description: Merge the facts and risks received in the Upstream section into report.md when the task is the join step of a fan-in test.
---

# Merge report

When the task is to merge upstream results into a report:

1. Use only the `## Upstream` section of the prompt. Do not read `facts.md` or `risks.md` from disk.
2. Find the block whose lines are facts and the block whose lines are risks. A block heading may end with `approved in human review`; that only means a person approved it first.
3. Create `report.md` in the current working directory with:
   - the heading `# Report`
   - `## Facts` with the three fact bullets copied as received
   - `## Risks` with the three risk bullets copied as received
   - `## Summary` with one sentence that ties the facts and risks together
   - the `## Inputs received` list from the List inputs rule
4. If the facts or the risks block is missing, put `MISSING INPUT: facts` or `MISSING INPUT: risks` as the first line, and leave that section with `- none`.
5. Do not call the network. Do not read or write `.env` files or credentials.
