import { canonicalHintFrom, sourceLineFor, statedInOwnSource } from "@/lib/agents/darwin/verify";
import { checkFeeAgainstSource, DAILY_CAP_CATEGORIES } from "@/lib/custom-report/source-check";
import { capLineKey, classifyCapLines, type CapLines, type CapPriceChange } from "./cap-lines";
import { capRecheck, type CapRecheck } from "./cap-recheck";
import type { CapTier, DailyCapRow } from "./types";

/**
 * `DAILY_CAP_LINES_LIVE` (#2768, Knox v146): od_daily_cap and nsf_daily_cap rows whose shared check
 * changes when the wider cap trace is switched on. Each row is checked twice against its own
 * document's newest completed text, with `dailyCapLines` off and on, the way the code that decides
 * that row's fate checks it:
 * - a published row (live or removed) as Hamilton's source check does (`traceLiveFee`):
 *   `checkFeeAgainstSource` on the whole text, a tiered price counting as traced;
 * - any other row as Darwin's verify does (`statedInOwnSource`, `sourceLineFor`): the same check on
 *   the text narrowed to the row's own product block for an ancillary-product read.
 * Every other option is left at its production default. Pure.
 *
 * Rows fold into fee lines (`cap-lines.ts`: institution, page, category, Hamilton's name and amount),
 * and each line that newly traces is a gain, already live at its price, or a live price change. A
 * live cap that newly traces is also judged by Darwin's verified recheck on the line it would then
 * read (`cap-recheck.ts`).
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
  documentUrl: string | null;
  documentCrawledAt: string | Date | null;
  documentStream: string | null;
  change: CapChange;
  /** Why the check fails with the switch off (or on, for a row that stops tracing). */
  failure: string | null;
  /** The line the row traces to with the switch on, or off for a row that stops tracing. */
  line: string | null;
  /** A live row that newly traces: Darwin's verified recheck today and with the switch on. */
  recheck?: { today: CapRecheck; switchOn: CapRecheck };
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

interface Trace {
  ok: boolean;
  line: string | null;
  reason: string | null;
}

/** The row checked as the code that decides it checks it (see the module note). */
function traceRow(row: DailyCapRow, identity: CapIdentity, text: string, dailyCapLines: boolean): Trace {
  const whole = checkFeeAgainstSource(text, identity.name, identity.amount, ".", identity.category, { dailyCapLines });
  const wholeOk = whole.ok || whole.reason === "tiered_fee";
  if (identity.tier === "live" || identity.tier === "removed") {
    return { ok: wholeOk, line: whole.ok ? whole.sourceLine : null, reason: whole.ok ? null : whole.reason };
  }
  const darwinRow = {
    fee_name: identity.name,
    amount: identity.amount,
    source_document_id: Number(row.source_document_id),
    amount_kind: null,
    rate_percent: null,
    product_name: row.product_name,
    outlier_flags: row.outlier_flags,
  };
  const texts = new Map([[Number(row.source_document_id), text]]);
  const ok = statedInOwnSource(darwinRow, texts, identity.category, { dailyCapLines });
  const reason = ok ? null : whole.ok ? "outside_own_product_block" : whole.reason;
  return { ok, line: ok ? sourceLineFor(darwinRow, texts, identity.category, { dailyCapLines }) : null, reason };
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
    documentUrl: row.document_url,
    documentCrawledAt: row.document_crawled_at,
    documentStream: row.document_stream,
  };
  if (!text || row.source_document_id == null) return { ...base, change: "no_text", failure: null, line: null };
  const off = traceRow(row, identity, text, false);
  const on = traceRow(row, identity, text, true);
  if (!off.ok && on.ok) {
    const recheck = identity.tier === "live" ? { today: capRecheck(row, text, false), switchOn: capRecheck(row, text, true) } : undefined;
    return { ...base, change: "now_traces", failure: off.reason, line: on.line, ...(recheck ? { recheck } : {}) };
  }
  if (off.ok && !on.ok) return { ...base, change: "stops_tracing", failure: on.reason, line: off.line };
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
  /** Rows not live today that go from not-ok to ok. */
  nowTraces: number;
  /** Live rows that go from not-ok to ok: already published, so no gain (the switch keeps them). */
  liveNowTraces: number;
  /**
   * How Darwin's verified recheck would judge those live rows on their switch-on line. `takedown` counts
   * only rows it keeps today and fails with the switch on (caused by the switch); `alreadyFailing` rows
   * fail today on Knox's excerpt, so the switch does not cause their takedown.
   */
  liveRecheck: { kept: number; takedown: number; alreadyFailing: number; byReason: Record<string, number> };
  /** Those live rows, capped, each with its recheck today and with the switch on. */
  liveNowTracesSamples: CapVerdict[];
  stopsTracing: number;
  noText: number;
  /** Distinct fee lines with a row that goes from not-ok to ok, whatever its tier. */
  nowTracesLines: number;
  /** Of those, lines with nothing of that name live on the page: what the switch could add. */
  gainLines: number;
  /**
   * Of the gains, lines whose furthest row is verified but unpublished: Darwin's judgement only, since
   * Hamilton's publish gate is not replayed for them.
   */
  gainLinesPublishGateNotReplayed: number;
  /** Of those, lines already live at the same price through another row. */
  alreadyLiveSamePriceLines: number;
  /** Of those, lines whose page has the same-named cap live at another price: the live price would change. */
  priceChangeLines: number;
  /** The price changes by Hamilton's `decidePriorFee` outcome (supersede, additional_line, ...). */
  priceChangeByDecision: Record<string, number>;
  /** One row per gained line (its furthest tier), capped. */
  gainSamples: CapVerdict[];
  /** One per price change, capped: the new price, the live price(s) and the decision. */
  priceChangeSamples: CapPriceChange[];
  /** Rows that go from ok to not-ok, capped: a live one would come down with the switch on. */
  stopsTracingSamples: CapVerdict[];
}

