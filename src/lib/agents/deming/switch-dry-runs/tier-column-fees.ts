import { findTierColumnFees, type TierColumnMatch, type TierColumnRow } from "@/lib/agents/darwin/tier-column-check";
import { tierTableRows } from "@/lib/tier-column-table";
import { bounded, type Bounded, type SwitchAuditOptions, type SwitchAuditReader } from "./types";

/**
 * `TIER_COLUMN_FEES_LIVE` and `TIER_COLUMN_TAKEDOWN_LIVE` (#1092, Knox v185; DECISIONS 2026-11-04):
 * the live fees of documents whose stored text has a relationship-tier table, judged by Darwin's
 * re-check function (`findTierColumnFees`). Unscoped fees (a tier row's name with no tier, on a row
 * whose tiers charge differently) are what the takedown switch archives; allowance names are counted,
 * report only. Also counts the tier tables and rows the per-tier read would change on a re-read. Pure
 * apart from the reader.
 */

export interface TierColumnFeesSummary {
  /** Live fees of documents whose text has a tier header line. */
  checked: number;
  /** Stored texts among them with a tier table of three rows or more. */
  tierTexts: number;
  /** Rows of those tables whose tiers do not all charge the same: the rows Knox v185 reads one fee per tier. */
  perTierRows: number;
  onTierRows: number;
  wouldTakeDown: number;
  allowanceNames: number;
  institutions: number;
  samples: TierColumnMatch[];
}

export interface TierColumnFeesSection {
  switch: "TIER_COLUMN_TAKEDOWN_LIVE";
  readSwitch: "TIER_COLUMN_FEES_LIVE";
  issue: number;
  rowsRead: Bounded;
  summary: TierColumnFeesSummary;
}

export function summarizeTierColumnFees(rows: readonly TierColumnRow[], sampleCap: number): TierColumnFeesSummary {
  const { matches, checked, onTierRows, byKind, institutions } = findTierColumnFees([...rows]);
  const texts = new Set(rows.map((row) => row.text).filter((text): text is string => !!text));
  let tierTexts = 0;
  let perTierRows = 0;
  for (const text of texts) {
    const tierRows = tierTableRows(text);
    if (tierRows.length > 0) tierTexts += 1;
    perTierRows += tierRows.filter((row) => new Set(row.cells.map((cell) => JSON.stringify(cell))).size > 1).length;
  }
  return {
    checked,
    tierTexts,
    perTierRows,
    onTierRows,
    wouldTakeDown: byKind.unscoped,
    allowanceNames: byKind.allowance_name,
    institutions,
    samples: matches.slice(0, sampleCap),
  };
}

export async function tierColumnFeesSection(reader: SwitchAuditReader, options: SwitchAuditOptions): Promise<TierColumnFeesSection> {
  const rows = await reader.tierColumnRows(options.rowCap);
  return {
    switch: "TIER_COLUMN_TAKEDOWN_LIVE",
    readSwitch: "TIER_COLUMN_FEES_LIVE",
    issue: 1092,
    rowsRead: bounded(rows.length, options.rowCap),
    summary: summarizeTierColumnFees(rows, options.sampleCap),
  };
}
