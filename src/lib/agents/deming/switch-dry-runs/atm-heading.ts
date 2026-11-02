import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { refileCategory } from "@/lib/fee-category-guard";
import { foldContext } from "@/lib/fee-fold";
import { withFootnotedAtmHeading } from "@/lib/fee-fold-atm-heading";
import type { AtmHeadingRow } from "./types";

/**
 * `FOOTNOTED_ATM_HEADING_LIVE` (#1092): what the fold's marked ATM heading read re-files. Every balance
 * inquiry (Knox's hint, or Darwin's verified or Hamilton's published category) is re-filed against its
 * own document's newest stored text twice, switch off and on, as Darwin's verify, Hamilton's rules
 * re-check and Hamilton's fold step file it (`refileCategory` with the fee's schedule section,
 * `foldContext`). A row whose filing changes is counted by where it stands today:
 * - `live`: a published fee. One live as atm_non_network that the switch files as balance_inquiry (no
 *   home) is no longer read by Hamilton's rules re-check, so it would come down after its second look;
 *   one live under balance_inquiry that the switch files as atm_non_network would be re-filed by the
 *   fold step.
 * - `verified`: verified, not published. One the switch places under atm_non_network is re-filed by
 *   Hamilton's fold step (when the guard and Darwin's amount checks accept it) and then publishes.
 * - `raw`: Knox's read only (Darwin held or refused it, `retired_category`). The switch changes what a
 *   re-read files; nothing moves until Knox reads the document again.
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
  /** Live fees the switch takes out of atm_non_network (Hamilton's rules re-check would take them down). */
  liveWouldLeave: number;
  /** Live and verified fees the switch re-files into atm_non_network that the guard and amount checks accept. */
  wouldRefileIn: number;
  liveWouldRefileIn: number;
  samples: AtmHeadingChange[];
}

export function emptyAtmHeadingSummary(): AtmHeadingSummary {
  return { rows: 0, noText: 0, notFound: 0, changed: 0, byChange: {}, liveWouldLeave: 0, wouldRefileIn: 0, liveWouldRefileIn: 0, samples: [] };
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
  const context = foldContext(text, name, amount);
  if (context == null) return "not_found";
  const filed = (on: boolean) => withFootnotedAtmHeading(on, () => refileCategory("balance_inquiry", name, context) ?? "balance_inquiry");
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
    if (verdict.tier === "live" && verdict.today === "atm_non_network" && verdict.on !== "atm_non_network") summary.liveWouldLeave += 1;
    if (verdict.tier !== "raw" && verdict.on === "atm_non_network" && verdict.today !== "atm_non_network" && verdict.accepted) {
      summary.wouldRefileIn += 1;
      if (verdict.tier === "live") summary.liveWouldRefileIn += 1;
    }
    if (summary.samples.length < sampleCap) summary.samples.push(verdict);
  }
}
