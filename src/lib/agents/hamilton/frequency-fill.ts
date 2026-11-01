import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { printsAmount } from "@/lib/fee-evidence";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";
import {
  boxTableAnnualHeader,
  continuousOverdraftPeriodCheck,
  maintenanceMonthlyFill,
  perEventFrequency,
  perEventPeriodCheck,
  PERIOD_FEE_KEYS,
  settledFrequency,
} from "@/lib/fee-frequency";

type SqlTag = typeof sql;

/**
 * A live fee whose frequency is not the one its own schedule line states (Darwin's eval, Oct 8:
 * 48% of sampled live fees had none, and most of the wrong ones were blanks where the line says
 * "each", "per item" or "quarterly"). The line is the excerpt Knox read the fee from; the
 * fee's own row decides (`settledFrequency`), and only when it points one way.
 *
 * v2: a stated frequency read from another fee's row on the same line is corrected to what the
 * fee's own row says, or cleared when its row says nothing ("... per year .. $10.00 | Reverse
 * Stop Payment .. $20.00" gave the $20 fee "annual"; 25 of 131 stated frequencies in the
 * seven-state keys were wrong this way).
 *
 * Each change is logged to `pipeline_feedback` (check `hamilton.frequency_fill`, kind
 * `frequency_filled`, `frequency_corrected` or `frequency_cleared`, evidence `from` and `to`),
 * so it is reversed by setting the row's frequency back to `from`. The verified row gets the
 * same change when it held the same value, so a republish keeps it.
 */
export const FREQUENCY_FILL_CHECK = "hamilton.frequency_fill";
// v3: "ea.", "/page", "/transfer", "/card", "per order" and similar per-item wording.
// v4: "per loan", "per levy", "per stop payment", "/sheet", "/quarter", "per business day" and
// "one-time"; a period the line never states is cleared from a per-event fee; an allowance ("1 free
// per month") is not the fee's period (Darwin's 211-row eval, Oct 9).
// v5: "More than 2 per year" is an allowance, not the fee's period.
// v6: footnote marks ("per month6", "each2"), a cap ("up to a maximum of $5.00") and a second
// price's label ("$1.00/page Business: $3.00/page") no longer hide the fee's own words.
// v7: "each after 3 in a month" and "exceeding two per month" are allowances too.
// v8: a rate basis in the fee's own name ("Account Balancing (per hour) / $35.00 Each") clears a
// flat frequency (whole-record sample 2, Oct 9).
// v9: "each above 6/month" is an allowance, and a cell priced "N/C" is another fee's row (101933).
// v10: a box rent named by its size takes "annual" from its table's column header ("Box Size: |
// Annual Rental:" over "3 x 5 x 21 | $25", Altra 104006; 1,466 live box-size rents were blank).
// v11 (#1196): a live NSF or overdraft fee stored as monthly is checked against its own line
// (`perEventPeriodCheck`): a period read from a neighbour is corrected or cleared, a period the fee's
// own price states (an NSF fee "$23.00/Month", an account's "$25 Monthly Maintenance Fee") is held
// (taken down with reason `frequency_hold:`), and an overdraft program priced by the month keeps it.
// v12 (#1301): a live NSF fee stored as annual or daily is checked too: a period from a box-table
// header, an allowance or a neighbour is cleared, and a daily price with no daily cap is held.
// v13 (#1339): James's per-item rule (Oct 15) reaches overdraft and returned-item fees stored as
// monthly, annual, quarterly or daily (a daily cap or a waiver is not the fee's frequency); a
// continuous overdraft fee stored by the month or year takes daily when its own words say so; a
// blank monthly-maintenance fee takes monthly only when its own name or line says month.
// v14 (#1339): every value the fill writes is one its own per-event check keeps, so a v13 correction
// is not written back on the next pass; feedback dedupe keys name the version, so a later version's
// write is always logged; the excerpt is read from `extraction_note` when it is set (#1336).
// v15 (#1901): a blank fee whose stored line Knox cut before its price ("Dormant Checking fee:
// Assessed to the checking account if ... no other Navy Fede", Navy Federal 80997) is read on the
// full line of its own stored document ("... | $3.00 per quarter"), found by the cut line's opening
// (`fullStoredLine`, read in SQL so only the matching lines come back), so the period the
// schedule prints is filled and logged with basis
// `full_stored_line`.
export const FREQUENCY_FILL_VERSION = 15;
/**
 * #1360: an overdraft "program" the v11 keep leaves monthly is, in every case James and the review
 * checked on the bank's own page, an optional plan or add-on (Independent Bank's $10 Advanced
 * Overdraft, St. Louis Community's $5 Enhanced Privilege, Selco's $10 Elevate Courtesy Pay), not the
 * overdraft fee, and it sits in the overdraft benchmark beside per-item fees. James took four down on
 * Oct 15 (#1366); a new copy of a bank's page brings one back through the keep (Selco's 143753,
 * Oct 15, beside its live $25 per-item Courtesy Pay). With this switch on, a kept program fee is held
 * (taken down with `frequency_hold:`) when its bank has another live overdraft fee charged per item
 * (or with no frequency) above $0. A bank whose only live overdraft row is the program keeps it
 * (First Community FCU's "Overdraft Boost", 92746, which James keeps until its tiered fees are
 * captured). Switched on Oct 16 (James, 04:53 UTC: "Retire wrong copy"; the dry run held 1, Selco's
 * 143753). Off (`planHoldLive: false`), a step only lists the fees it would hold (`planWouldHold`).
 * Hamilton's fill re-reads every live overdraft fee stored by the period on each publish step, so
 * this is the rule's live re-check.
 */
