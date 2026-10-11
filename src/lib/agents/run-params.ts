// Pure run input parsing shared by the agent ledger; no database or provider dependencies.
export function numericRunParam(
  params: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = params[key];
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** The lane's re-check mode (`recheck: 'quarterly'`), or null for a normal pass. */
export function laneRecheckParam(params: Record<string, unknown>): "quarterly" | null {
  return params.recheck === "quarterly" ? "quarterly" : null;
}

export function stringRunParam(
  params: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

