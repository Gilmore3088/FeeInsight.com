import { verifiedRow } from "@/lib/agents/deming/shadow-lab/rows";
import { feePageKey } from "@/lib/agents/hamilton/page-key";
import { decidePriorFee, normalizedFeeName, type PriorFeeDecision, type PriorPublishedFeeRow } from "@/lib/agents/hamilton/publish";
import type { CapVerdict } from "./daily-cap";

/**
 * Daily cap fee lines (#2768 dry run). A line is one institution, page (`feePageKey`, else the
 * document), category, Hamilton's `normalizedFeeName` and amount, so Knox's re-reads and a newer copy
 * of the page fold into one line at one price, and two caps on one page under one name at two prices
 * stay two lines. A line that newly traces is then one of:
 * - already live at the same price on its page (the switch only keeps it);
 * - a live price change: the page's same-named cap is live at another price and Hamilton's
 *   `decidePriorFee` would supersede it or publish the new price beside it;
 * - beside a live price elsewhere: the only same-named live cap sits on another page of the
 *   institution, and `decidePriorFee` would publish the new price beside it (the dash-list section's
 *   "beside" reading: `additional_line` or `new`, another price);
 * - live price stays: a same-named cap is live and `decidePriorFee` keeps it as it is
 *   (`older_document`, `identical`), so nothing published changes;
 * - a gain: nothing of that name is live at the institution.
 * Pure.
 */

const pageOf = (verdict: CapVerdict): string => feePageKey(verdict.documentUrl) ?? `doc:${verdict.sourceDocumentId}`;

/** The institution, category and name, without page or amount. */
const nameKey = (verdict: CapVerdict): string => [verdict.institutionId, verdict.category, normalizedFeeName(verdict.name)].join("|");

/** The page and name, without the amount: where Hamilton's supersede looks for the same line. */
export const capPageNameKey = (verdict: CapVerdict): string => `${nameKey(verdict)}|${pageOf(verdict)}`;

export const capLineKey = (verdict: CapVerdict): string => `${capPageNameKey(verdict)}|${verdict.amount}`;

/** The lines seen so far, carried across chunks so a line counts once. */
export type CapLines = Map<string, { live: CapVerdict | null; gained: CapVerdict | null }>;

export interface CapPriceChange {
  /** The row that newly traces, at its furthest tier. */
  verdict: CapVerdict;
  /** The institution's live caps of the same name it is decided against. */
  live: Array<{ feePublishedId: number | null; amount: number; sourceDocumentId: number | null }>;
  /** What Hamilton's prior-fee decision would do with the new price. */
  decision: PriorFeeDecision["kind"];
}

export interface CapLineCounts {
  nowTracesLines: number;
  gains: CapVerdict[];
  alreadyLiveSamePriceLines: number;
  /** Same page, another live price, and Hamilton would supersede it or publish beside it. */
  priceChanges: CapPriceChange[];
  /** Another page's same-named live cap at another price, and Hamilton would publish beside it. */
  besideElsewhere: CapPriceChange[];
  /** A same-named cap is live and Hamilton keeps it unchanged (an older copy, an identical price). */
  livePriceStays: CapPriceChange[];
}

/** Outcomes that change what is published on the page: the live price replaced, or a second price beside it. */
const CHANGES_PAGE: ReadonlySet<PriorFeeDecision["kind"]> = new Set(["supersede", "additional_line"]);
/** Outcomes that publish the new price next to a live one: the dash-list section's "beside". */
const PUBLISHES_BESIDE: ReadonlySet<PriorFeeDecision["kind"]> = new Set(["additional_line", "new"]);

function priorRow(live: CapVerdict): PriorPublishedFeeRow {
  return {
    fee_published_id: live.feePublishedId ?? 0,
    amount: live.amount.toFixed(2),
    fee_name: live.name,
    published_at: live.documentCrawledAt ?? new Date(0).toISOString(),
    source_url: live.documentUrl,
    source_document_id: live.sourceDocumentId,
    document_crawled_at: live.documentCrawledAt,
    document_stream: live.documentStream,
    document_url: live.documentUrl,
  };
}

/** Hamilton's decision for the new price against the institution's live caps of that name. */
export function capPriceDecision(verdict: CapVerdict, live: readonly CapVerdict[]): PriorFeeDecision["kind"] {
  const row = verifiedRow(
    { canonical_fee_key: verdict.category, fee_name: verdict.name, amount: verdict.amount.toFixed(2), source_document_id: verdict.sourceDocumentId ?? 0 },
    {
      institution_id: verdict.institutionId,
      source_url: verdict.documentUrl,
      document_url: verdict.documentUrl,
      document_crawled_at: verdict.documentCrawledAt,
      document_stream: verdict.documentStream,
    },
  );
  return decidePriorFee(row, live.map(priorRow)).kind;
}

const change = (verdict: CapVerdict, live: readonly CapVerdict[], decision: PriorFeeDecision["kind"]): CapPriceChange => ({
  verdict,
  live: live.map((fee) => ({ feePublishedId: fee.feePublishedId, amount: fee.amount, sourceDocumentId: fee.sourceDocumentId })),
  decision,
});

/** Sorts every line that newly traces into the outcomes the module note lists. */
export function classifyCapLines(lines: CapLines): CapLineCounts {
  const liveByName = new Map<string, CapVerdict[]>();
  for (const line of lines.values()) {
    if (line.live) liveByName.set(nameKey(line.live), [...(liveByName.get(nameKey(line.live)) ?? []), line.live]);
  }
  const counts: CapLineCounts = { nowTracesLines: 0, gains: [], alreadyLiveSamePriceLines: 0, priceChanges: [], besideElsewhere: [], livePriceStays: [] };
  for (const line of lines.values()) {
    const gained = line.gained;
    if (!gained) continue;
    counts.nowTracesLines += 1;
    if (line.live) {
      counts.alreadyLiveSamePriceLines += 1;
      continue;
    }
    const named = liveByName.get(nameKey(gained)) ?? [];
    if (named.length === 0) {
      counts.gains.push(gained);
      continue;
    }
    const page = pageOf(gained);
    const samePage = named.filter((live) => pageOf(live) === page);
    const decision = capPriceDecision(gained, named);
    if (samePage.length > 0 && CHANGES_PAGE.has(decision)) counts.priceChanges.push(change(gained, samePage, decision));
    else if (samePage.length === 0 && PUBLISHES_BESIDE.has(decision) && named.some((live) => live.amount !== gained.amount)) {
      counts.besideElsewhere.push(change(gained, named, decision));
    } else counts.livePriceStays.push(change(gained, named, decision));
  }
  const byRaw = (a: CapVerdict, b: CapVerdict) => a.feeRawId - b.feeRawId;
  counts.gains.sort(byRaw);
  for (const list of [counts.priceChanges, counts.besideElsewhere, counts.livePriceStays]) list.sort((a, b) => byRaw(a.verdict, b.verdict));
  return counts;
}
