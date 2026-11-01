import { verifiedRow } from "@/lib/agents/deming/shadow-lab/rows";
import { feePageKey } from "@/lib/agents/hamilton/page-key";
import { decidePriorFee, normalizedFeeName, type PriorFeeDecision, type PriorPublishedFeeRow } from "@/lib/agents/hamilton/publish";
import type { CapVerdict } from "./daily-cap";

/**
 * Daily cap fee lines (#2768 dry run). A line is one institution, page (`feePageKey`, else the
 * document), category, Hamilton's `normalizedFeeName` and amount, so Knox's re-reads and a newer copy
 * of the page fold into one line at one price, and two caps on one page under one name at two prices
 * stay two lines. A line that newly traces is then one of:
 * - already live at the same price (the switch only keeps it);
 * - a live price change: the page's same-named cap is live at another price, so Hamilton's
 *   `decidePriorFee` would supersede it or publish the new price beside it (counted and sampled);
 * - a gain: nothing of that name is live on the page.
 * Pure.
 */

/** The page and name, without the amount: where Hamilton's supersede looks for the same line. */
export const capPageNameKey = (verdict: CapVerdict): string =>
  [
    verdict.institutionId,
    feePageKey(verdict.documentUrl) ?? `doc:${verdict.sourceDocumentId}`,
    verdict.category,
    normalizedFeeName(verdict.name),
  ].join("|");

export const capLineKey = (verdict: CapVerdict): string => `${capPageNameKey(verdict)}|${verdict.amount}`;

/** The lines seen so far, carried across chunks so a line counts once. */
export type CapLines = Map<string, { live: CapVerdict | null; gained: CapVerdict | null }>;

export interface CapPriceChange {
  /** The row that newly traces, at its furthest tier. */
  verdict: CapVerdict;
  /** The page's live caps of the same name, at other prices. */
  live: Array<{ feePublishedId: number | null; amount: number; sourceDocumentId: number | null }>;
  /** What Hamilton's prior-fee decision would do with the new price. */
  decision: PriorFeeDecision["kind"];
}

export interface CapLineCounts {
  nowTracesLines: number;
  gains: CapVerdict[];
  alreadyLiveSamePriceLines: number;
  priceChanges: CapPriceChange[];
}

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

/** Hamilton's decision for the new price against the page's live caps of that name. */
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

/** Sorts every line that newly traces into gains, same-price live lines and live price changes. */
export function classifyCapLines(lines: CapLines): CapLineCounts {
  const liveByPage = new Map<string, CapVerdict[]>();
  for (const line of lines.values()) {
    if (line.live) liveByPage.set(capPageNameKey(line.live), [...(liveByPage.get(capPageNameKey(line.live)) ?? []), line.live]);
  }
  const counts: CapLineCounts = { nowTracesLines: 0, gains: [], alreadyLiveSamePriceLines: 0, priceChanges: [] };
  for (const line of lines.values()) {
    if (!line.gained) continue;
    counts.nowTracesLines += 1;
    if (line.live) {
      counts.alreadyLiveSamePriceLines += 1;
      continue;
    }
    const others = (liveByPage.get(capPageNameKey(line.gained)) ?? []).filter((live) => live.amount !== line.gained?.amount);
    if (others.length === 0) {
      counts.gains.push(line.gained);
      continue;
    }
    counts.priceChanges.push({
      verdict: line.gained,
      live: others.map((live) => ({ feePublishedId: live.feePublishedId, amount: live.amount, sourceDocumentId: live.sourceDocumentId })),
      decision: capPriceDecision(line.gained, others),
    });
  }
  const byRaw = (a: CapVerdict, b: CapVerdict) => a.feeRawId - b.feeRawId;
  counts.gains.sort(byRaw);
  counts.priceChanges.sort((a, b) => byRaw(a.verdict, b.verdict));
  return counts;
}
