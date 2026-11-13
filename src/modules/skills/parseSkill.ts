/**
 * Responsibility: turn a SKILL.md document into a title, description, and path.
 * Inputs: markdown text and the skill file path.
 * Outputs: { title, description, skillPath }.
 */

export type SkillSummary = {
  title: string;
  description: string;
  skillPath: string;
};

export function parseSkillMarkdown(markdown: string, skillPath: string): SkillSummary {
  const text = markdown.replace(/^\uFEFF/, "");
  const frontmatter = readFrontmatter(text);
  const body = frontmatter ? frontmatter.body : text;
  const fields = frontmatter?.fields ?? {};

  let title = fields.name || fields.title || "";
  if (!title) {
    title = firstHeading(body);
  }
  if (!title) {
    title = fallbackTitle(skillPath);
  }

  let description = fields.description || "";
  if (!description) {
    description = firstParagraph(body);
  }

  return {
    title: title.trim() || fallbackTitle(skillPath),
    description: clip(description),
    skillPath,
  };
}

function readFrontmatter(text: string): { fields: Record<string, string>; body: string } | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  return {
    fields: parseFrontmatterFields(match[1] ?? ""),
    body: text.slice(match[0].length),
  };
}

function parseFrontmatterFields(raw: string): Record<string, string> {
  const lines = raw.split(/\r?\n/);
  const fields: Record<string, string> = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const matched = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!matched) {
      index += 1;
      continue;
    }
    const key = matched[1] ?? "";
    const inline = (matched[2] ?? "").trim();
    if (inline === "" || isBlockScalar(inline)) {
      const parts: string[] = [];
      index += 1;
      while (index < lines.length) {
        const next = lines[index] ?? "";
        if (next.trim() === "") {
          let look = index + 1;
          while (look < lines.length && (lines[look] ?? "").trim() === "") look += 1;
          if (look < lines.length && /^[ \t]/.test(lines[look] ?? "")) {
            index += 1;
            continue;
          }
          break;
        }
        if (!/^[ \t]/.test(next)) break;
        parts.push(next.trim());
        index += 1;
      }
      fields[key] = parts.join(" ").trim();
      continue;
    }
    fields[key] = unquote(inline);
    index += 1;
  }
  return fields;
}

function isBlockScalar(value: string): boolean {
  return /^(?:[>|][+-]?)$/.test(value);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    const inner = value.slice(1, -1);
    return value.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner;
  }
  return value;
}

function firstHeading(body: string): string {
  const matched = body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m);
  return matched?.[1]?.trim() ?? "";
}

function firstParagraph(body: string): string {
  const lines = body.split(/\r?\n/);
  let index = 0;
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+/.test(line));
  if (headingIndex >= 0) index = headingIndex + 1;
  while (index < lines.length && (lines[index] ?? "").trim() === "") index += 1;
  const parts: string[] = [];
  while (index < lines.length && (lines[index] ?? "").trim() !== "") {
    const line = (lines[index] ?? "").trim();
    if (!/^#{1,6}\s+/.test(line)) parts.push(line);
    index += 1;
  }
  return parts.join(" ");
}

function fallbackTitle(skillPath: string): string {
  const parts = skillPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? "Skill";
  if (base.toLowerCase() === "skill.md" && parts.length >= 2) {
    return parts[parts.length - 2] ?? base;
  }
  return base;
}

function clip(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 240) return collapsed;
  return collapsed.slice(0, 240).trim();
}
