/**
 * Responsibility: request context shared by route handlers.
 * Inputs: Node request, response, parsed URL, and workspace root.
 * Outputs: RouteContext type.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  workspaceRoot: string;
};
