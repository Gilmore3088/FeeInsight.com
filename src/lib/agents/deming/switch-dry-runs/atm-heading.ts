import { feeKey, reproducibleFees } from "@/lib/agents/hamilton/rules-recheck";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { refileCategory } from "@/lib/fee-category-guard";
import { foldContext } from "@/lib/fee-fold";
import { withFootnotedAtmHeading } from "@/lib/fee-fold-atm-heading";
import type { AtmHeadingRow, LiveNonNetworkFeeRow } from "./types";

/**
 * `FOOTNOTED_ATM_HEADING_LIVE` (#1092): what the fold's marked ATM heading read re-files. Every balance
 * inquiry (Knox's hint, or Darwin's verified or Hamilton's published category) is re-filed against its
 * own document's newest stored text twice, switch off and on, as Darwin's verify, Hamilton's rules
 * re-check and Hamilton's fold step file it (`refileCategory` with the fee's schedule section,
 * `foldContext`). A row whose filing changes is counted by where it stands today:
 * - `live`: a published fee. One live under balance_inquiry that the switch files as atm_non_network
 *   would be re-filed by the fold step.
 * - `verified`: verified, not published. One the switch places under atm_non_network is re-filed by
 *   Hamilton's fold step (when the guard and Darwin's amount checks accept it) and then publishes.
 * - `raw`: Knox's read only (Darwin held or refused it, `retired_category`). The switch changes what a
 *   re-read files; nothing moves until Knox reads the document again.
 *
 * The takedown count reads a wider population (review of 634ce2e): every live atm_non_network fee,
 * whatever Knox hinted. Its document's newest text is read with today's free team, switch off and on, as
 * Hamilton's rules re-check reads it (`reproducibleFees`, category and price). A fee read today and not
 * read with the switch on would come down after the re-check's second look. A fee the free team does not
 * read today is not one the switch can take down, and is counted apart.
 * Pure: the reader does the reads.
 */

export type AtmHeadingTier = "live" | "verified" | "raw";

export interface AtmHeadingChange {
  tier: AtmHeadingTier;
  feeRawId: number;
  feeVerifiedId: number | null;
  feePublishedId: number | null;
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number;
  feeName: string;
  amount: number | null;
  /** The category the row carries today (published, else verified, else Knox's hint). */
  today: string;
  off: string;
  on: string;
  /** The guard and Darwin's amount checks accept the switch-on category (the fold step moves only then). */
  accepted: boolean;
  /** The schedule text just before the line, as the fold reads it. */
  context: string;
}

export interface AtmHeadingSummary {
  rows: number;
  noText: number;
  notFound: number;
  changed: number;
  /** `<tier> <off>-><on>`. */
  byChange: Record<string, number>;
  /** Every live atm_non_network fee, re-read off and on (`replayLiveNonNetwork`). */
  liveNonNetwork: LiveNonNetworkSummary;
  /** Live and verified fees the switch re-files into atm_non_network that the guard and amount checks accept. */
  wouldRefileIn: number;
  liveWouldRefileIn: number;
  samples: AtmHeadingChange[];
}

export interface LiveNonNetworkLeave {
  feePublishedId: number;
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number;
  feeName: string;
  amount: number;
  /** What the switch-on read files at the fee's price instead (empty: no read at that price). */
  onAtPrice: string[];
}

export interface LiveNonNetworkSummary {
  fees: number;
  documents: number;
  noText: number;
  /** Not a dollar fee (a rate or no amount): the rules re-check reads dollar fees. */
  notDollar: number;
  /** Today's free team does not read it: the switch cannot take it down. */
  notReadToday: number;
  /** Read today, not read with the switch on: Hamilton's rules re-check would take it down. */
  wouldLeave: number;
  /** Read off but not on at its price, by what the switch-on read files there instead. */
  wouldLeaveByOnRead: Record<string, number>;
  samples: LiveNonNetworkLeave[];
}

export function emptyAtmHeadingSummary(): AtmHeadingSummary {
  return {
    rows: 0, noText: 0, notFound: 0, changed: 0, byChange: {}, wouldRefileIn: 0, liveWouldRefileIn: 0, samples: [],
    liveNonNetwork: { fees: 0, documents: 0, noText: 0, notDollar: 0, notReadToday: 0, wouldLeave: 0, wouldLeaveByOnRead: {}, samples: [] },
  };
}

