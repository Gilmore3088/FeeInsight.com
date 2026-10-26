import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { BANDED_ZERO_CATEGORIES, bandedZeroOf, type BandedZeroKind } from "@/lib/banded-zero";
import { storedLine } from "./rate-floor-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of $0 overdraft, NSF and continuous overdraft fees that are one band of a
 * priced fee, or the next column's free word beside the fee's own price (#1882; decision 2026-10-15,
 * "Darwin re-checks every live fee against today's rules").
 * Knox v122 holds such a $0 for review (`bandedZeroOf` in `@/lib/banded-zero`), but the ones read
 * before stay live: "Safety Net Overdraft | $0 if the negative balance is $5 or less. $10 if ... $35 per
 * item**" went live as the credit union's only overdraft price, $0. Darwin's own conditional-$0 test
 * passed it, since a price cell of more than four words is not read as the fee's
 * (`isPriceCell` in verify.ts), and a band printed on its own row is never on the fee's line.
 *
 * Each verify step reads every live $0 fee in those categories with the stored line Knox read and the
 * lines of the text Knox read (the extraction note's artifact) that carry the fee's name; `bandedZeroOf`
 * decides. An institution-scoped run reads that institution's only. Switched on, a match goes through
 * the shared 12-hour second look (check `darwin.banded_zero`) and is archived on its second failure:
 * rolled back with `banded_zero: <kind>, $<price>`, its verified row rejected with the `banded_zero`
 * flag so publish does not bring it back, never deleted, and a `darwin.banded_zero_takedown` event
 * lists them. A takedown adds no priced fee; that comes from Knox's re-read of the bank's text, where
 * the priced band is held as a range for review. In a dry run, or with the switch off, it only reports.
 *
 * Dry run, prod read-only, 2026-10-26 (fixture `__fixtures__/banded-zero-live-2026-10-26.json`, this
 * module's own SQL): of the 139 live $0 fees in the three categories, 4 match at 4 institutions, each
 * read against its bank's stored text and each not the fee's price: 99261 (institution 7374, "Item paid
 * in overdraft fee (Courtesy Pay) | N/C" for a negative balance of $0-$9.99, "up to 19.00" above it),
 * 108088 (6056, Safety Net Overdraft $0 / $10 / $35 by negative balance), 116439 (7358, Privilege Pay
 * "$0 for items ≤ $5", "$30 for overdrawing" in the account terms) and 149658 (5667, "Overdraft Fee |
 * $12.00 | Free", the next column's free row, beside the live $12 overdraft fee 16766). The first three
 * are the only live overdraft price at their institution. The switch stays off until a reviewer reads
 * them against each bank's stored text (sampled-clean rule, DECISIONS 2026-10-20).
 */
export const BANDED_ZERO_CHECK = "darwin.banded_zero";
export const BANDED_ZERO_CHECK_VERSION = 1;
/** The switch: off until the dry run is read clean. Set to true to take the matches down. */
export const BANDED_ZERO_TAKEDOWN_LIVE = true;
export const BANDED_ZERO_REASON = "banded_zero";
export const BANDED_ZERO_FLAG = "banded_zero";
export const BANDED_ZERO_LIMIT = 1_000;
export const BANDED_ZERO_SAMPLES = 20;

export interface BandedZeroRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  /** Knox's own name for the fee, the one its line prints. */
  fee_name: string | null;
  canonical_fee_key: string | null;
  source_line: string | null;
  /** Each line of the text Knox read that carries the fee's name, and the line after it, in order. */
  document_lines: string | null;
}

export interface BandedZeroMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  canonicalFeeKey: string | null;
  kind: BandedZeroKind;
  price: number;
  evidence: string;
  reason: string;
}

export interface BandedZeroFindings {
  checked: number;
  matched: number;
  institutions: number;
  byKind: Record<BandedZeroKind, number>;
  samples: BandedZeroMatch[];
}

export interface BandedZeroResult extends BandedZeroFindings {
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

/** Pure: the matches among the rows the read selected. `bandedZeroOf` decides, the same test Knox applies. */
export function findBandedZeros(rows: BandedZeroRow[]): BandedZeroFindings & { matches: BandedZeroMatch[] } {
  const matches: BandedZeroMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const name = (row.fee_name ?? "").trim();
    const band = bandedZeroOf({
      line: row.source_line ? storedLine(row.source_line) : null,
      feeName: name,
      canonicalFeeKey: row.canonical_fee_key,
      documentText: row.document_lines,
    });
    if (!band) continue;
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      canonicalFeeKey: row.canonical_fee_key,
      kind: band.kind,
      price: band.price,
      evidence: band.evidence,
      reason: `${BANDED_ZERO_REASON}: ${band.kind}, ${dollars(band.price)}`,
    });
  }
  return {
    checked: seen.size,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    byKind: {
      own_cell: matches.filter((fee) => fee.kind === "own_cell").length,
      own_row_price: matches.filter((fee) => fee.kind === "own_row_price").length,
      priced_twin_row: matches.filter((fee) => fee.kind === "priced_twin_row").length,
    },
    samples: matches.slice(0, BANDED_ZERO_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live $0 fee in a banded category, Knox's name and stored line for it, and the lines
 * of the text Knox read (the artifact its extraction note names) that carry that name.
 */
export function bandedZeroRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? BANDED_ZERO_LIMIT, 5_000));
  return db<BandedZeroRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.fee_name,
           fp.canonical_fee_key, fr.extraction_note AS source_line,
           (
             SELECT string_agg(w.doc_line, E'\n' ORDER BY w.n)
               FROM (
                 SELECT l.doc_line, l.n, lag(l.doc_line) OVER (ORDER BY l.n) AS prev_line
                   FROM agent_source_texts adt,
                        unnest(string_to_array(adt.normalized_text, E'\n')) WITH ORDINALITY AS l(doc_line, n)
                  WHERE adt.id = (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint
               ) w
              WHERE position(lower(regexp_replace(fr.fee_name, '\s+', ' ', 'g')) IN lower(regexp_replace(w.doc_line, '\s+', ' ', 'g'))) > 0
                 OR position(lower(regexp_replace(fr.fee_name, '\s+', ' ', 'g')) IN lower(regexp_replace(COALESCE(w.prev_line, ''), '\s+', ' ', 'g'))) > 0
           ) AS document_lines
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount = 0
       AND fp.canonical_fee_key = ANY(${[...BANDED_ZERO_CATEGORIES]}::text[])
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckBandedZeros(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<BandedZeroResult> {
  const live = options.live ?? BANDED_ZERO_TAKEDOWN_LIVE;
  const result: BandedZeroResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, matched: 0, institutions: 0, byKind: { own_cell: 0, own_row_price: 0, priced_twin_row: 0 }, samples: [], flagged: 0, waiting: 0, takenDown: [],
  };

  let rows: BandedZeroRow[];
  try {
    rows = await inSavepoint(db, (scope) => bandedZeroRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] banded zero check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findBandedZeros(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: BANDED_ZERO_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${BANDED_ZERO_CHECK}, 'completed',
          ${`Read live $0 overdraft and NSF fees for one band of a priced fee: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(bandedZeroDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] banded zero check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: BandedZeroMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-banded-zero-${runId}`},
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
                   WHEN fv.outlier_flags ? ${BANDED_ZERO_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${BANDED_ZERO_FLAG}::text)
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
    console.error("[darwin] banded zero takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: BandedZeroMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.banded_zero_takedown', 'completed',
        ${`Archived ${archived.length} live $0 fee(s) that are one band of a priced overdraft or NSF fee, on their second look`},
        ${JSON.stringify({ version: BANDED_ZERO_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] banded zero takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: BandedZeroMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    canonical_fee_key: fee.canonicalFeeKey,
    kind: fee.kind,
    price: fee.price,
    evidence: fee.evidence,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function bandedZeroDetail(result: BandedZeroResult) {
  return {
    check: BANDED_ZERO_CHECK,
    version: BANDED_ZERO_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    matched: result.matched,
    institutions: result.institutions,
    by_kind: result.byKind,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