export const OVERDRAFT_PLAN_HOLD_LIVE = true;
export const OVERDRAFT_PLAN_HOLD_REASON = "an optional overdraft plan priced by the period beside the bank's per-item overdraft fee";

/** The rolled_back_reason prefix of a fee the frequency fill holds (v11). */
export const FREQUENCY_HOLD_REASON = "frequency_hold";
/** Knox cuts its stored line at 180 characters; a line this long may end before its price (v15). */
export const CUT_EXCERPT_CHARS = 170;
/** How much of a cut line's opening must match the document's line. */
const FULL_LINE_KEY_CHARS = 120;
/** Documents read per step for box-table headers; later steps take the rest. */
export const BOX_HEADER_DOCUMENT_LIMIT = 300;
export const FREQUENCY_FILL_LIMIT = 2_000;
/** Postgres pre-filter for a blank: an excerpt with any frequency word (`settledFrequency` decides). */
const CANDIDATE_WORDING = String.raw`excerpt=.*(each|every|per |monthly|annual|quarterly|yearly|a month|a year|\$\s?[0-9.,]+\s*ea\y|/\s?[a-z])`;
const PERIOD_KEYS_SQL = `ARRAY[${[...PERIOD_FEE_KEYS].map((key) => `'${key}'`).join(", ")}]::text[]`;
/** Postgres pre-filter for a stated frequency: a line holding more than one cell or price. */
const SHARED_LINE = String.raw`excerpt=.*(\|.*\$|\$.*\$)`;
/**
 * The rows the fill read before v15. A blank whose stored line may be cut (v15) is read on its full
 * line when one is found, and otherwise only when it is one of these, exactly as before.
 */
