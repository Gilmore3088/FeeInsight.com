import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { workedExampleAmountAt } from "@/lib/agents/knox/rules";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees that are a figure from a worked example (prod sample, Nov 2; decision
 * 2026-10-15, "Darwin re-checks every live fee against today's rules"). Community Choice CU's agreement
 * (institution 7751, Rosetta artifact 32044) explains its overdraft protection with an example: "The
 * following example illustrates how this works ...: Assume your actual and available balances in your
 * checking account are both $50, and your available balance in your designated linked account is $10.
 * ... However, if you have also elected Overdraft Privilege, we may elect to transfer the $10 in your
 * designated linked account and pay the remaining $20.00 portion of the item using Overdraft Privilege."
 * Knox read that last sentence's $10 (the example's linked-account balance) as an overdraft transfer
 * fee, and it went live as 89920 under the sentence as its name. Knox v160 no longer reads such a price
 * (`workedExampleAmountAt`, rules pass), but the fee read before stays live: its name and price still
 * trace to the stored text, so Hamilton's rules re-check and the shared source check keep it.
 *
 * The example's opening ("Assume", "Suppose", "Example:", "For example, if", "The following example")
 * sits sentences before the fee's own line, outside Knox's stored excerpt, so this check reads the
 * stored text the fee was read from (`agent_source_texts`, by the note's Rosetta artifact id, only when
 * its sha256 is the note's `text_hash`) around the excerpt. Each verify step reads every live flat fee
 * above $0 whose excerpt is not a table row and whose text names an example in the 3,000 characters
 * before it (the SQL prefilter), and `workedExampleAmountAt` decides with Knox's own test: the excerpt's
 * paragraph opens a worked example before it (or the line above leads into one), and no fee word owns
 * the price anywhere the excerpt prints it ("charged an overdraft fee of $25" in an example is the
 * bank's own price, and stays). Admin-corrected fees are never read. Switched on, a match goes through
 * the shared 12-hour second look (check `darwin.worked_example`) and is archived on its second failure:
 * rolled back with `worked_example: <price> ...`, its verified row rejected with the `worked_example`
 * flag so publish does not bring it back, never deleted, and a `darwin.worked_example_takedown` event
 * lists them. In a dry run, or with the switch off (the default), the step only reports.
 *
 * The switch is the environment variable `DARWIN_WORKED_EXAMPLE_TAKEDOWN_LIVE` ("true" turns it on;
 * unset or anything else is off), read once when the module loads.
 *
 * Dry run, prod read-only, 2026-11-02: of 31,188 live flat fees above $0 with a prose excerpt, 1,465 have
 * an example word in the 3,000 characters before their excerpt; 16 sit in a worked example, and 15 of
 * those print their price after a fee word and stay. 1 matches: 89920 (7751). See
 * docs/project/findings/2026-11-02-worked-example-figure-read-as-fee.md.
 */
export const WORKED_EXAMPLE_CHECK = "darwin.worked_example";
export const WORKED_EXAMPLE_CHECK_VERSION = 1;
/** The switch, off unless the environment says "true": on takes matches down after the second look. */
export const WORKED_EXAMPLE_TAKEDOWN_LIVE: boolean = process.env.DARWIN_WORKED_EXAMPLE_TAKEDOWN_LIVE === "true";
export const WORKED_EXAMPLE_REASON = "worked_example";
export const WORKED_EXAMPLE_FLAG = "worked_example";
export const WORKED_EXAMPLE_LIMIT = 2_000;
export const WORKED_EXAMPLE_SAMPLES = 20;
/** How much stored text before the excerpt is read: the example's opening is in the same paragraph. */
export const WORKED_EXAMPLE_WINDOW = 3_000;

export interface WorkedExampleRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  /** Knox's stored excerpt (the fee's own line), without its quotes. */
  excerpt: string | null;
  /** The stored text right before the excerpt, up to `WORKED_EXAMPLE_WINDOW` characters. */
  text_before: string | null;
}

export interface WorkedExampleMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  sourceLine: string;
  reason: string;
}

export interface WorkedExampleFindings {
  checked: number;
  matched: number;
  institutions: number;
  samples: WorkedExampleMatch[];
}

