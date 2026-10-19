import { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * Registry links a person checked by hand (#2022). Natbank, National Association (2675) is a
 * Florida bank owned by National Bank of Canada; the registry pointed its website at nbc.ca and
 * its fee link at the parent's Canadian business accounts page, so Knox read Canadian packages
 * (Interac e-Transfers, Canadian dollars) as Natbank's fees. Its own U.S. pages live under
 * nbc.ca/en/natbank: the accounts page prints NatCheck Unlimited ($5), NatMoney Market ($10) and
 * NatSavings ($5) with their footnoted fees, and links no separate schedule (checked Oct 19).
 *
 * A step beside Atlas's city repair, in the daily scoreboard run. Each entry writes only while the
 * fee link is still the listed old one, so a second run, or a later fix by anyone, changes nothing:
 * the website and fee link become the bank's own pages, the profile's canonical link follows
 * (unless a correction locked it), the bank's own pages leave the profile's set-aside list and the
 * Canadian pages join it, so discovery never brings them back. Every change goes in the step's
 * ledger detail. A dry run lists them and changes nothing. Add later checks below, never edit a
 * past one.
 *
 * On by James's decision (Oct 19, 2026, "Do all three" on #2022).
 */
export const HAND_LINK_REPAIR_LIVE = true;
export const HAND_LINK_REJECT_REASON = "hand_link_repair";

export interface HandLinkRepair {
  institutionId: number;
  /** The fee link the entry replaces; nothing is written once the link is anything else. */
  oldFeeUrl: string;
  websiteUrl: string;
  feeUrl: string;
  /** Pages that are not this institution's schedule: set aside so discovery does not choose them again. */
  rejectUrls: readonly string[];
  why: string;
}

export const HAND_LINK_REPAIRS: readonly HandLinkRepair[] = [
  {
    institutionId: 2675,
    oldFeeUrl: "https://www.nbc.ca/business/accounts.html",
    websiteUrl: "https://www.nbc.ca/en/natbank/personal.html",
    feeUrl: "https://www.nbc.ca/en/natbank/personal/accounts.html",
    rejectUrls: [
      "https://www.nbc.ca/business/accounts.html",
      "https://www.nbc.ca/en/business/accounts.html",
      "https://www.nbc.ca/personal/accounts/chequing.html",
      "https://www.nbc.ca/content/dam/shared/pdf/personal/17692-fee-guide-pbs.pdf",
    ],
    why: "Natbank (#2022): National Bank of Canada's Canadian pages replaced by Natbank's own U.S. accounts page (doc 33328)",
  },
];

export interface HandLinkChange {
  institutionId: number;
  fromFeeUrl: string;
  toFeeUrl: string;
  toWebsiteUrl: string;
  why: string;
}

export interface HandLinkRepairResult {
  live: boolean;
  dryRun: boolean;
  /** Entries whose fee link is still the old one. */
  candidates: HandLinkChange[];
  repaired: HandLinkChange[];
}

const change = (entry: HandLinkRepair): HandLinkChange => ({
  institutionId: entry.institutionId, fromFeeUrl: entry.oldFeeUrl, toFeeUrl: entry.feeUrl, toWebsiteUrl: entry.websiteUrl, why: entry.why,
});

export async function runHandLinkRepair(
  options: { db?: SqlTag; dryRun?: boolean; live?: boolean; list?: readonly HandLinkRepair[]; now?: Date } = {},
): Promise<HandLinkRepairResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const live = options.live ?? HAND_LINK_REPAIR_LIVE;
  const list = options.list ?? HAND_LINK_REPAIRS;
  const result: HandLinkRepairResult = { live, dryRun, candidates: [], repaired: [] };
  if (list.length === 0) return result;

  const rows = await db<{ id: number | string }[]>`
    SELECT id FROM institution_sources
     WHERE id = ANY(${list.map((entry) => entry.institutionId)}::bigint[])
       AND btrim(COALESCE(fee_schedule_url, '')) = ANY(${list.map((entry) => entry.oldFeeUrl)}::text[])
  `;
  const still = new Set(rows.map((row) => Number(row.id)));
  const due = list.filter((entry) => still.has(entry.institutionId));
  result.candidates = due.map(change);
  if (!live || dryRun) return result;

  const at = (options.now ?? new Date()).toISOString();
  for (const entry of due) {
    const written = await db<{ id: number | string }[]>`
      UPDATE institution_sources
         SET website_url = ${entry.websiteUrl},
             fee_schedule_url = ${entry.feeUrl},
             document_type = 'html'
       WHERE id = ${entry.institutionId}
         AND btrim(COALESCE(fee_schedule_url, '')) = ${entry.oldFeeUrl}
      RETURNING id
    `;
    if (written.length === 0) continue;
    const added = entry.rejectUrls.map((url) => ({ url, reason: `${HAND_LINK_REJECT_REASON}: ${entry.why}`, at }));
    const own = [entry.feeUrl, entry.websiteUrl, ...entry.rejectUrls];
    await db`
      UPDATE institution_source_profiles
         SET rejected_source_urls = (
               SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
                 FROM (
                   SELECT item FROM jsonb_array_elements(
                            CASE WHEN jsonb_typeof(rejected_source_urls) = 'array' THEN rejected_source_urls ELSE '[]'::jsonb END) item
                    WHERE NOT COALESCE(item->>'url' = ANY(${own}::text[]), FALSE)
                   UNION ALL
                   SELECT item FROM jsonb_array_elements(${JSON.stringify(added)}::jsonb) item
                 ) kept
             ),
             canonical_source_url = CASE WHEN locked_by_correction IS TRUE THEN canonical_source_url ELSE ${entry.feeUrl} END,
             updated_at = NOW()
       WHERE institution_id = ${entry.institutionId}
    `;
    result.repaired.push(change(entry));
  }
  return result;
}

export function handLinkRepairDetail(result: HandLinkRepairResult): Record<string, unknown> {
  const list = (changes: HandLinkChange[]) => changes.map((c) => ({
    id: c.institutionId, from_fee_url: c.fromFeeUrl, to_fee_url: c.toFeeUrl, to_website_url: c.toWebsiteUrl, why: c.why,
  }));
  return {
    live: result.live,
    dry_run: result.dryRun,
    candidates: result.candidates.length,
    repaired: result.repaired.length,
    changes: list(result.repaired.length > 0 ? result.repaired : result.candidates),
  };
}

export function summarizeHandLinkRepair(result: HandLinkRepairResult): string {
  const n = result.candidates.length;
  if (n === 0) return "No hand-checked registry link was due.";
  if (result.repaired.length > 0) return `Atlas pointed ${result.repaired.length} of ${n} institution(s) at their own fee pages, as checked by hand.`;
  return `Atlas found ${n} hand-checked registry link(s) due and changed none (${result.dryRun ? "dry run" : "switched off"}).`;
}