const BEFORE_V15_CANDIDATE = `(
               -- A blank is read only on a line with frequency wording; a stated frequency only on a
               -- line it may have been borrowed across.
               (fp.frequency IS NULL AND COALESCE(fr.extraction_note, fr.conditions) ~* '${CANDIDATE_WORDING}')
               OR (fp.frequency IS NOT NULL AND COALESCE(fr.extraction_note, fr.conditions) ~ '${SHARED_LINE}')
               -- v4: a stated period on a per-event fee, which the line may never state.
               OR fp.frequency = 'daily'
               OR (fp.frequency IN ('monthly', 'annual', 'quarterly') AND fp.canonical_fee_key <> ALL(${PERIOD_KEYS_SQL}))
               -- v13: a continuous overdraft fee stored by the period, and a blank maintenance fee
               -- whose own name or line names a month or a statement cycle.
               OR (fp.canonical_fee_key = 'continuous_od' AND fp.frequency IN ('monthly', 'annual', 'quarterly'))
               OR (fp.frequency IS NULL AND fp.canonical_fee_key = 'monthly_maintenance'
                   AND (fp.fee_name ILIKE '%month%' OR COALESCE(fr.extraction_note, fr.conditions) ~* 'excerpt=.*(month|statement cycle)')))`;

interface BlankFrequencyRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  fee_raw_id: number | string | null;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  amount: number | string | null;
  frequency: string | null;
  conditions: string | null;
  fee_name?: string | null;
  /** #1360: an overdraft row whose bank has another live overdraft fee charged per item above $0. */
  has_per_item_overdraft?: boolean | null;
  /** v15: the row is one the fill read before v15 (false when only a possibly cut line selected it). */
  before_v15?: boolean | null;
}

export interface FrequencyFill {
  feePublishedId: number;
  feeVerifiedId: number | null;
  feeRawId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number;
  from: string | null;
  frequency: string | null;
  sourceLine: string;
  /** v10: "box_table_header" when the period came from the box table's column header; v15: "full_stored_line". */
  basis?: string;
}

/** v11: a live fee whose own line states a period it cannot carry, taken down for review. */
export interface FrequencyHold {
  feePublishedId: number;
  feeVerifiedId: number | null;
  feeRawId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number;
  frequency: string;
  sourceLine: string;
  reason: string;
}

export interface FrequencyFillResult {
  scanned: number;
  filled: FrequencyFill[];
  held: FrequencyHold[];
  /** #1360: kept overdraft program fees the plan hold would take down while its switch is off. */
  planWouldHold: FrequencyHold[];
  dryRun: boolean;
}

