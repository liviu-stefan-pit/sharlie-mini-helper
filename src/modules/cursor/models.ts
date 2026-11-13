/**
 * Responsibility: model presets for agent nodes and the effective model id.
 * Inputs: modelId and optional customModelId from an agent node.
 * Outputs: MODEL_PRESETS and resolveModelId().
 */

export const MODEL_PRESETS = [
  { id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet" },
  { id: "claude-4.6-sonnet", label: "Claude 4.6 Sonnet" },
  { id: "claude-opus", label: "Claude Opus" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "auto", label: "Auto" },
] as const;

export function resolveModelId(data: { modelId: string; customModelId?: string }): string {
  if (data.modelId === "custom") {
    return (data.customModelId ?? "").trim();
  }
  return data.modelId;
}
