import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { productKeySql } from "@/lib/fee-product";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { namesShareReading } from "@/lib/agents/hamilton/publish";
import { SAME_LINE_DUPLICATE_FLAG, SAME_LINE_DUPLICATE_REASON } from "@/lib/agents/hamilton/same-line-duplicates";
import { linePrintsSql, readsSameLine, sameLineExcerptSql } from "@/lib/agents/hamilton/same-line-read";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees that are one printed line read twice (#1876; decision 2026-10-15,
 * "Darwin re-checks every live fee against today's rules"). Access FCU (7235) showed 132908 "charge
 * for each one-time debit overdraft" and 137315 "One-time debit overdraft charge", both $30 from the
 * one line "- $30.00 charge for each one-time debit overdraft." of doc 28555. Hamilton's publish
 * step now refuses such a second read (`hamilton/same-line-read.ts`, the one rule and why the
 * older checks missed it); this re-check reads the ones already live.
 *
 * In each group of live fees that share an institution, document, category, variant, dollar
 * amount, audience, product and stored source line, the read that states its frequency is kept
 * first, then the oldest. Every other read in the group comes down when `readsSameLine` holds
 * against a kept read: the line is printed once in the document's current completed text, prints
 * the amount once, the frequencies do not differ and one name's words are all in the other's.
 *
 * Shadow first (CLAUDE.md standing rule): with `SAME_LINE_READ_TAKEDOWN_LIVE` false, or in a dry run,
 * the step only reports. Switched on, a match goes through the shared 12-hour second look (check
 * `darwin.same_line_read`) and is archived on its second failure while its kept read is still live:
 * rolled back as `same_line_duplicate: live fee #<kept>` (so Hamilton's same-line restore brings it
 * back if that line goes), the verified row rejected with the `same_line_duplicate` flag, never
 * deleted, and a `darwin.same_line_read_takedown` event lists them.
 *
 * Dry run, prod read-only, 2026-10-26 (`SAME_LINE_READ_ROWS_SQL` through `findSameLineReads`): see
 * docs/project/findings/2026-10-26-one-line-read-twice.md for the counts and the sample.
 */
export const SAME_LINE_READ_CHECK = "darwin.same_line_read";
export const SAME_LINE_READ_CHECK_VERSION = 1;
/** The switch: on takes matches down after the second look; off only reports. */
export const SAME_LINE_READ_TAKEDOWN_LIVE = true;
/** Live fees read per step (a few hundred share a line; the cap is a guard). */
export const SAME_LINE_READ_LIMIT = 5_000;
export const SAME_LINE_READ_SAMPLES = 20;

export interface SameLineReadRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  variant: string | null;
  frequency: string | null;
  audience: string | null;
  product_key: string | null;
  source_document_id: number | string | null;
  /** The stored source line, folded (`sameLineExcerptSql`). */
  excerpt: string | null;
  /** How many times the document's current completed text prints that line (`linePrintsSql`). */
  line_prints: number | string | null;
}

export interface SameLineReadMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number | null;
  frequency: string | null;
  keptFeePublishedId: number;
  keptFeeName: string | null;
  keptFrequency: string | null;
  excerpt: string;
  reason: string;
}

export interface SameLineReadFindings {
  /** Live fees read that share their stored line with another live fee of the same key. */
  checked: number;
  groups: number;
  matched: number;
  institutions: number;
  samples: SameLineReadMatch[];
}