export interface WorkedExampleResult extends WorkedExampleFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** Pure: the matches among the rows the read selected, decided with Knox v160's own test. */
export function findWorkedExamples(rows: WorkedExampleRow[]): WorkedExampleFindings & { matches: WorkedExampleMatch[] } {
  const matches: WorkedExampleMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const amount = num(row.amount);
    const excerpt = (row.excerpt ?? "").trim();
    if (amount == null || amount <= 0 || !excerpt || row.text_before == null) continue;
    if (!workedExampleAmountAt(row.text_before, excerpt, amount)) continue;
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: (row.fee_name ?? "").trim(),
      amount,
      canonicalFeeKey: row.canonical_fee_key,
      sourceLine: excerpt.slice(0, 300),
      reason: `${WORKED_EXAMPLE_REASON}: ${dollars(amount)} is a figure in a worked example ("${excerpt.slice(0, 120)}"), not a charge`,
    });
  }
  return {
    checked: seen.size,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, WORKED_EXAMPLE_SAMPLES),
    matches,
  };
}

/** Postgres pre-filter on the stored text before the excerpt: a worked example's words. */
export const WORKED_EXAMPLE_PREFILTER = String.raw`(assume|suppose|hypothetical|imagine|let.?s say|example)`;

/**
 * Read-only: every live flat fee above $0 whose excerpt is not a table row, with the stored text
 * before it. The text is the note's Rosetta artifact, read only when its sha256 is the note's
 * `text_hash` (the text Knox read), and only where it prints the excerpt's first 30 characters.
 */
export function workedExampleRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? WORKED_EXAMPLE_LIMIT, 10_000));
  return db<WorkedExampleRow[]>`
    WITH live AS (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key,
             substring(fr.extraction_note from 'artifact #([0-9]+)')::bigint AS artifact_id,
             substring(fr.extraction_note from 'text_hash=([a-f0-9]{64})') AS text_hash,
             regexp_replace(substring(fr.extraction_note from 'excerpt="(.*)$'), '"[[:space:]]*$', '') AS excerpt
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.amount > 0
         AND fr.extraction_note LIKE '%excerpt="%'
         AND substring(fr.extraction_note from 'excerpt=(.*)$') NOT LIKE '%|%'
         -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
    ), placed AS (
      SELECT live.*, strpos(t.normalized_text, left(live.excerpt, 30)) AS at, t.normalized_text
        FROM live
        JOIN agent_source_texts t ON t.id = live.artifact_id
       WHERE length(live.excerpt) >= 20
         AND encode(sha256(convert_to(t.normalized_text, 'UTF8')), 'hex') = live.text_hash
    )
    SELECT fee_published_id, fee_verified_id, institution_id, fee_name, amount, canonical_fee_key, excerpt,
           substr(normalized_text, greatest(1, at - ${WORKED_EXAMPLE_WINDOW}::int), least(at - 1, ${WORKED_EXAMPLE_WINDOW}::int)) AS text_before
      FROM placed
     WHERE at > 0
       AND substr(normalized_text, greatest(1, at - ${WORKED_EXAMPLE_WINDOW}::int), least(at - 1, ${WORKED_EXAMPLE_WINDOW}::int)) ~* ${WORKED_EXAMPLE_PREFILTER}
     ORDER BY fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckWorkedExamples(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<WorkedExampleResult> {
  const live = options.live ?? WORKED_EXAMPLE_TAKEDOWN_LIVE;
  const result: WorkedExampleResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, matched: 0, institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [],
  };

  let rows: WorkedExampleRow[];
  try {
    rows = await inSavepoint(db, (scope) => workedExampleRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] worked example check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findWorkedExamples(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: WORKED_EXAMPLE_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && result.matched > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${WORKED_EXAMPLE_CHECK}, 'completed',
          ${`Read live fees that are a worked example's figure: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(workedExampleDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] worked example check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: WorkedExampleMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-worked-example-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[],
                      ${fees.map((fee) => fee.amount)}::numeric[])
               AS v(fee_published_id, reason, amount)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.amount = v.amount
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${WORKED_EXAMPLE_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${WORKED_EXAMPLE_FLAG}::text)
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
    console.error("[darwin] worked example takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: WorkedExampleMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.worked_example_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) that are a worked example's figure, on their second look`},
        ${JSON.stringify({ version: WORKED_EXAMPLE_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] worked example takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: WorkedExampleMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_line: fee.sourceLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function workedExampleDetail(result: WorkedExampleResult) {
  return {
    check: WORKED_EXAMPLE_CHECK,
    version: WORKED_EXAMPLE_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
