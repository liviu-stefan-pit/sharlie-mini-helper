/**
 * Responsibility: the effective model id and effort selection for an agent node.
 * Inputs: modelId and effort from an agent node, the effort parameter id, and catalog parameters.
 * Outputs: resolveModelId(), defaultEffort(), effortListing(), and modelSelection().
 * This module does not import @cursor/sdk.
 */

export function resolveModelId(data: { modelId: string }): string {
  return data.modelId.trim();
}

export function defaultEffort(values: readonly { value: string }[]): string {
  if (values.length === 0) return "";
  if (values.some((item) => item.value === "medium")) return "medium";
  return values[Math.floor((values.length - 1) / 2)]?.value ?? "";
}

export type EffortChoice = { value: string; label: string };

export type EffortListing = {
  /** "" when the catalog has no effort parameter. */
  paramId: string;
  choices: EffortChoice[];
};

type CatalogParameter = {
  id: string;
  displayName?: string;
  values?: readonly { value: string; displayName?: string }[];
};

type CatalogVariant = {
  params?: readonly { id: string; value: string }[];
};

export function effortListing(model: {
  parameters?: readonly CatalogParameter[];
  variants?: readonly CatalogVariant[];
}): EffortListing {
  const parameter = effortParameter(model.parameters);
  if (parameter?.values?.length) {
    return { paramId: parameter.id, choices: choicesFrom(parameter.values) };
  }
  return effortFromVariants(model.variants);
}

export function modelSelection(
  modelId: string,
  effort: string,
  effortParamId = "",
): { id: string; params?: { id: string; value: string }[] } {
  const value = effort.trim();
  if (!value) return { id: modelId };
  const id = effortParamId.trim() || "effort";
  return { id: modelId, params: [{ id, value }] };
}

function effortParameter(parameters: readonly CatalogParameter[] | undefined): CatalogParameter | undefined {
  if (!parameters?.length) return undefined;
  const withValues = parameters.filter((parameter) => (parameter.values?.length ?? 0) > 0);
  return (
    withValues.find((parameter) => parameter.id === "effort") ??
    withValues.find((parameter) => isEffortDisplayName(parameter.displayName)) ??
    withValues.find((parameter) => isEffortParamId(parameter.id))
  );
}

function effortFromVariants(variants: readonly CatalogVariant[] | undefined): EffortListing {
  if (!variants?.length) return { paramId: "", choices: [] };
  const ids: string[] = [];
  for (const variant of variants) {
    for (const param of variant.params ?? []) {
      if (!isEffortParamId(param.id) || ids.includes(param.id)) continue;
      ids.push(param.id);
    }
  }
  const paramId = ids.includes("effort") ? "effort" : (ids[0] ?? "");
  if (!paramId) return { paramId: "", choices: [] };
  const seen = new Set<string>();
  const choices: EffortChoice[] = [];
  for (const variant of variants) {
    for (const param of variant.params ?? []) {
      if (param.id !== paramId || seen.has(param.value)) continue;
      seen.add(param.value);
      choices.push({ value: param.value, label: param.value });
    }
  }
  if (choices.length === 0) return { paramId: "", choices: [] };
  return { paramId, choices };
}

function choicesFrom(values: readonly { value: string; displayName?: string }[]): EffortChoice[] {
  return values.map((entry) => ({
    value: entry.value,
    label: entry.displayName && entry.displayName.trim() !== "" ? entry.displayName.trim() : entry.value,
  }));
}

function isEffortDisplayName(name: string | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "effort";
}

function isEffortParamId(id: string): boolean {
  return id === "effort" || id.endsWith("_effort");
}
