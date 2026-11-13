/**
 * Responsibility: local Cursor agent runs and the account model list.
 * Inputs: API key, working directory, model id, enabled MCP servers, and a prompt.
 * Outputs: assistant text, token events from SDK usage messages, and send status.
 * This is the only module that imports @cursor/sdk.
 */
import { Agent, Cursor, CursorAgentError, type SDKAgent, type SDKMessage } from "@cursor/sdk";
import type { EnabledMcpConfig } from "../library/types";
import { toSdkMcpServers } from "./mcpServers";

export type RunnerStartOptions = {
  apiKey: string;
  cwd: string;
  modelId: string;
  mcpServers: readonly EnabledMcpConfig[];
};

export type RunnerEvent =
  | { type: "assistant"; text: string }
  | { type: "token"; input?: number; output?: number; total?: number };

export type SendResult = {
  status: "finished" | "error";
  text: string;
  error?: string;
  failure: "none" | "startup" | "run";
};

export interface CursorAgentRunner {
  start(options: RunnerStartOptions): Promise<void>;
  send(prompt: string, onEvent: (event: RunnerEvent) => void): Promise<SendResult>;
  dispose(): Promise<void>;
}

export function createCursorAgentRunner(): CursorAgentRunner {
  return new LocalCursorRunner();
}

export async function listModels(apiKey: string): Promise<{ id: string; label: string }[]> {
  const models = await Cursor.models.list({ apiKey });
  return models.map((model) => ({
    id: model.id,
    label: model.displayName.trim() || model.id,
  }));
}

class LocalCursorRunner implements CursorAgentRunner {
  private agent: SDKAgent | undefined;
  private startupError: string | undefined;
  private startTask: Promise<void> | undefined;
  private disposed = false;

  async start(options: RunnerStartOptions): Promise<void> {
    if (this.disposed || this.agent || this.startupError) return;
    if (!this.startTask) {
      this.startTask = this.createAgent(options);
    }
    await this.startTask;
  }

  async send(prompt: string, onEvent: (event: RunnerEvent) => void): Promise<SendResult> {
    if (this.disposed) {
      return { status: "error", text: "", error: "Runner disposed", failure: "startup" };
    }
    if (this.startupError) {
      return { status: "error", text: "", error: this.startupError, failure: "startup" };
    }
    const agent = this.agent;
    if (!agent) {
      return { status: "error", text: "", error: "Runner not started", failure: "startup" };
    }

    let text = "";
    let run;
    try {
      run = await agent.send(prompt);
    } catch (error) {
      return failureFrom(error, "");
    }

    let streamError: unknown;
    try {
      for await (const message of run.stream()) {
        text += publishMessage(message, onEvent);
      }
    } catch (error) {
      streamError = error;
    }

    try {
      const result = await run.wait();
      if (streamError) return failureFrom(streamError, text);
      if (result.status === "error" || result.status === "cancelled") {
        return {
          status: "error",
          text,
          error: result.error?.message || (result.status === "cancelled" ? "Run cancelled" : "Run failed"),
          failure: "run",
        };
      }
      return { status: "finished", text, failure: "none" };
    } catch (error) {
      if (streamError) return failureFrom(streamError, text);
      return failureFrom(error, text);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.startTask;
    } catch {
      // createAgent records the failure instead of rejecting.
    }
    const agent = this.agent;
    this.agent = undefined;
    if (!agent) return;
    try {
      await agent[Symbol.asyncDispose]();
    } catch {
      // The process is dropping the agent either way.
    }
  }

  private async createAgent(options: RunnerStartOptions): Promise<void> {
    if (this.disposed) {
      this.startupError = "Runner disposed";
      return;
    }
    let created: SDKAgent;
    try {
      created = await Agent.create({
        apiKey: options.apiKey,
        model: { id: options.modelId },
        local: {
          cwd: options.cwd,
          settingSources: [],
        },
        mcpServers: toSdkMcpServers(options.mcpServers),
      });
    } catch (error) {
      this.startupError = error instanceof Error ? error.message : "Agent create failed";
      return;
    }
    if (this.disposed) {
      try {
        await created[Symbol.asyncDispose]();
      } catch {
        // Already shutting down.
      }
      return;
    }
    this.agent = created;
  }
}

function publishMessage(message: SDKMessage, onEvent: (event: RunnerEvent) => void): string {
  if (message.type === "assistant") {
    const content = message.message?.content;
    if (!Array.isArray(content)) return "";
    let text = "";
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string" && block.text) {
        onEvent({ type: "assistant", text: block.text });
        text += block.text;
      }
    }
    return text;
  }
  if (message.type === "usage") {
    const token = tokenEvent(message.usage);
    if (token) onEvent(token);
  }
  return "";
}

/**
 * SDK stream messages of type "usage" carry TokenUsage:
 * usage.inputTokens, usage.outputTokens, usage.totalTokens.
 */
function tokenEvent(
  usage: { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown } | null | undefined,
): RunnerEvent | null {
  if (typeof usage !== "object" || usage === null) return null;
  const input = typeof usage.inputTokens === "number" ? usage.inputTokens : undefined;
  const output = typeof usage.outputTokens === "number" ? usage.outputTokens : undefined;
  const reportedTotal = typeof usage.totalTokens === "number" ? usage.totalTokens : undefined;
  const event: RunnerEvent = { type: "token" };
  if (input !== undefined && output !== undefined) {
    event.input = input;
    event.output = output;
    event.total = reportedTotal ?? input + output;
    return event;
  }
  if (input !== undefined || output !== undefined) {
    if (input !== undefined) event.input = input;
    if (output !== undefined) event.output = output;
    return event;
  }
  if (reportedTotal !== undefined) {
    event.total = reportedTotal;
    return event;
  }
  return null;
}

function failureFrom(error: unknown, text: string): SendResult {
  if (error instanceof CursorAgentError) {
    return { status: "error", text, error: error.message, failure: "startup" };
  }
  return {
    status: "error",
    text,
    error: error instanceof Error ? error.message : "Run failed",
    failure: "run",
  };
}