export type { CapLines } from "./cap-lines";

export function emptyDailyCapSummary(): DailyCapSummary {
  const byTier = Object.fromEntries(CAP_TIERS.map((tier) => [tier, { rows: 0, noText: 0, nowTraces: 0, stopsTracing: 0 }])) as Record<CapTier, CapTierCounts>;
  return {
    byTier, rows: 0, nowTraces: 0, liveNowTraces: 0, liveRecheck: { kept: 0, takedown: 0, alreadyFailing: 0, byReason: {} },
    liveNowTracesSamples: [], stopsTracing: 0, noText: 0, nowTracesLines: 0, gainLines: 0, gainLinesPublishGateNotReplayed: 0,
    alreadyLiveSamePriceLines: 0, priceChangeLines: 0, priceChangeByDecision: {}, gainSamples: [], priceChangeSamples: [], stopsTracingSamples: [],
  };
}

const TIER_RANK: Record<CapTier, number> = { live: 0, removed: 1, verified_unpublished: 2, held: 3, rejected: 4, unjudged: 5 };

function addLiveRecheck(summary: DailyCapSummary, verdict: CapVerdict, sampleCap: number): void {
  summary.liveNowTraces += 1;
  const { today, switchOn } = verdict.recheck ?? {};
  if (today?.outcome === "takedown") {
    summary.liveRecheck.alreadyFailing += 1;
  } else if (switchOn?.outcome === "takedown") {
    summary.liveRecheck.takedown += 1;
    const reason = switchOn.reason ?? "unknown";
    summary.liveRecheck.byReason[reason] = (summary.liveRecheck.byReason[reason] ?? 0) + 1;
  } else {
    summary.liveRecheck.kept += 1;
  }
  if (summary.liveNowTracesSamples.length < sampleCap) summary.liveNowTracesSamples.push(verdict);
}

/** Adds verdicts to a running summary (the runner reads documents in chunks). Pass one `lines` map throughout. */
export function addDailyCapVerdicts(summary: DailyCapSummary, verdicts: readonly CapVerdict[], sampleCap: number, lines: CapLines): DailyCapSummary {
  for (const verdict of verdicts) {
    const tier = summary.byTier[verdict.tier];
    tier.rows += 1;
    summary.rows += 1;
    const key = capLineKey(verdict);
    const line = lines.get(key) ?? { live: null, gained: null };
    if (verdict.tier === "live" && !line.live) line.live = verdict;
    if (verdict.change === "no_text") {
      tier.noText += 1;
      summary.noText += 1;
    } else if (verdict.change === "now_traces") {
      tier.nowTraces += 1;
      if (verdict.tier === "live") addLiveRecheck(summary, verdict, sampleCap);
      else summary.nowTraces += 1;
      if (!line.gained || TIER_RANK[verdict.tier] < TIER_RANK[line.gained.tier]) line.gained = verdict;
    } else if (verdict.change === "stops_tracing") {
      tier.stopsTracing += 1;
      summary.stopsTracing += 1;
      if (summary.stopsTracingSamples.length < sampleCap) summary.stopsTracingSamples.push(verdict);
    }
    lines.set(key, line);
  }
  return summary;
}

/** Counts the lines once every chunk is in (a line's copies can sit in different chunks). */
export function finishDailyCapSummary(summary: DailyCapSummary, lines: CapLines, sampleCap: number): DailyCapSummary {
  const counts = classifyCapLines(lines);
  const byDecision: Record<string, number> = {};
  for (const change of counts.priceChanges) byDecision[change.decision] = (byDecision[change.decision] ?? 0) + 1;
  return {
    ...summary,
    nowTracesLines: counts.nowTracesLines,
    gainLines: counts.gains.length,
    gainLinesPublishGateNotReplayed: counts.gains.filter((verdict) => verdict.tier === "verified_unpublished").length,
    alreadyLiveSamePriceLines: counts.alreadyLiveSamePriceLines,
    priceChangeLines: counts.priceChanges.length,
    priceChangeByDecision: byDecision,
    gainSamples: counts.gains.slice(0, sampleCap),
    priceChangeSamples: counts.priceChanges.slice(0, sampleCap),
  };
}

/** Judges rows against their documents' texts (keyed by document id). */
export function judgeDailyCaps(rows: readonly DailyCapRow[], texts: ReadonlyMap<number, string>): CapVerdict[] {
  return rows
    .map((row) => judgeDailyCap(row, row.source_document_id == null ? null : texts.get(Number(row.source_document_id))))
    .filter((verdict): verdict is CapVerdict => verdict != null);
}
