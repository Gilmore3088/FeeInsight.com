import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { AMOUNT_PATTERN, priceAfterNoFeeSentence } from "@/lib/agents/knox/rules";
import { storedLine } from "@/lib/agents/darwin/rate-floor-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees priced by a figure whose own sentence names no fee, after a sentence
 * that says there is no such fee (Hamilton proof run, Oct 30; decision 2026-10-15, "Darwin re-checks
 * every live fee against today's rules"). ESL FCU's Free Checking page (institution 6843, document
 * 21968) says "There are no minimum balance requirements or monthly service fees. And you can get
 * started with only a $1 deposit."; live fee 68597 published the $1 opening deposit as a $1 monthly
 * maintenance fee. Knox v143 no longer reads such a price (`priceAfterNoFeeSentence`, rules pass and
 * family experts), but the fees read before stay live: Hamilton's rules re-check keeps a fee whose
 * name and price still trace in its text ("disputed"), and this one does.
 *
 * Each verify step reads every live flat fee above $0 whose stored line (Knox's `excerpt="..."`) has
 * "no" and a sentence break before a price (the SQL prefilter), and `noFeeSentenceMatch` decides on
 * the line with Knox's own test: the line is not a table row, it prints the fee's price, and the
 * price's sentence names no fee while an earlier sentence on the line says "no ... fees". An
 * institution-scoped run reads that institution's only. Switched on, a match goes through the shared
 * 12-hour second look (check `darwin.no_fee_sentence`) and is archived on its second failure: rolled
 * back with `no_fee_sentence: <price> follows "<sentence>"`, its verified row rejected with the
 * `no_fee_sentence` flag so publish does not bring it back, never deleted, and a
 * `darwin.no_fee_sentence_takedown` event lists them. In a dry run, or with the switch off, the step
 * only reports.
 *
 * Dry run, prod read-only, 2026-10-30 (re-run Oct 31, admin-corrected fees excluded): the prefilter
 * selects 19 live fees whose stored line has a "no ... fee" sentence before the price's sentence, none
 * admin-corrected; 1 matches (68597, ESL FCU's $1 deposit). The other 18 name their fee in the price's own sentence ("If not met $5 Service Charge", "Paper Statement fee is
 * $3") and are kept. See docs/project/findings/2026-10-30-no-fee-sentence-and-od-transfer-unit.md.
 */
export const NO_FEE_SENTENCE_CHECK = "darwin.no_fee_sentence";
export const NO_FEE_SENTENCE_CHECK_VERSION = 1;
/** The switch, off: on takes matches down after the second look; off only reports. */
export const NO_FEE_SENTENCE_TAKEDOWN_LIVE = false;
export const NO_FEE_SENTENCE_REASON = "no_fee_sentence";
export const NO_FEE_SENTENCE_FLAG = "no_fee_sentence";
export const NO_FEE_SENTENCE_LIMIT = 2_000;
export const NO_FEE_SENTENCE_SAMPLES = 20;

export interface NoFeeSentenceRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  source_line: string | null;
}

export interface NoFeeSentenceMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  sourceLine: string;
  reason: string;
}

export interface NoFeeSentenceFindings {
  checked: number;
  matched: number;
  institutions: number;
  samples: NoFeeSentenceMatch[];
}

export interface NoFeeSentenceResult extends NoFeeSentenceFindings {
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

/**
 * Pure: whether a live fee's stored line is a price after a "no ... fees" sentence, read with Knox
 * v143's own test at each place the line prints the fee's price. A table row is never one.
 */
export function noFeeSentenceMatch(line: string, amount: number): { before: string } | null {
  if (!line || line.includes(" | ")) return null;
  for (const match of line.matchAll(new RegExp(AMOUNT_PATTERN.source, "g"))) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) continue;
    const start = match.index ?? 0;
    const before = line.slice(0, start);
    if (priceAfterNoFeeSentence(before, line.slice(start + match[0].length))) return { before };
  }
  return null;
}

function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** Pure: the matches among the rows the read selected. */
export function findNoFeeSentences(rows: NoFeeSentenceRow[]): NoFeeSentenceFindings & { matches: NoFeeSentenceMatch[] } {
  const matches: NoFeeSentenceMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const amount = num(row.amount);
    const line = storedLine(row.source_line);
    if (amount == null || amount <= 0) continue;
    const found = noFeeSentenceMatch(line, amount);
    if (!found) continue;
    const sentence = found.before.trim().split(/(?<=[.!?])\s+/).filter((part) => /\bno\b/i.test(part)).at(-1) ?? "";
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: (row.fee_name ?? "").trim(),
      amount,
      canonicalFeeKey: row.canonical_fee_key,
      sourceLine: line.slice(0, 300),
      reason: `${NO_FEE_SENTENCE_REASON}: ${dollars(amount)} follows "${sentence.slice(0, 120)}"`,
    });
  }
  return {
    checked: seen.size,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, NO_FEE_SENTENCE_SAMPLES),
    matches,
  };
}

/** Postgres pre-filter on Knox's stored note: "no", then a sentence break, then a price. */
export const NO_FEE_SENTENCE_PREFILTER = String.raw`excerpt=.*\mno\s.*(fees?|charges?)\M.*[.!?;]\s+[A-Z].*\$`;

/** Read-only: every live flat fee above $0 whose stored line passes the pre-filter. */
export function noFeeSentenceRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? NO_FEE_SENTENCE_LIMIT, 10_000));
  return db<NoFeeSentenceRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key, fr.extraction_note AS source_line
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount_kind = 'flat'
       AND fp.amount > 0
       AND fr.extraction_note ~* ${NO_FEE_SENTENCE_PREFILTER}
       -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
       AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckNoFeeSentences(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<NoFeeSentenceResult> {
  const live = options.live ?? NO_FEE_SENTENCE_TAKEDOWN_LIVE;
  const result: NoFeeSentenceResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, matched: 0, institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [],
  };

  let rows: NoFeeSentenceRow[];
  try {
    rows = await inSavepoint(db, (scope) => noFeeSentenceRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] no-fee sentence check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findNoFeeSentences(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: NO_FEE_SENTENCE_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${NO_FEE_SENTENCE_CHECK}, 'completed',
          ${`Read live fees priced after a "no ... fees" sentence: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(noFeeSentenceDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] no-fee sentence check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: NoFeeSentenceMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-no-fee-sentence-${runId}`},
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
                   WHEN fv.outlier_flags ? ${NO_FEE_SENTENCE_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${NO_FEE_SENTENCE_FLAG}::text)
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
    console.error("[darwin] no-fee sentence takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: NoFeeSentenceMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.no_fee_sentence_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) priced after a "no ... fees" sentence, on their second look`},
        ${JSON.stringify({ version: NO_FEE_SENTENCE_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] no-fee sentence takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: NoFeeSentenceMatch) {
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
export function noFeeSentenceDetail(result: NoFeeSentenceResult) {
  return {
    check: NO_FEE_SENTENCE_CHECK,
    version: NO_FEE_SENTENCE_CHECK_VERSION,
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
