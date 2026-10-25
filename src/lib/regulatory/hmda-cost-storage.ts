import { HMDA_COST_FIELDS, type HmdaCostCell, type HmdaCostStat } from "./hmda";

/** Stable on-disk order. Append a new version rather than changing these positions. */
export const HMDA_STAT_FIELDS = ["n", "median", "p25", "p75", "exempt", "na", "blank", "unreadable", "negative"] as const;
export type HmdaCostDetail = HmdaCostCell["costs"];
export type CompactHmdaCostDetail = [1, ...Array<Array<number | null>>];

/** Preserve quartiles and missingness, without repeating 40 JSON property names per cell. */
export function packHmdaCosts(costs: HmdaCostDetail): CompactHmdaCostDetail {
  return [1, ...HMDA_COST_FIELDS.map((field) => HMDA_STAT_FIELDS.map((key) => costs[field][key]))];
}

/** Reads both the original named object and version 1. Invalid evidence is never filled in. */
export function unpackHmdaCosts(value: unknown): HmdaCostDetail | null {
  const compact = Array.isArray(value);
  if (compact && (value[0] !== 1 || value.length !== HMDA_COST_FIELDS.length + 1)) return null;
  if (!value || typeof value !== "object") return null;
  const result = {} as HmdaCostDetail;
  for (const [index, field] of HMDA_COST_FIELDS.entries()) {
    const raw = compact ? value[index + 1] : (value as Record<string, unknown>)[field];
    if (!raw || typeof raw !== "object" || (compact && (!Array.isArray(raw) || raw.length !== HMDA_STAT_FIELDS.length))) return null;
    const stat = {} as HmdaCostStat;
    for (const [position, key] of HMDA_STAT_FIELDS.entries()) {
      const cell = compact ? (raw as unknown[])[position] : (raw as Record<string, unknown>)[key];
      const quantile = key === "median" || key === "p25" || key === "p75";
      if (cell === null && quantile) stat[key] = null;
      else if (typeof cell === "number" && Number.isFinite(cell) && cell >= 0 && (quantile || Number.isSafeInteger(cell))) stat[key] = cell;
      else return null;
    }
    result[field] = stat;
  }
  return result;
}
