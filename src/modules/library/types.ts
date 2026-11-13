/**
 * Responsibility: shared library shapes and the library error type.
 * Inputs: none. Callers construct these values.
 * Outputs: snapshot, selection, and MCP transport types.
 */

export type LibrarySource = "cursor" | "app" | "import";

export type LibrarySkill = {
  id: string;
  source: LibrarySource;
  title: string;
  description: string;
  path: string;
  enabled: boolean;
};

export type LibraryRule = {
  id: string;
  source: LibrarySource;
  title: string;
  description: string;
  path: string;
  enabled: boolean;
};

export type McpTransportSummary =
  | { type: "stdio"; command: string; args: string[]; hasEnv: boolean }
  | { type: "http"; url: string; hasEnv: boolean };

export type LibraryMcp = {
  id: string;
  source: LibrarySource;
  name: string;
  hasEnv: boolean;
  transport: McpTransportSummary;
  enabled: boolean;
};

export type LibrarySnapshot = {
  skills: LibrarySkill[];
  rules: LibraryRule[];
  mcps: LibraryMcp[];
};

export type Selection = {
  skills: string[];
  rules: string[];
  mcps: string[];
};

export type CatalogEntry = {
  title: string;
  description: string;
  path: string;
};

export type EnabledMcpConfig = {
  id: string;
  name: string;
  source: LibrarySource;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env: Record<string, string>;
  headers?: Record<string, string>;
};

export type LibraryRoots = {
  cursorHome: string;
  appLibraryRoot: string;
};

export class LibraryError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LibraryError";
    this.status = status;
  }
}
