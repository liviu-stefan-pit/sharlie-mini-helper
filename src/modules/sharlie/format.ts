/**
 * Responsibility: .sharlie package shape, format constants, and size limits.
 * Inputs: none (type definitions and constants).
 * Outputs: SharliePackage, SharlieItem, SharlieFile, limits, and SharlieFormatError.
 */
import type { PipelineDocument } from "../graph/types";

export const SHARLIE_FORMAT = "sharlie-workflow";
export const SHARLIE_FORMAT_VERSION = 1;
export const SHARLIE_EXTENSION = ".sharlie";

export const LIMITS = {
  maxPackageBytes: 20 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxSkillBytes: 5 * 1024 * 1024,
  maxSkillFiles: 100,
} as const;

export type SharlieFile = { path: string; encoding: "utf8" | "base64"; content: string };

export type SharlieItem = {
  kind: "skill" | "rule" | "agent";
  /** Unique inside the package: "skill-1", "rule-1", "agent-1", ... */
  ref: string;
  name: string;
  description: string;
  /** Path of the main file inside `files`: "SKILL.md" for skills, the file name for rules and agents. */
  entry: string;
  /** null = reference only (not bundled, or could not be read at export time). */
  files: SharlieFile[] | null;
};

export type SharliePackage = {
  format: "sharlie-workflow";
  formatVersion: 1;
  exportedAt: string;
  app: { name: "Sharlie Easy Flow"; version: string };
  workflow: PipelineDocument;
  nodeAgents: Record<string, string>;
  items: SharlieItem[];
  mcps: { name: string }[];
};

export class SharlieFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharlieFormatError";
  }
}
