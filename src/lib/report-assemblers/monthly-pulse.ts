/**
 * Monthly Pulse Report — Data Assembler
 *
 * Reports fee changes at the same banks: a fee whose published price changed between
 * two versions of that bank's own schedule. It never compares national medians month to
 * month. While coverage grows (most live banks were added in the last month), a moving
 * median mostly reflects which banks were added, not a price anyone changed.
 *
 * A change from fee_change_records is reported only when the bank's newest schedule
 * states the new price and no longer states the old one for that fee
 * (`checkFeeAgainstSource`, the shared accuracy check). A page that lists both prices
 * (two accounts, two channels) is not a price change.
 */

import { createHash } from "crypto";
import { getSql } from "@/lib/data-store/connection";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { sameSchedule } from "@/lib/agents/hamilton/schedule-edition";
import type { DataManifest } from "@/lib/report-engine/types";

export const PULSE_WINDOW_DAYS = 30;

// ─── Exported Types ────────────────────────────────────────────────────────────

export interface PulseChange {
  institution_name: string;
  state_code: string | null;
  charter_type: string | null;
  fee_category: string;
  display_name: string;
  fee_name: string;
  old_amount: number;
  new_amount: number;
  direction: "up" | "down";
  changed_at: string; // ISO date
  schedule_url: string | null;
}

export interface PulseCoverage {
  institutions_live: number;
  institutions_added_in_window: number;
  live_fees: number;
}

export interface MonthlyPulsePayload {
  report_date: string;   // ISO date string
  period_label: string;  // e.g. "October 2026"
  window_start: string;  // ISO date, PULSE_WINDOW_DAYS before report_date
  changes: PulseChange[];
  /** Recorded changes left out because the newest schedule does not bear them out. */
  changes_not_confirmed: number;
  coverage: PulseCoverage;
  manifest: DataManifest;
}

export interface RecordedChangeRow {
  institution_name: string;
  state_code: string | null;
  charter_type: string | null;
  fee_key: string;
  fee_name: string | null;
  /** Name on the superseded live row at the old price. */
  old_fee_name: string | null;
  old_amount: number | string | null;
  new_amount: number | string | null;
  changed_at: string | Date;
  source_url: string | null;
  /** Page the superseded old-price row was read from. */
  old_source_url?: string | null;
  new_document_text: string | null;
  /** Text of the schedule the old price was read from. */
  old_document_text: string | null;
}

// ─── Pure rule ────────────────────────────────────────────────────────────────

