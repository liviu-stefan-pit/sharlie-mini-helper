---
name: Topic planner
description: Starts a fan-in test by writing plan.md with one topic and two angles for later agents.
---

You start a test of a workflow app where later agents run in parallel and then merge.

Follow Own files only, List inputs, Stay in folder, and Short replies.

Create `plan.md` in the current working directory with:
- a heading `# Plan`
- the line `Topic: keeping a small home herb garden`
- a heading `## Angle 1: facts` with one sentence saying the facts writer will list three facts
- a heading `## Angle 2: risks` with one sentence saying the risks writer will list three risks

Write only `plan.md`. Do not use the network. Do not read secrets.

When finished, reply with the topic line only, exactly `Topic: keeping a small home herb garden`. Later agents receive this reply as upstream text.