export interface SameLineReadResult extends SameLineReadFindings {
  live: boolean;
  dryRun: boolean;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function groupKey(row: SameLineReadRow): string {
  return [
    row.institution_id, row.source_document_id, row.canonical_fee_key, row.variant ?? "", num(row.amount),
    row.audience ?? "unknown", row.product_key ?? "", row.excerpt ?? "",
  ].map(String).join("\u0001");
}

/** A read that states its frequency is kept first, then the oldest. */
function keepOrder(a: SameLineReadRow, b: SameLineReadRow): number {
  const stated = (row: SameLineReadRow) => (row.frequency == null || row.frequency === "other" ? 1 : 0);
  return stated(a) - stated(b) || Number(a.fee_published_id) - Number(b.fee_published_id);
}

/** Pure: each live fee with a verdict. `passing` is every fee read that stays. */
export function findSameLineReads(rows: SameLineReadRow[]): SameLineReadFindings & { matches: SameLineReadMatch[]; passing: number[] } {
  const groups = new Map<string, SameLineReadRow[]>();
  for (const row of rows) {
    if (!(row.excerpt ?? "").trim()) continue;
    const key = groupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const matches: SameLineReadMatch[] = [];
  const passing: number[] = [];
  let shared = 0;
  for (const group of groups.values()) {
    if (group.length < 2) {
      passing.push(...group.map((row) => Number(row.fee_published_id)));
      continue;
    }
    shared += 1;
    const kept: SameLineReadRow[] = [];
    for (const row of [...group].sort(keepOrder)) {
      const keeper = kept.find((candidate) => readsSameLine(
        row, candidate, { excerpt: row.excerpt, linePrints: row.line_prints, amount: row.amount },
        namesShareReading(row.fee_name, candidate.fee_name),
      ));
      if (!keeper) {
        kept.push(row);
        passing.push(Number(row.fee_published_id));
        continue;
      }
      const keptId = Number(keeper.fee_published_id);
      matches.push({
        feePublishedId: Number(row.fee_published_id),
        feeVerifiedId: num(row.fee_verified_id),
        institutionId: Number(row.institution_id),
        feeName: row.fee_name ?? "",
        amount: num(row.amount),
        canonicalFeeKey: row.canonical_fee_key ?? null,
        sourceDocumentId: num(row.source_document_id),
        frequency: row.frequency ?? null,
        keptFeePublishedId: keptId,
        keptFeeName: keeper.fee_name ?? null,
        keptFrequency: keeper.frequency ?? null,
        excerpt: row.excerpt ?? "",
        reason: `${SAME_LINE_DUPLICATE_REASON}: live fee #${keptId}`,
      });
    }
  }
  matches.sort((a, b) => a.feePublishedId - b.feePublishedId);
  return {
    checked: rows.length,
    groups: shared,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, SAME_LINE_READ_SAMPLES),
    matches,
    passing,
  };
}

/**
 * Read-only: every live dollar fee that shares its institution, document, category, variant,
 * amount, audience, product and stored source line with another live fee, with how many times the
 * document's current completed text prints that line. The same read the step makes; run it in a
 * read-only transaction for the dry-run count. Parameters: `$1` an institution id or null for all,
 * `$2` the row cap.
 */
export const SAME_LINE_READ_ROWS_SQL = `
    WITH live AS (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, COALESCE(fp.variant_type, '') AS variant, fp.frequency,
             COALESCE(fp.fee_audience, 'unknown') AS audience, ${productKeySql("fr.product_name")} AS product_key,
             fr.source_document_id, ${sameLineExcerptSql("fr")} AS excerpt
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount IS NOT NULL
         AND fp.rate_percent IS NULL
         AND fp.amount_kind IS DISTINCT FROM 'percent'
         AND fr.source_document_id IS NOT NULL
         AND ($1::bigint IS NULL OR fp.institution_id = $1::bigint)
    ),
    shared AS (
      SELECT live.*,
             count(*) OVER (PARTITION BY institution_id, source_document_id, canonical_fee_key, variant, amount,
                                         audience, product_key, excerpt) AS reads
        FROM live
       WHERE excerpt <> ''
    )
    SELECT s.fee_published_id, s.fee_verified_id, s.institution_id, s.fee_name, s.amount, s.canonical_fee_key,
           s.variant, s.frequency, s.audience, s.product_key, s.source_document_id, s.excerpt,
           ${linePrintsSql("s.source_document_id", "s.excerpt")} AS line_prints
      FROM shared s
     WHERE s.reads > 1
     ORDER BY s.fee_published_id
     LIMIT $2::int`;

/** Read the rows (`SAME_LINE_READ_ROWS_SQL`). */
export function sameLineReadRows(db: SqlTag, options: { institutionId?: number; limit?: number } = {}): Promise<SameLineReadRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? SAME_LINE_READ_LIMIT, 50_000));
  return db.unsafe<SameLineReadRow[]>(SAME_LINE_READ_ROWS_SQL, [options.institutionId ?? null, limit]);
}

function findingsOnly(found: ReturnType<typeof findSameLineReads>): SameLineReadFindings {
  const { checked, groups, matched, institutions, samples } = found;
  return { checked, groups, matched, institutions, samples };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing checked,
 * and a failed write leaves the fees as they were.
 */
export async function recheckSameLineReads(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<SameLineReadResult> {
  const live = options.live ?? SAME_LINE_READ_TAKEDOWN_LIVE;
  const result: SameLineReadResult = {
    live, dryRun: options.dryRun, ...findingsOnly(findSameLineReads([])), flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };
  let rows: SameLineReadRow[];
  try {
    rows = await inSavepoint(db, (scope) => sameLineReadRows(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] same-line read check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  const found = findSameLineReads(rows);
  Object.assign(result, findingsOnly(found));

  if (live && !options.dryRun && (found.matches.length > 0 || found.passing.length > 0)) {
    const look = await secondLook(db, {
      check: SAME_LINE_READ_CHECK, runId: options.runId, failing: found.matches, passing: found.passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  // The step's report. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${SAME_LINE_READ_CHECK}, 'completed',
          ${`Read ${result.checked} live fee(s) that share a stored source line with another live fee: ${result.matched} are a second read of one printed line and would come down; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, nothing written"}`},
          ${JSON.stringify(sameLineReadDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] same-line read check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: SameLineReadMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      // Only while the kept read is still live: the bank's price must stay shown once.
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-same-line-read-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.keptFeePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, kept_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
           AND EXISTS (
             SELECT 1 FROM published_fee_records kept
              WHERE kept.fee_published_id = v.kept_id AND kept.rolled_back_at IS NULL AND kept.quarantined_at IS NULL
           )
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${SAME_LINE_DUPLICATE_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${SAME_LINE_DUPLICATE_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] same-line read takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: SameLineReadMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.same_line_read_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) that were a second read of one printed line, on their second look`},
        ${JSON.stringify({ version: SAME_LINE_READ_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] same-line read takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: SameLineReadMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    frequency: fee.frequency,
    kept_fee_published_id: fee.keptFeePublishedId,
    kept_fee_name: fee.keptFeeName,
    kept_frequency: fee.keptFrequency,
    excerpt: fee.excerpt.slice(0, 200),
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function sameLineReadDetail(result: SameLineReadResult) {
  return {
    check: SAME_LINE_READ_CHECK,
    version: SAME_LINE_READ_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    checked: result.checked,
    groups: result.groups,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
