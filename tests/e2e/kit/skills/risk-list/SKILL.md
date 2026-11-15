---
name: Risk list
description: Write risks.md with three short risks when the task is the risks branch of a fan-in test.
---

# Risk list

When the task is to write the risks branch:

1. Create `risks.md` in the current working directory. Do not write outside that folder and do not touch `facts.md`.
2. Start with the heading `# Risks`, then the line `Topic: <topic>` using the topic you were given.
3. Write exactly three bullet points. Each names one thing that can go wrong with the topic and one way to avoid it, under 25 words.
4. End the file with the `## Inputs received` list from the List inputs rule.
5. Do not call the network. Do not read or write `.env` files or credentials.
