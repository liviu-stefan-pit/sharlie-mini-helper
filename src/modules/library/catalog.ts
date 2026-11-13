/**
 * Responsibility: build the catalog text prepended to an agent role prompt.
 * Inputs: enabled skill and rule entries, plus the role prompt.
 * Outputs: catalog instructions, or the catalog followed by a blank line and the role.
 */
import type { CatalogEntry } from "./types";

const SKILL_INTRO =
  "Use a skill only when its description matches the task. Read that file before following it. Do not use skills that are not listed.";
const RULE_INTRO =
  "Read a rule only when its description matches the task. Do not follow rules that are not listed.";
const MCP_OUTRO = "Only the MCP servers attached to this run are valid; do not look for other MCP servers.";

export function buildCatalogPrompt(enabledSkills: readonly CatalogEntry[], enabledRules: readonly CatalogEntry[]): string {
  return [section("Skills", SKILL_INTRO, enabledSkills), section("Rules", RULE_INTRO, enabledRules), MCP_OUTRO].join(
    "\n\n",
  );
}

export function applyCatalog(rolePrompt: string, catalog: string): string {
  return `${catalog}\n\n${rolePrompt}`;
}

function section(title: string, intro: string, items: readonly CatalogEntry[]): string {
  const lines = [`## ${title}`, intro];
  if (items.length === 0) {
    lines.push("There are none.");
    return lines.join("\n");
  }
  for (const item of items) {
    lines.push(`- ${oneLine(item.title)}: ${oneLine(item.description)}`);
    lines.push(`  File: ${oneLine(item.path)}`);
  }
  return lines.join("\n");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
