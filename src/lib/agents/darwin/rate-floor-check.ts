import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { RATE_FLOOR_GREATER_SQL, RATE_FLOOR_PERCENT_SQL, rateFloorOf } from "@/lib/rate-floor";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of flat fees that are the floor of a percentage charge (#1615; decision
 * 2026-10-15, "Darwin re-checks every live fee against today's rules"). Knox v118 no longer reads them
 * (`rateFloorOf` in `@/lib/rate-floor`), but the ones read before stay live: "Cash Advance | Either
 * $5.00 or 3% of the amount of each cash advance, whichever is greater" went live as a flat $5, and
 * Patriot FCU's "5% of the monthly payment or $35.00 whichever is greater" as a flat $35 twice (taken
 * down by hand in #1613). The figure is the least the charge can be; the charge is the percentage,
 * which belongs in the rate catalog with the figure as its `rate_min_amount`.
 *
 * Each verify step reads every live flat fee whose stored line carries greater-of wording and a
 * percentage (the SQL prefilter), and `rateFloorOf` decides on the fee's name and line. An
 * institution-scoped run reads that institution's only. Each match says whether the bank's same-category
 * rate fee at that percentage is already live (`rateTwinLive`); a takedown never adds a rate fee, which
 * comes from Knox's v118 re-read of the bank's text. Switched on, a match goes through the shared
 * 12-hour second look (check `darwin.rate_floor`) and is archived on its second failure: rolled back
 * with `rate_floor: <rate>% or $<floor>`, its verified row rejected with the `rate_floor` flag so
 * publish does not bring it back, never deleted, and a `darwin.rate_floor_takedown` event lists them.
 * In a dry run, or with the switch off, the step only reports.
 *
 * Dry run, prod read-only, 2026-10-25 (fixture `__fixtures__/rate-floor-live-2026-10-25.json`): the
 * prefilter selects 58 live flat fees at 53 institutions, and 53 at 48 institutions are such floors,
 * 2 of them beside the bank's live rate fee at that percentage (13406, 68415). 4 are kept because the
 * fee's own price stands alone and the floor on the line is another fee's (20404, 132118, 53988,
 * 83788). 1 is missed: 80150 is a floor (stored text 242, "C a sh Adva nce. ......$5.00 or 2% whichever
 * is great er"), missed for a misaligned excerpt and spaced OCR text. The switch is on since James's
 * yes (2026-10-26, sampled-clean rule, DECISIONS 2026-10-20).
 */
export const RATE_FLOOR_CHECK = "darwin.rate_floor";
export const RATE_FLOOR_CHECK_VERSION = 1;
/** The switch: on takes matches down after the second look; off only reports. */
export const RATE_FLOOR_TAKEDOWN_LIVE = true;
export const RATE_FLOOR_REASON = "rate_floor";
export const RATE_FLOOR_FLAG = "rate_floor";
export const RATE_FLOOR_LIMIT = 1_000;
export const RATE_FLOOR_SAMPLES = 20;

export interface RateFloorRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  source_line: string | null;
  live_rates: (number | string)[] | null;
}

export interface RateFloorMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  ratePercent: number;
  rateTwinLive: boolean;
  clause: string;
  reason: string;
}

export interface RateFloorFindings {
  checked: number;
  matched: number;
  institutions: number;
  rateTwinLive: number;
  samples: RateFloorMatch[];
}

export interface RateFloorResult extends RateFloorFindings {
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

/** The excerpt Knox stored in its extraction note (`... excerpt="<line>"`), unquoted. */
export function storedLine(note: string | null | undefined): string {
  const line = /excerpt=([\s\S]*)$/.exec(note ?? "")?.[1] ?? note ?? "";
  return line.trim().replace(/^"|"$/g, "");
}

function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/**
 * Pure: the matches among the rows the read selected. The SQL selects by the words only; `rateFloorOf`
 * decides on the fee's own name and line, the same test Knox applies.
 */
export function findRateFloors(rows: RateFloorRow[]): RateFloorFindings & { matches: RateFloorMatch[] } {
  const matches: RateFloorMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const name = (row.fee_name ?? "").trim();
    const floor = rateFloorOf(storedLine(row.source_line), row.amount, name);
    if (!floor) continue;
    const rateTwinLive = (row.live_rates ?? []).some((rate) => Math.abs(Number(rate) - floor.ratePercent) < 0.0001);
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      amount: floor.floor,
      canonicalFeeKey: row.canonical_fee_key,
      ratePercent: floor.ratePercent,
      rateTwinLive,
      clause: floor.clause.slice(0, 200),
      reason: `${RATE_FLOOR_REASON}: ${floor.ratePercent}% or ${dollars(floor.floor)}, whichever is greater`,
    });
  }
  return {
    checked: seen.size,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    rateTwinLive: matches.filter((fee) => fee.rateTwinLive).length,
    samples: matches.slice(0, RATE_FLOOR_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live flat fee whose stored line carries greater-of wording and a percentage, with the
 * rates of the bank's live rate fees in the same category.
 */
export function rateFloorRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? RATE_FLOOR_LIMIT, 5_000));
  return db<RateFloorRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key, fr.extraction_note AS source_line,
           ARRAY(
             SELECT DISTINCT rate.rate_percent
               FROM published_fee_records rate
              WHERE rate.institution_id = fp.institution_id
                AND rate.canonical_fee_key = fp.canonical_fee_key
                AND rate.amount_kind = 'percent'
                AND rate.rolled_back_at IS NULL
                AND rate.quarantined_at IS NULL
                AND rate.rate_percent IS NOT NULL
           ) AS live_rates
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount_kind = 'flat'
       AND fp.amount > 0
       AND fr.extraction_note ~* ${RATE_FLOOR_GREATER_SQL}
       AND fr.extraction_note ~* ${RATE_FLOOR_PERCENT_SQL}
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckRateFloors(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<RateFloorResult> {
  const live = options.live ?? RATE_FLOOR_TAKEDOWN_LIVE;
  const result: RateFloorResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, matched: 0, institutions: 0, rateTwinLive: 0, samples: [], flagged: 0, waiting: 0, takenDown: [],
  };

  let rows: RateFloorRow[];
  try {
    rows = await inSavepoint(db, (scope) => rateFloorRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] rate floor check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findRateFloors(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: RATE_FLOOR_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${RATE_FLOOR_CHECK}, 'completed',
          ${`Read live flat fees for a percentage charge's floor: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s), ${result.rateTwinLive} with the rate fee live; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(rateFloorDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] rate floor check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: RateFloorMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-rate-floor-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
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
                   WHEN fv.outlier_flags ? ${RATE_FLOOR_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${RATE_FLOOR_FLAG}::text)
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
    console.error("[darwin] rate floor takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: RateFloorMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.rate_floor_takedown', 'completed',
        ${`Archived ${archived.length} live flat fee(s) that are a percentage charge's floor, on their second look`},
        ${JSON.stringify({ version: RATE_FLOOR_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] rate floor takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: RateFloorMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    rate_percent: fee.ratePercent,
    rate_twin_live: fee.rateTwinLive,
    clause: fee.clause,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function rateFloorDetail(result: RateFloorResult) {
  return {
    check: RATE_FLOOR_CHECK,
    version: RATE_FLOOR_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    matched: result.matched,
    institutions: result.institutions,
    rate_twin_live: result.rateTwinLive,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
