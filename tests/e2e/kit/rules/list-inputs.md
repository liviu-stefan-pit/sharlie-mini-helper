---
name: List inputs
description: When the prompt has an Upstream section, end the file you write with an Inputs received list of its block headings.
---

If your prompt contains a `## Upstream` section, end the main file you write with:

```
## Inputs received
- <heading of the first ### block, copied exactly>
- <heading of the next ### block>
```

Copy each `###` heading text exactly, one per line, in the order they appear. If there is no `## Upstream` section, write `## Inputs received` followed by `- none`.

This list is how a person checks which connected nodes passed text to this agent.