const num = (value: number | string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function tierOf(row: AtmHeadingRow): AtmHeadingTier {
  if (row.fee_published_id != null && row.live) return "live";
  if (row.fee_verified_id != null && (row.review_status === "verified" || row.review_status === "approved")) return "verified";
  return "raw";
}

/** One row, switch off and on: the change, or null when the filing is the same (or cannot be read). */
export function judgeAtmHeadingRow(row: AtmHeadingRow, text: string | null | undefined): AtmHeadingChange | "no_text" | "not_found" | null {
  if (!text) return "no_text";
  const tier = tierOf(row);
  const name = (tier === "live" ? row.published_name : tier === "verified" ? row.verified_name : null) ?? row.raw_name ?? "";
  const amount = num(tier === "live" ? row.published_amount : tier === "verified" ? row.verified_amount : null) ?? num(row.raw_amount);
  // The section is read in each mode: with the switch on it keeps its line breaks (`foldContext`).
  const context = foldContext(text, name, amount);
  if (context == null) return "not_found";
  const filed = (on: boolean) =>
    withFootnotedAtmHeading(on, () => refileCategory("balance_inquiry", name, foldContext(text, name, amount)) ?? "balance_inquiry");
  const off = filed(false);
  const on = filed(true);
  if (off === on) return null;
  const today = (tier === "live" ? row.published_key : tier === "verified" ? row.verified_key : null) ?? "balance_inquiry";
  return {
    tier,
    feeRawId: Number(row.fee_raw_id),
    feeVerifiedId: num(row.fee_verified_id),
    feePublishedId: num(row.fee_published_id),
    institutionId: Number(row.institution_id),
    institutionName: row.institution_name,
    sourceDocumentId: Number(row.source_document_id),
    feeName: name,
    amount,
    today,
    off,
    on,
    accepted: passesDarwinChecks(on, name, amount ?? 0),
    context: context.slice(-160),
  };
}

export function addAtmHeadingRows(summary: AtmHeadingSummary, rows: readonly AtmHeadingRow[], texts: ReadonlyMap<number, string>, sampleCap: number): void {
  for (const row of rows) {
    summary.rows += 1;
    const verdict = judgeAtmHeadingRow(row, row.source_document_id == null ? null : texts.get(Number(row.source_document_id)));
    if (verdict === "no_text") summary.noText += 1;
    else if (verdict === "not_found") summary.notFound += 1;
    if (verdict == null || typeof verdict === "string") continue;
    summary.changed += 1;
    const change = `${verdict.tier} ${verdict.off}->${verdict.on}`;
    summary.byChange[change] = (summary.byChange[change] ?? 0) + 1;
    if (verdict.tier !== "raw" && verdict.on === "atm_non_network" && verdict.today !== "atm_non_network" && verdict.accepted) {
      summary.wouldRefileIn += 1;
      if (verdict.tier === "live") summary.liveWouldRefileIn += 1;
    }
    if (summary.samples.length < sampleCap) summary.samples.push(verdict);
  }
}

/** One document's live atm_non_network fees, read off and on as Hamilton's rules re-check reads them. */
export function replayLiveNonNetwork(
  summary: LiveNonNetworkSummary,
  fees: readonly LiveNonNetworkFeeRow[],
  text: string | null | undefined,
  sampleCap: number,
): void {
  summary.fees += fees.length;
  if (!text) {
    summary.noText += fees.length;
    return;
  }
  summary.documents += 1;
  const off = withFootnotedAtmHeading(false, () => reproducibleFees(text));
  const on = withFootnotedAtmHeading(true, () => reproducibleFees(text));
  for (const fee of fees) {
    const amount = num(fee.amount);
    if (amount == null || fee.amount_kind === "percent") {
      summary.notDollar += 1;
      continue;
    }
    const key = feeKey("atm_non_network", amount);
    if (!off.has(key)) {
      summary.notReadToday += 1;
      continue;
    }
    if (on.has(key)) continue;
    const cents = key.slice(key.lastIndexOf(":"));
    const onAtPrice = [...on].filter((read) => read.endsWith(cents)).map((read) => read.slice(0, read.lastIndexOf(":"))).sort();
    summary.wouldLeave += 1;
    const label = onAtPrice.join("+") || "none";
    summary.wouldLeaveByOnRead[label] = (summary.wouldLeaveByOnRead[label] ?? 0) + 1;
    if (summary.samples.length < sampleCap) {
      summary.samples.push({
        feePublishedId: Number(fee.fee_published_id),
        institutionId: Number(fee.institution_id),
        institutionName: fee.institution_name,
        sourceDocumentId: Number(fee.source_document_id),
        feeName: fee.fee_name,
        amount,
        onAtPrice,
      });
    }
  }
}