function sameFeeName(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * Every dollar amount a schedule states, counted ("$5.00" and "$5" stay distinct, as
 * printed). Two texts with the same counts are two readings of one edition: a real price
 * change removes the old price or adds the new one somewhere in the text.
 */
export function statedAmounts(text: string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of (text ?? "").matchAll(/\$\s?\d[\d,]*(?:\.\d+)?/g)) {
    const key = m[0].replace(/[\s,]/g, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function sameEdition(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = statedAmounts(a);
  const y = statedAmounts(b);
  if (x.size === 0 || x.size !== y.size) return false;
  for (const [k, n] of x) if (y.get(k) !== n) return false;
  return true;
}

/**
 * Pure: did the bank change this fee? Yes only when the old and new prices sit on the
 * same fee line (same schedule, same name), the earlier schedule states the old price, and the newest
 * schedule states the new price and no longer states the old one for that fee.
 * Two readings of the same edition (both texts state exactly the same dollar amounts) are
 * not a change: a PDF read twice can pair a fee with a neighbouring column's price. Nor is
 * it a change when the earlier schedule already stated the new price for that fee.
 */
export function confirmFeeChange(row: RecordedChangeRow): PulseChange | null {
  const oldAmount = row.old_amount == null ? null : Number(row.old_amount);
  const newAmount = row.new_amount == null ? null : Number(row.new_amount);
  if (oldAmount == null || newAmount == null || !Number.isFinite(oldAmount) || !Number.isFinite(newAmount)) return null;
  if (oldAmount === newAmount || !row.fee_name || !row.new_document_text) return null;
  if (!row.old_fee_name || !sameFeeName(row.old_fee_name, row.fee_name)) return null;
  // Same schedule: a price on a different schedule (business against consumer, another
  // product's page) is a second fee line, not a change. A newer dated edition of the same
  // audience's schedule on a moved page is the same schedule (schedule-edition.ts).
  if (
    row.old_source_url &&
    row.source_url &&
    !sameSchedule({ oldUrl: row.old_source_url, newUrl: row.source_url, oldText: row.old_document_text, newText: row.new_document_text })
  )
    return null;
  const newStated = checkFeeAgainstSource(row.new_document_text, row.fee_name, newAmount, ".");
  if (!newStated.ok) return null;
  if (!checkFeeAgainstSource(row.old_document_text, row.fee_name, oldAmount, ".").ok) return null;
  if (checkFeeAgainstSource(row.old_document_text, row.fee_name, newAmount, ".").ok) return null;
  if (sameEdition(row.old_document_text, row.new_document_text)) return null;
  const oldStated = checkFeeAgainstSource(row.new_document_text, row.fee_name, oldAmount, ".");
  if (oldStated.ok || oldStated.reason === "tiered_fee") return null;
  const changedAt = row.changed_at instanceof Date ? row.changed_at.toISOString() : String(row.changed_at);
  return {
    institution_name: row.institution_name,
    state_code: row.state_code,
    charter_type: row.charter_type,
    fee_category: row.fee_key,
    display_name: getDisplayName(row.fee_key),
    fee_name: row.fee_name,
    old_amount: oldAmount,
    new_amount: newAmount,
    direction: newAmount > oldAmount ? "up" : "down",
    changed_at: changedAt.slice(0, 10),
    schedule_url: row.source_url,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const CHANGES_SQL = `
  WITH ch AS (
    SELECT c.institution_id,
           COALESCE(c.canonical_fee_key, c.fee_category) AS fee_key,
           COALESCE(c.old_amount::float8, c.previous_amount) AS old_amount,
           c.new_amount,
           COALESCE(c.changed_at, c.detected_at) AS changed_at
      FROM fee_change_records c
     WHERE COALESCE(c.changed_at, c.detected_at) >= $1
       AND c.change_type IN ('increase', 'increased', 'decrease', 'decreased')
       -- One schedule against an older copy of itself (hamilton/change-pairing.ts).
       AND c.like_for_like IS TRUE
       AND EXISTS (SELECT 1 FROM published_fee_records nl WHERE nl.fee_published_id = c.new_fee_published_id AND nl.rolled_back_at IS NULL AND NOT EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = nl.fee_published_id AND pf.kind = 'takedown_pending'))
  )
  SELECT i.institution_name, i.state_code, i.charter_type, ch.fee_key, ch.old_amount, ch.new_amount, ch.changed_at,
         n.fee_name, n.source_url, o.fee_name AS old_fee_name, o.source_url AS old_source_url,
         (SELECT t.normalized_text
            FROM agent_source_texts t
           WHERE t.source_document_id = o.source_document_id
             AND t.status = 'completed'
           ORDER BY t.id DESC
           LIMIT 1) AS old_document_text,
         (SELECT t.normalized_text
            FROM agent_source_texts t
           WHERE t.source_document_id = n.source_document_id
             AND t.status = 'completed'
           ORDER BY t.id DESC
           LIMIT 1) AS new_document_text
    FROM ch
    JOIN institution_sources i ON i.id = ch.institution_id
                              AND ($2::text IS NULL OR i.state_code = $2)
    LEFT JOIN LATERAL (
      SELECT fp.fee_name, fp.source_url, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.institution_id = ch.institution_id
         AND fp.canonical_fee_key = ch.fee_key
         AND fp.amount = ch.new_amount
         AND fp.rolled_back_at IS NULL
       ORDER BY fp.published_at DESC
       LIMIT 1
    ) n ON true
    LEFT JOIN LATERAL (
      SELECT fp.fee_name, fp.source_url, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.institution_id = ch.institution_id
         AND fp.canonical_fee_key = ch.fee_key
         AND fp.amount = ch.old_amount
         AND fp.rolled_back_reason LIKE 'superseded%'
       ORDER BY fp.rolled_back_at DESC NULLS LAST
       LIMIT 1
    ) o ON true
   ORDER BY ch.changed_at DESC
`;

const COVERAGE_SQL = `
  WITH f AS (
    SELECT institution_id, MIN(created_at) AS first_at, COUNT(*) AS fees
      FROM published_fee_catalog
     WHERE review_status = 'approved'
     GROUP BY institution_id
  )
  SELECT COUNT(*)::int AS institutions_live,
         COUNT(*) FILTER (WHERE first_at >= $1)::int AS institutions_added_in_window,
         COALESCE(SUM(fees), 0)::int AS live_fees
    FROM f
`;

// ─── Assembler ────────────────────────────────────────────────────────────────

/**
 * Recorded price changes since `windowStartIso` (in one state when `stateCode` is given),
 * and the ones each bank's schedules bear out.
 */
export async function loadConfirmedFeeChanges(
  windowStartIso: string,
  stateCode: string | null = null,
): Promise<{ changes: PulseChange[]; recorded: number }> {
  const sql = getSql();
  const recorded = (await sql.unsafe(CHANGES_SQL, [windowStartIso, stateCode])) as unknown as RecordedChangeRow[];
  const changes = recorded.map(confirmFeeChange).filter((c): c is PulseChange => c !== null);
  return { changes, recorded: recorded.length };
}

export async function assembleMonthlyPulse(now = new Date()): Promise<MonthlyPulsePayload> {
  const sql = getSql();
  const executedAt = now.toISOString();
  const windowStart = new Date(now.getTime() - PULSE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const recorded = (await sql.unsafe(CHANGES_SQL, [windowStart, null])) as unknown as RecordedChangeRow[];
  const coverageRows = (await sql.unsafe(COVERAGE_SQL, [windowStart])) as unknown as PulseCoverage[];

  const changes = recorded
    .map(confirmFeeChange)
    .filter((c): c is PulseChange => c !== null);
  const coverage: PulseCoverage = {
    institutions_live: Number(coverageRows[0]?.institutions_live ?? 0),
    institutions_added_in_window: Number(coverageRows[0]?.institutions_added_in_window ?? 0),
    live_fees: Number(coverageRows[0]?.live_fees ?? 0),
  };

  const manifest: DataManifest = {
    queries: [
      { sql: CHANGES_SQL.trim(), row_count: recorded.length, executed_at: executedAt },
      { sql: COVERAGE_SQL.trim(), row_count: coverageRows.length, executed_at: executedAt },
    ],
    data_hash: createHash("sha256").update(JSON.stringify({ changes, coverage })).digest("hex"),
    pipeline_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  };

  return {
    report_date: executedAt.split("T")[0],
    period_label: now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    window_start: windowStart.split("T")[0],
    changes,
    changes_not_confirmed: recorded.length - changes.length,
    coverage,
    manifest,
  };
}