/** The schedule line Knox read the fee from (`excerpt="..."` at the end of its conditions). */
export function excerptOf(conditions: string | null | undefined): string | null {
  const match = conditions?.match(/\bexcerpt="([\s\S]*)"\s*$/) ?? conditions?.match(/\bexcerpt=([\s\S]*)$/);
  return match ? match[1] : null;
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * v15: the one line of the stored document that holds a cut stored line's opening and prints the
 * fee's price, or null when no line or more than one distinct line does. A document with no line
 * breaks (one flattened paragraph) gives nothing: its "line" is the whole schedule.
 */
export function fullStoredLine(text: string, excerpt: string, amount: number): string | null {
  if (!text.includes("\n")) return null;
  return oneFullLine(text.split(/\r?\n/), excerpt, amount);
}

/** The opening of a cut stored line that its document's line must hold, or null when too short to tell. */
function fullLineKey(excerpt: string): string | null {
  const key = squash(excerpt).slice(0, FULL_LINE_KEY_CHARS);
  return key.length < 40 ? null : key;
}

/** `fullStoredLine` over a document's lines (the full text's, or those the SQL read returned). */
function oneFullLine(candidates: string[], excerpt: string, amount: number): string | null {
  const key = fullLineKey(excerpt);
  if (!key) return null;
  const lines = new Set(candidates.map(squash).filter((line) => line.includes(key)));
  if (lines.size !== 1) return null;
  const [line] = lines;
  if (line.length > 1_000 || !printsAmount(line, amount)) return null;
  return line;
}

/** A blank whose stored line may have been cut before its price (v15). */
function cutBeforePrice(row: BlankFrequencyRow, excerpt: string | null): excerpt is string {
  return row.frequency == null && excerpt != null && excerpt.length >= CUT_EXCERPT_CHARS && !printsAmount(excerpt, Number(row.amount));
}

export async function fillBlankFrequencies(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; limit?: number; planHoldLive?: boolean },
): Promise<FrequencyFillResult> {
  const planHoldLive = options.planHoldLive ?? OVERDRAFT_PLAN_HOLD_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? FREQUENCY_FILL_LIMIT, 10_000));
  const result: FrequencyFillResult = { scanned: 0, filled: [], held: [], planWouldHold: [], dryRun: options.dryRun };
  let rows: BlankFrequencyRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<BlankFrequencyRow[]>(
      `SELECT fp.fee_published_id, fv.fee_verified_id, fr.fee_raw_id, fp.institution_id, fr.source_document_id,
              fp.canonical_fee_key, fp.amount, fp.frequency, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fp.fee_name,
              -- Never NULL: a blank row's "frequency = 'daily'" arm is NULL, not false (#1929 review).
              COALESCE(${BEFORE_V15_CANDIDATE}, false) AS before_v15,
              (fp.canonical_fee_key = 'overdraft' AND EXISTS (
                SELECT 1 FROM published_fee_records other
                 WHERE other.institution_id = fp.institution_id
                   AND other.fee_published_id <> fp.fee_published_id
                   AND other.canonical_fee_key = 'overdraft'
                   AND other.rolled_back_at IS NULL
                   AND other.quarantined_at IS NULL
                   AND other.amount > 0
                   AND (other.frequency IS NULL OR other.frequency IN ('per_item', 'per_occurrence', 'per_transaction', 'one_time'))
              )) AS has_per_item_overdraft
         FROM published_fee_records fp
         LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        WHERE fp.rolled_back_at IS NULL
          AND ${notAdminCorrectedSql("fp")}
          AND fp.amount_kind = 'flat'
          AND fp.amount IS NOT NULL
          AND COALESCE(fr.extraction_note, fr.conditions) LIKE '%excerpt=%'
          AND (${BEFORE_V15_CANDIDATE}
               -- v15: a blank whose stored line may end before its price.
               OR (fp.frequency IS NULL AND fr.source_document_id IS NOT NULL
                   AND length(substring(COALESCE(fr.extraction_note, fr.conditions) from 'excerpt="(.*)"\\s*$')) >= ${CUT_EXCERPT_CHARS}))
          ${options.institutionId ? "AND fp.institution_id = $1" : ""}
        ORDER BY fp.fee_published_id`,
      options.institutionId ? [options.institutionId] : [],
    ));
  } catch (error) {
    console.error("fillBlankFrequencies read failed:", error);
    return result;
  }
  // v10: blank box rents named by their size, read against their document's column headers.
  let boxRows: BlankFrequencyRow[] = [];
  const textsByDocument = new Map<number, string>();
  try {
    boxRows = await inSavepoint(db, (scope) => scope.unsafe<BlankFrequencyRow[]>(
      `SELECT fp.fee_published_id, fv.fee_verified_id, fr.fee_raw_id, fp.institution_id, fr.source_document_id,
              fp.canonical_fee_key, fp.amount, fp.frequency, COALESCE(fr.extraction_note, fr.conditions) AS conditions
         FROM published_fee_records fp
         JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        WHERE fp.rolled_back_at IS NULL
          AND ${notAdminCorrectedSql("fp")}
          AND fp.amount_kind = 'flat'
          AND fp.amount IS NOT NULL
          AND fp.frequency IS NULL
          AND fp.canonical_fee_key = 'safe_deposit_box'
          AND fp.fee_name ~* '^\\W*[0-9]{1,2}(\\.[0-9])?\\s*[x×]\\s*[0-9]{1,2}'
          AND fr.source_document_id IS NOT NULL
          AND COALESCE(fr.extraction_note, fr.conditions) LIKE '%excerpt=%'
          ${options.institutionId ? "AND fp.institution_id = $1" : ""}
        ORDER BY fp.fee_published_id`,
      options.institutionId ? [options.institutionId] : [],
    ));
    const documentIds = [...new Set(boxRows.map((row) => Number(row.source_document_id)))].slice(0, BOX_HEADER_DOCUMENT_LIMIT);
    boxRows = boxRows.filter((row) => documentIds.includes(Number(row.source_document_id)));
    if (documentIds.length > 0) {
      const texts = await inSavepoint(db, (scope) => scope.unsafe<Array<{ source_document_id: number | string; normalized_text: string | null }>>(
        `SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
           FROM agent_source_texts
          WHERE source_document_id = ANY($1::bigint[])
            AND status = 'completed'
            AND normalized_text IS NOT NULL
          ORDER BY source_document_id, id DESC`,
        [documentIds],
      ));
      for (const text of texts) {
        if (typeof text.normalized_text === "string") textsByDocument.set(Number(text.source_document_id), text.normalized_text);
      }
    }
  } catch (error) {
    console.error("fillBlankFrequencies box header read failed:", error);
    boxRows = [];
  }
  // v15: full lines for blanks whose stored line ends before the price.
  const fullLines = new Map<number, string>();
  try {
    const cut = rows.filter((row) => row.source_document_id != null && cutBeforePrice(row, excerptOf(row.conditions)));
    const keyed = cut.flatMap((row) => {
      const key = fullLineKey(excerptOf(row.conditions)!);
      return key ? [{ row, key }] : [];
    });
    if (keyed.length > 0) {
      // Only the lines holding each cut line's opening come back, not whole documents, so every
      // cut row is read on every step without loading its document's text.
      const found = await inSavepoint(db, (scope) => scope.unsafe<Array<{ fee_published_id: number | string; lines: string[] | null }>>(
        `WITH want AS (
           SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[]) AS w(fee_published_id, source_document_id, key)
         ), txt AS (
           SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
             FROM agent_source_texts
            WHERE source_document_id IN (SELECT source_document_id FROM want)
              AND status = 'completed'
              AND normalized_text IS NOT NULL
            ORDER BY source_document_id, id DESC
         )
         SELECT w.fee_published_id, array_agg(DISTINCT l.line) AS lines -- v15 full lines
           FROM want w
           JOIN txt t ON t.source_document_id = w.source_document_id
           CROSS JOIN LATERAL (
             SELECT btrim(regexp_replace(x, '\\s+', ' ', 'g')) AS line
               FROM regexp_split_to_table(t.normalized_text, E'\\r?\\n') AS x
           ) l
          WHERE strpos(t.normalized_text, E'\\n') > 0
            AND strpos(l.line, w.key) > 0
          GROUP BY w.fee_published_id`,
        [keyed.map(({ row }) => Number(row.fee_published_id)), keyed.map(({ row }) => Number(row.source_document_id)), keyed.map(({ key }) => key)],
      ));
      const linesById = new Map(found.map((hit) => [Number(hit.fee_published_id), hit.lines ?? []] as const));
      for (const { row } of keyed) {
        const line = oneFullLine(linesById.get(Number(row.fee_published_id)) ?? [], excerptOf(row.conditions)!, Number(row.amount));
        if (line) fullLines.set(Number(row.fee_published_id), line);
      }
    }
  } catch (error) {
    console.error("fillBlankFrequencies full line read failed:", error);
  }
  const seen = new Set(rows.map((row) => Number(row.fee_published_id)));
  result.scanned = rows.length + boxRows.filter((row) => !seen.has(Number(row.fee_published_id))).length;
  for (const row of boxRows) {
    if (seen.has(Number(row.fee_published_id)) || result.filled.length >= limit) continue;
    const amount = Number(row.amount);
    const sourceLine = excerptOf(row.conditions);
    const text = textsByDocument.get(Number(row.source_document_id));
    if (!sourceLine || !text || !Number.isFinite(amount)) continue;
    // The fee's own line decides first; the header only fills a blank it leaves.
    if (fillReading(sourceLine, amount, null, row.canonical_fee_key) != null) continue;
    if (boxTableAnnualHeader(text, sourceLine, amount) !== "annual") continue;
    result.filled.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      feeRawId: num(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount,
      from: null,
      frequency: "annual",
      sourceLine: sourceLine.slice(0, 300),
      basis: "box_table_header",
    });
  }
  for (const row of rows) {
    const amount = Number(row.amount);
    const excerpt = excerptOf(row.conditions);
    const fullLine = fullLines.get(Number(row.fee_published_id));
    const sourceLine = fullLine ?? excerpt;
    if (!sourceLine || !Number.isFinite(amount)) continue;
    // v15: a cut line with no full line found reads only as before (its own frequency wording).
    // NULL reads as false too, so a SQL slip never lets a v15-only row through on its excerpt.
    if (!fullLine && row.before_v15 !== true && row.before_v15 !== undefined) continue;
    const stated = row.frequency ?? null;
    const check = perEventPeriodCheck(row.canonical_fee_key, stated, sourceLine, amount, row.fee_name)
      ?? continuousOverdraftPeriodCheck(row.canonical_fee_key, stated, sourceLine, amount, row.fee_name);
    // #1360: a kept overdraft program priced by the period, beside the bank's per-item overdraft fee.
    const plan = check?.action === "keep" && row.canonical_fee_key === "overdraft" && row.has_per_item_overdraft === true;
    if (plan && !planHoldLive) {
      result.planWouldHold.push({
        feePublishedId: Number(row.fee_published_id),
        feeVerifiedId: num(row.fee_verified_id),
        feeRawId: num(row.fee_raw_id),
        institutionId: Number(row.institution_id),
        sourceDocumentId: num(row.source_document_id),
        canonicalFeeKey: row.canonical_fee_key,
        amount,
        frequency: stated!,
        sourceLine: sourceLine.slice(0, 300),
        reason: `${FREQUENCY_HOLD_REASON}: ${OVERDRAFT_PLAN_HOLD_REASON}`,
      });
      continue;
    }
    if (check?.action === "keep" && !plan) continue;
    if (check?.action === "hold" || plan) {
      const reason = check?.action === "hold" ? check.reason : OVERDRAFT_PLAN_HOLD_REASON;
      if (result.held.length >= limit) continue;
      result.held.push({
        feePublishedId: Number(row.fee_published_id),
        feeVerifiedId: num(row.fee_verified_id),
        feeRawId: num(row.fee_raw_id),
        institutionId: Number(row.institution_id),
        sourceDocumentId: num(row.source_document_id),
        canonicalFeeKey: row.canonical_fee_key,
        amount,
        frequency: stated!,
        sourceLine: sourceLine.slice(0, 300),
        reason: `${FREQUENCY_HOLD_REASON}: ${reason}`,
      });
      continue;
    }
    // #1196 (no version change): a blank NSF fee is never filled with a period. Before, the fill
    // set Addition Financial's "Nonsufficient funds" (24188) to monthly from "$15 00 per month" on
    // its line, and the v11 check cleared it on the next pass, over and over. A stated period the
    // check does not cover waits for James, so only a blank is read this way.
    const settled = fillReading(sourceLine, amount, stated, row.canonical_fee_key);
    let frequency = check
      ? check.frequency
      : stated == null
        ? perEventFrequency(row.canonical_fee_key, settled, sourceLine, amount) ?? maintenanceMonthlyFill(row.canonical_fee_key, stated, sourceLine, amount, row.fee_name)
        : settled;
    // v13 (#1339): a blank is never filled with a period the check above would clear or hold on the
    // next pass. Before, overdraft fees 79931, 130684 and 140170 went round that loop on every
    // publish step: "Overdraft Trans. (After 3rd trans. per mo.) | $5.00" was filled monthly from its
    // line, then cleared, then filled again (the feedback dedupe logged only the first round).
    // v14 (#1339): the same holds for a stated frequency. A correction the check made ("Deposited
    // Item Returned (per item) $10.00 Dormant Account Fee (per month)", 53797 monthly -> per_item)
    // was read on the next pass by `settledFrequency`, which took "monthly" off the same line and
    // wrote it back two minutes later (01:30 and 01:32 UTC, Oct 15; 53797, 65200, 76864, 103686,
    // 128934 and 124039). Any value the fill writes must be one its own check keeps, so a correction
    // is a fixed point: the next pass reads it and writes nothing. A value the check would hold
    // leaves a stated frequency as it is and a blank blank.
    if (frequency != null && frequency !== stated) {
      const recheck = perEventPeriodCheck(row.canonical_fee_key, frequency, sourceLine, amount, row.fee_name)
        ?? continuousOverdraftPeriodCheck(row.canonical_fee_key, frequency, sourceLine, amount, row.fee_name);
      if (recheck && recheck.action !== "keep") frequency = recheck.action === "correct" ? recheck.frequency : stated;
    }
    if (frequency === stated) continue;
    if (result.filled.length >= limit) break;
    result.filled.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      feeRawId: num(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount,
      from: stated,
      frequency,
      sourceLine: sourceLine.slice(0, 300),
      ...(fullLine ? { basis: "full_stored_line" } : {}),
    });
  }
  if (options.dryRun) return result;

  if (result.held.length > 0) {
    try {
      const held = result.held;
      const rolledBack = await inSavepoint(db, async (scope) => {
        const rows = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${`agentic-run-${options.runId}`},
                 rolled_back_reason = v.reason
            FROM unnest(${held.map((fee) => fee.feePublishedId)}::bigint[], ${held.map((fee) => fee.frequency)}::text[],
                        ${held.map((fee) => fee.reason)}::text[])
                 AS v(fee_published_id, frequency, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.frequency IS NOT DISTINCT FROM v.frequency
             AND fp.rolled_back_at IS NULL
             AND fp.quarantined_at IS NULL
          RETURNING fp.fee_published_id
        `;
        return new Set(rows.map((row) => Number(row.fee_published_id)));
      });
      result.held = held.filter((fee) => rolledBack.has(fee.feePublishedId));
    } catch (error) {
      throw writeFailed("frequency hold", error);
    }
  }

  if (result.filled.length > 0) {
    try {
      const filled = result.filled;
      const updated = await inSavepoint(db, async (scope) => {
        const rows = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET frequency = v.frequency
            FROM unnest(${filled.map((fee) => fee.feePublishedId)}::bigint[], ${filled.map((fee) => fee.from)}::text[],
                        ${filled.map((fee) => fee.frequency)}::text[])
                 AS v(fee_published_id, from_frequency, frequency)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.frequency IS NOT DISTINCT FROM v.from_frequency
          RETURNING fp.fee_published_id
        `;
        const verified = filled.filter((fee) => fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET frequency = v.frequency
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId!)}::bigint[], ${verified.map((fee) => fee.from)}::text[],
                          ${verified.map((fee) => fee.frequency)}::text[])
                   AS v(fee_verified_id, from_frequency, frequency)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.frequency IS NOT DISTINCT FROM v.from_frequency
          `;
        }
        return new Set(rows.map((row) => Number(row.fee_published_id)));
      });
      result.filled = filled.filter((fee) => updated.has(fee.feePublishedId));
    } catch (error) {
      throw writeFailed("frequency fill", error);
    }
  }

  const lessons: FeedbackRow[] = result.filled.map((fee): FeedbackRow => ({
    aboutStage: "extract",
    signal: "wrong",
    kind: fee.from == null ? "frequency_filled" : fee.frequency == null ? "frequency_cleared" : "frequency_corrected",
    reportedBy: "gutenberg",
    checkName: FREQUENCY_FILL_CHECK,
    aboutVersion: FREQUENCY_FILL_VERSION,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    feeRawId: fee.feeRawId,
    feeVerifiedId: fee.feeVerifiedId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: fee.amount,
    evidence: { from: fee.from, to: fee.frequency, source_line: fee.sourceLine, ...(fee.basis ? { basis: fee.basis } : {}) },
    runId: options.runId,
    dedupeKey: fee.from == null
      ? `${FREQUENCY_FILL_CHECK}:v${FREQUENCY_FILL_VERSION}:fill:${fee.feePublishedId}`
      : `${FREQUENCY_FILL_CHECK}:v${FREQUENCY_FILL_VERSION}:fix:${fee.feePublishedId}:${fee.from}:${fee.frequency ?? "none"}`,
  }));
  for (const fee of result.held) {
    lessons.push({
      aboutStage: "extract",
      signal: "wrong",
      kind: "frequency_held",
      reportedBy: "gutenberg",
      checkName: FREQUENCY_FILL_CHECK,
      aboutVersion: FREQUENCY_FILL_VERSION,
      institutionId: fee.institutionId,
      sourceDocumentId: fee.sourceDocumentId,
      feeRawId: fee.feeRawId,
      feeVerifiedId: fee.feeVerifiedId,
      feePublishedId: fee.feePublishedId,
      canonicalFeeKey: fee.canonicalFeeKey,
      amount: fee.amount,
      evidence: { from: fee.frequency, held: true, reason: fee.reason, source_line: fee.sourceLine },
      runId: options.runId,
      dedupeKey: `${FREQUENCY_FILL_CHECK}:v${FREQUENCY_FILL_VERSION}:hold:${fee.feePublishedId}`,
    });
  }
  if (lessons.length > 0) {
    try {
      await inSavepoint(db, (scope) => recordFeedback(scope as SqlTag, lessons));
    } catch (error) {
      console.error("frequency fill feedback failed:", error);
    }
  }
  if (result.filled.length > 0 || result.held.length > 0) invalidatePublicReadCache();
  return result;
}

/**
 * The frequency fill as Hamilton's publish step runs it. A failed write must not roll back the
 * whole publish (a failure that repeats would stop all publishing), so the fill runs in its own
 * savepoint: on a failure its writes are undone together, the publish carries on, and the error
 * is kept in the step detail (`writeError`) and as a `step.warning` run event. The dedicated
 * `frequency-fill` step calls `fillBlankFrequencies` directly and fails on the same error (#1349).
 */
export async function fillFrequenciesInPublish(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number },
): Promise<FrequencyFillResult & { writeError: string | null }> {
  try {
    const result = await inSavepoint(db, (scope) => fillBlankFrequencies(scope, options));
    return { ...result, writeError: null };
  } catch (error) {
    const writeError = error instanceof Error ? error.message : String(error);
    console.error("frequency fill in publish failed:", error);
    try {
      await db`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (${options.runId}, ${options.stepId ?? null}, 'step.warning', 'info',
                ${`Frequency fill skipped: ${writeError}`},
                ${JSON.stringify({ check: FREQUENCY_FILL_CHECK, version: FREQUENCY_FILL_VERSION, error: writeError })}::jsonb)
      `;
    } catch (eventError) {
      console.error("frequency fill warning event failed:", eventError);
    }
    return { scanned: 0, filled: [], held: [], planWouldHold: [], dryRun: options.dryRun, writeError };
  }
}

/**
 * #1349: a failed live write fails the step with the error text, and the run's transaction rolls
 * back, instead of a "completed" step that reads as 0 changes. A dry run writes nothing.
 */
function writeFailed(what: string, error: unknown): Error {
  return new Error(`${what} write failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}

/**
 * `settledFrequency` as the fill applies it. #1456 (no version change): the fill never writes
 * "hourly" (`hourly: false`). A per-hour fee reads exactly as it did under v8; a fee becomes hourly
 * at Darwin's verify (`verifiedFrequency`, since Oct 21) or through Darwin's live hourly re-check
 * (`darwin/hourly-frequency-check.ts`, switched on since Oct 16). A fee already hourly keeps it, so
 * the fill never undoes either.
 */
function fillReading(sourceLine: string, amount: number, stated: string | null, canonicalFeeKey: string): string | null {
  return settledFrequency(sourceLine, amount, stated, canonicalFeeKey, { hourly: false });
}

function num(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}
