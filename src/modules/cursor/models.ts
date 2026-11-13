/**
 * Responsibility: the effective model id for an agent node.
 * Inputs: modelId from an agent node.
 * Outputs: resolveModelId().
 */

export function resolveModelId(data: { modelId: string }): string {
  return data.modelId.trim();
}
