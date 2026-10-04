/**
 * Prose token resolution.
 *
 * Guide prose cites live fee data as `{{fee_category.stat}}` rather than as a typed
 * dollar figure. Tokens resolve at render from the same `getFeeCategorySummaries()`
 * result the benchmark cards use, so the prose and the card cannot disagree — they are
 * the same number.
 *
 * Escaping happens before substitution and the resolver emits only <strong> and <span>,
 * so guide prose can never inject markup.
 */

import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { formatAmount } from "@/lib/format";
import type { GuideStat } from "./types";

const TOKEN_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\.\s*([a-z0-9_]+)\s*\}\}/g;

const VALID_STATS: ReadonlySet<string> = new Set<GuideStat>([
  "median",
  "p25",
  "p75",
  "min",
  "max",
  "institutions",
  "zero_count",
]);

export interface ParsedToken {
  raw: string;
  category: string;
  stat: string;
}

export interface ResolveResult {
  html: string;
  /** Tokens that could not be resolved. Never rendered — surfaced to CI and admin. */
  unresolved: ParsedToken[];
}

/** Escape before substitution so prose can never inject markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Every token in a string, without resolving it. Used by tests and the admin preview. */
export function parseTokens(text: string): ParsedToken[] {
  const found: ParsedToken[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    found.push({ raw: match[0], category: match[1], stat: match[2] });
  }
  return found;
}

export function isValidStat(stat: string): boolean {
  return VALID_STATS.has(stat);
}

function statValue(
  summary: FeeCategorySummary | undefined,
  stat: string,
): number | null {
  if (!summary) return null;
  switch (stat) {
    case "median":
      return summary.median_amount;
    case "p25":
      return summary.p25_amount;
    case "p75":
      return summary.p75_amount;
    case "min":
      return summary.min_amount;
    case "max":
      return summary.max_amount;
    case "institutions":
      return summary.institution_count;
    case "zero_count":
      return summary.zero_count;
    default:
      return null;
  }
}

const COUNT_STATS = new Set(["institutions", "zero_count"]);

/**
 * Resolve tokens in a plain-text string to safe HTML.
 *
 * An unresolvable token renders an em dash rather than a wrong number, and is reported
 * in `unresolved` so CI and the admin preview can fail on it. It is never rendered raw.
 */
export function resolveTokens(
  text: string,
  summaries: FeeCategorySummary[],
): ResolveResult {
  const unresolved: ParsedToken[] = [];
  const byCategory = new Map(summaries.map((s) => [s.fee_category, s]));

  const html = escapeHtml(text).replace(
    TOKEN_PATTERN,
    (raw, category: string, stat: string) => {
      if (!isValidStat(stat)) {
        unresolved.push({ raw, category, stat });
        return "&mdash;";
      }
      const value = statValue(byCategory.get(category), stat);
      if (value === null || !Number.isFinite(value)) {
        unresolved.push({ raw, category, stat });
        return "&mdash;";
      }
      if (COUNT_STATS.has(stat)) {
        return `<span class="tabular-nums">${value.toLocaleString()}</span>`;
      }
      return `<strong class="tabular-nums">${escapeHtml(formatAmount(value))}</strong>`;
    },
  );

  return { html, unresolved };
}

/** Plain-text resolution, for metadata and structured data where markup is not wanted. */
export function resolveTokensToText(
  text: string,
  summaries: FeeCategorySummary[],
): string {
  const byCategory = new Map(summaries.map((s) => [s.fee_category, s]));
  return text.replace(TOKEN_PATTERN, (raw, category: string, stat: string) => {
    if (!isValidStat(stat)) return "—";
    const value = statValue(byCategory.get(category), stat);
    if (value === null || !Number.isFinite(value)) return "—";
    return COUNT_STATS.has(stat) ? value.toLocaleString() : formatAmount(value);
  });
}

/** Every token in a block, for validation. */
export function blockTokens(text: string): ParsedToken[] {
  return parseTokens(text);
}
