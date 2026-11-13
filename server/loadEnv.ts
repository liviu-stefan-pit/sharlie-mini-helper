/**
 * Responsibility: load a workspace .env file without printing values.
 * Inputs: path to an env file (defaults to .env in the current working directory).
 * Outputs: process.env entries for keys that are not already set.
 */
import fs from "node:fs";
import path from "node:path";

export function loadEnv(envPath = path.join(process.cwd(), ".env")): void {
  let text: string;
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  applyEnvText(text);
}

export async function upsertEnvValue(envPath: string, key: string, value: string): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error("Invalid env key");
  }
  let text = "";
  try {
    text = await fs.promises.readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const lines = text.length > 0 ? text.replace(/^\uFEFF/, "").split(/\n/) : [];
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=`);
  let replaced = false;
  const next: string[] = [];
  for (const line of lines) {
    const bare = line.replace(/\r$/, "");
    if (pattern.test(bare)) {
      if (!replaced) {
        next.push(`${key}=${formatEnvValue(value)}`);
        replaced = true;
      }
      continue;
    }
    next.push(bare);
  }
  if (!replaced) next.push(`${key}=${formatEnvValue(value)}`);
  const body = `${next.join("\n").replace(/\n+$/, "")}\n`;
  await fs.promises.writeFile(envPath, body, "utf8");
}

function applyEnvText(text: string): void {
  for (const line of text.replace(/^\uFEFF/, "").split(/\n/)) {
    const bare = line.replace(/\r$/, "");
    const trimmed = bare.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = bare.indexOf("=");
    if (eq <= 0) continue;
    const key = bare.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnv(bare.slice(eq + 1).trim());
  }
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./+=:@-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquoteEnv(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}
