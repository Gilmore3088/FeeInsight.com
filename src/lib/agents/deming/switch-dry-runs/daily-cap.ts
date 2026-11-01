import { canonicalHintFrom } from "@/lib/agents/darwin/verify";
import { checkFeeAgainstSource, DAILY_CAP_CATEGORIES } from "@/lib/custom-report/source-check";
import type { CapTier, DailyCapRow } from "./types";

/**
 * `DAILY_CAP_LINES_LIVE` (#2768, Knox v146): od_daily_cap and nsf_daily_cap rows whose shared check
 * changes when the wider cap trace is switched on. Each row is checked twice against its own
 * document's newest completed text, with `checkFeeAgainstSource` and the switch passed as
 * `dailyCapLines` off and on; every other option is left at its production default. Pure.
 */

export const CAP_TIERS: readonly CapTier[] = ["live", "removed", "rejected", "held", "verified_unpublished", "unjudged"];

export interface CapIdentity {
  tier: CapTier;
  category: string;
  name: string;
  amount: number;
}

export type CapChange = "now_traces" | "stops_tracing" | "unchanged" | "no_text";

export interface CapVerdict extends CapIdentity {
  feeRawId: number;
  feePublishedId: number | null;
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number | null;
  change: CapChange;
  /** Why the check fails with the switch off (or on, for a row that stops tracing). */
  failure: string | null;
  /** The line the row traces to with the switch on, or off for a row that stops tracing. */
  line: string | null;
}

const num = (value: number | string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Where the row stands: its published row first, then its verified row, then Darwin's decision. */
export function capTier(row: DailyCapRow): CapTier {
  if (row.fee_published_id != null) return row.removed ? "removed" : "live";
  if (row.fee_verified_id != null) return row.review_status === "rejected" ? "rejected" : "verified_unpublished";
  if (row.verify_decision === "rejected") return "rejected";
  if (row.verify_decision === "needs_review") return "held";
  return "unjudged";
}

/** The row's category, name and amount at its furthest tier, or null when it is no daily cap. */
export function capIdentity(row: DailyCapRow): CapIdentity | null {
  const tier = capTier(row);
  const category =
    (row.fee_published_id != null ? row.published_key : null) ??
    (row.fee_verified_id != null ? row.verified_key : null) ??
    row.verify_key ??
    canonicalHintFrom({ outlier_flags: row.outlier_flags, conditions: row.conditions });
  if (!category || !DAILY_CAP_CATEGORIES.has(category)) return null;
  const name = (row.fee_published_id != null ? row.published_name : null) ?? (row.fee_verified_id != null ? row.verified_name : null) ?? row.raw_name;
  const amount =
    num(row.fee_published_id != null ? row.published_amount : null) ??
    num(row.fee_verified_id != null ? row.verified_amount : null) ??
    num(row.raw_amount);
  if (amount == null || !name) return null;
  return { tier, category, name, amount };
}

/** The row checked with the switch off and on. Null when the row is no daily cap. */
export function judgeDailyCap(row: DailyCapRow, text: string | null | undefined): CapVerdict | null {
  const identity = capIdentity(row);
  if (!identity) return null;
  const base = {
    ...identity,
    feeRawId: Number(row.fee_raw_id),
    feePublishedId: num(row.fee_published_id),
    institutionId: Number(row.institution_id),
    institutionName: row.institution_name,
    sourceDocumentId: num(row.source_document_id),
  };
  if (!text) return { ...base, change: "no_text", failure: null, line: null };
  const check = (dailyCapLines: boolean) =>
    checkFeeAgainstSource(text, identity.name, identity.amount, ".", identity.category, { dailyCapLines });
  const off = check(false);
  const on = check(true);
  if (!off.ok && on.ok) return { ...base, change: "now_traces", failure: off.reason, line: on.sourceLine };
  if (off.ok && !on.ok) return { ...base, change: "stops_tracing", failure: on.reason, line: off.sourceLine };
  return { ...base, change: "unchanged", failure: null, line: null };
}

export interface CapTierCounts {
  rows: number;
  noText: number;
  nowTraces: number;
  stopsTracing: number;
}

export interface DailyCapSummary {
  byTier: Record<CapTier, CapTierCounts>;
  rows: number;
  nowTraces: number;
  /** Distinct fees among them: one per document, tier, category, amount and name (Knox re-reads repeat rows). */
  nowTracesFees: number;
  stopsTracing: number;
  noText: number;
  /** Rows that go from not-ok to ok, capped. */
  nowTracesSamples: CapVerdict[];
  /** Rows that go from ok to not-ok, capped: a live one would come down with the switch on. */
  stopsTracingSamples: CapVerdict[];
}

export function emptyDailyCapSummary(): DailyCapSummary {
  const byTier = Object.fromEntries(CAP_TIERS.map((tier) => [tier, { rows: 0, noText: 0, nowTraces: 0, stopsTracing: 0 }])) as Record<CapTier, CapTierCounts>;
  return { byTier, rows: 0, nowTraces: 0, nowTracesFees: 0, stopsTracing: 0, noText: 0, nowTracesSamples: [], stopsTracingSamples: [] };
}

const feeKey = (verdict: CapVerdict): string =>
  [verdict.sourceDocumentId, verdict.tier, verdict.category, verdict.amount, verdict.name.toLowerCase().replace(/\s+/g, " ").trim()].join("|");

/**
 * Adds verdicts to a running summary (the runner reads documents in chunks). `seen` holds the distinct
 * fees already counted, so pass the same set for every chunk of one summary.
 */
export function addDailyCapVerdicts(
  summary: DailyCapSummary,
  verdicts: readonly CapVerdict[],
  sampleCap: number,
  seen: Set<string>,
): DailyCapSummary {
  for (const verdict of verdicts) {
    const tier = summary.byTier[verdict.tier];
    tier.rows += 1;
    summary.rows += 1;
    if (verdict.change === "no_text") {
      tier.noText += 1;
      summary.noText += 1;
    } else if (verdict.change === "now_traces") {
      tier.nowTraces += 1;
      summary.nowTraces += 1;
      if (!seen.has(feeKey(verdict))) {
        seen.add(feeKey(verdict));
        summary.nowTracesFees += 1;
      }
      if (summary.nowTracesSamples.length < sampleCap) summary.nowTracesSamples.push(verdict);
    } else if (verdict.change === "stops_tracing") {
      tier.stopsTracing += 1;
      summary.stopsTracing += 1;
      if (summary.stopsTracingSamples.length < sampleCap) summary.stopsTracingSamples.push(verdict);
    }
  }
  return summary;
}

/** Judges rows against their documents' texts (keyed by document id). */
export function judgeDailyCaps(rows: readonly DailyCapRow[], texts: ReadonlyMap<number, string>): CapVerdict[] {
  return rows
    .map((row) => judgeDailyCap(row, row.source_document_id == null ? null : texts.get(Number(row.source_document_id))))
    .filter((verdict): verdict is CapVerdict => verdict != null);
}
