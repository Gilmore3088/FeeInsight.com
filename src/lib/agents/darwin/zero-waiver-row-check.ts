import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { zeroWaiverRowRead, type ZeroWaiverRowKind } from "@/lib/zero-waiver-row";
import { storedLine } from "./rate-floor-check";
import { sourceLineFor } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of $0 fees read from a line that is no priced row (#1092; decision
 * 2026-10-15, "Darwin re-checks every live fee against today's rules"). Knox v163 holds such a $0 for
 * review and Darwin's verify refuses it (`zero_waiver_row`), both through `@/lib/zero-waiver-row`; the
 * ones read before stay live. The shadow lab on main f57e0eae9 found four such fees among its 33
 * known-wrong publications: "No Fee for Cashier's Checks" (live 56853, 64330) and "No Fee for Stop
 * Payments" (64331), items of an account's list of free items read as the bank's $0 cashier's check and
 * stop payment fees, and "Minimum Balance required to avoid a Service Charge / FREE" (102158), the
 * balance row of an account table read as a $0 service charge. The rule takes 56853 and 102158;
 * 64330 and 64331's stored text names no account or package above its list, and a list with no such
 * lead is the bank's own schedule to this rule (review of #2938), so they stay as known misses.
 *
 * Each verify step reads every live flat $0 fee whose stored line (Knox's `excerpt="..."`) opens with
 * "no fee for / no charge on" or says "to avoid / to waive" (the SQL prefilter), or (v2, Knox v168) says
 * "free" on a text with a "Ways to Avoid" heading line (`avoid_fee_advice`), then the text Knox
 * read (the artifact its note names). `zeroWaiverRowRead` decides, the test verify applies: Knox's
 * line must be a no-fee item of a list of free items, or a balance or requirement row, and so must the
 * line `checkFeeAgainstSource` traces the fee to (`sourceLineFor`, Darwin's own trace). A fee whose
 * text is gone is not judged. An admin-corrected fee is never read. An institution-scoped run reads
 * that institution's only. Switched on (`ZERO_WAIVER_ROW_TAKEDOWN_LIVE`), a match goes through the
 * shared 12-hour second look (check `darwin.zero_waiver_row`) and is archived on its second failure:
 * rolled back with `zero_waiver_row: <kind>, "<line>"`, its verified row rejected with the
 * `zero_waiver_row` flag so publish does not bring it back, never deleted, and a
 * `darwin.zero_waiver_row_takedown` event lists them. In a dry run, or with the switch off (the
 * default), it only reports. Count it with `npm run audit:switch-dry-runs` (section 7) first.
 */
export const ZERO_WAIVER_ROW_CHECK = "darwin.zero_waiver_row";
/** v2 (Knox v168, Nov 2): also reads a free word's advice cell in a "Ways to Avoid" section (`avoid_fee_advice`). */
export const ZERO_WAIVER_ROW_CHECK_VERSION = 2;
/** The switch: off, the step only reports; on, matches come down after the second look. */
export const ZERO_WAIVER_ROW_TAKEDOWN_LIVE = false;
export const ZERO_WAIVER_ROW_REASON = "zero_waiver_row";
export const ZERO_WAIVER_ROW_FLAG = "zero_waiver_row";
export const ZERO_WAIVER_ROW_LIMIT = 2_000;
export const ZERO_WAIVER_ROW_SAMPLES = 20;
/** Texts read per query, so one read never holds every candidate's text at once. */
const TEXT_CHUNK = 50;

/** Postgres pre-filter on Knox's stored line: a no-fee opening, or "to avoid" / "to waive". */
export const ZERO_WAIVER_ROW_PREFILTER = String.raw`excerpt="\s*([-*•·▪◦●]\s*)?((no|without)[ -](fee|charge|cost)s?\s+(for|on)\s|[^"]*\mto\s+(avoid|waive)\M)`;
/** v2: a stored line with a free word, read only when its text has a "Ways to Avoid" heading line (`AVOID_FEES_HEADING`). */
export const ZERO_WAIVER_ROW_FREE_PREFILTER = String.raw`excerpt="[^"]*\mfree\M`;
/** v2: Postgres mirror of `AVOID_FEES_HEADING` on a line of its own (a pre-filter; `avoidFeeAdvice` decides). */
export const AVOID_FEES_HEADING_SQL =
  String.raw`(^|\n)[ \t]*(ways|how|tips?)[ \t]+to[ \t]+(avoid|reduce)([ \t]+(or[ \t]+reduce[ \t]+)?((the|these|your|banking|account)[ \t]+)?(fees?|charges?|service[ \t]+charges?))?[ \t]*:?[ \t]*(\n|$)`;

export interface ZeroWaiverRowLiveRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  canonical_fee_key: string | null;
  /** Knox's extraction note, whose excerpt is the stored line. */
  source_line: string | null;
  /** The artifact the note names: the text Knox read. */
  artifact_id: number | string | null;
}

export interface ZeroWaiverRowMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  canonicalFeeKey: string | null;
  kind: ZeroWaiverRowKind;
  sourceLine: string;
  tracedLine: string | null;
  reason: string;
}

export interface ZeroWaiverRowFindings {
  checked: number;
  /** Candidates whose text is gone: not judged. */
  noText: number;
  matched: number;
  institutions: number;
  byKind: Record<ZeroWaiverRowKind, number>;
  samples: ZeroWaiverRowMatch[];
}

export interface ZeroWaiverRowResult extends ZeroWaiverRowFindings {
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
 * Pure: the matches among the rows the read selected, each judged on its own text (`texts`, by
 * artifact id) the way verify judges a new read: Knox's line and Darwin's traced line.
 */
export function findZeroWaiverRows(
  rows: readonly ZeroWaiverRowLiveRow[],
  texts: ReadonlyMap<number, string>,
): ZeroWaiverRowFindings & { matches: ZeroWaiverRowMatch[] } {
  const matches: ZeroWaiverRowMatch[] = [];
  const seen = new Set<number>();
  let noText = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const artifactId = num(row.artifact_id);
    const text = artifactId == null ? undefined : texts.get(artifactId);
    if (!text) {
      noText += 1;
      continue;
    }
    const name = (row.fee_name ?? "").trim();
    const line = row.source_line ? storedLine(row.source_line) : "";
    const tracedLine = sourceLineFor(
      { fee_name: name, amount: 0, source_document_id: artifactId, amount_kind: "flat", rate_percent: null },
      new Map([[artifactId as number, text]]),
      row.canonical_fee_key,
    );
    const found = zeroWaiverRowRead({ excerpt: line, tracedLine, amount: 0, documentText: text });
    if (!found) continue;
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      canonicalFeeKey: row.canonical_fee_key,
      kind: found.kind,
      sourceLine: line.slice(0, 300),
      tracedLine: tracedLine ? tracedLine.slice(0, 300) : null,
      reason: `${ZERO_WAIVER_ROW_REASON}: ${found.kind}, "${found.label.slice(0, 120)}"`,
    });
  }
  return {
    checked: seen.size,
    noText,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    byKind: {
      no_fee_sentence: matches.filter((fee) => fee.kind === "no_fee_sentence").length,
      waiver_requirement: matches.filter((fee) => fee.kind === "waiver_requirement").length,
      avoid_fee_advice: matches.filter((fee) => fee.kind === "avoid_fee_advice").length,
    },
    samples: matches.slice(0, ZERO_WAIVER_ROW_SAMPLES),
    matches,
  };
}

/** The most rows one read returns. */
export const ZERO_WAIVER_ROW_MAX_ROWS = 10_000;

/**
 * Read-only: every live flat $0 fee whose stored line passes the pre-filter, with the artifact Knox
 * read. `institutionId` (the verify step's scope) or `institutionIds` (the switch dry-run audit's) narrow it.
 */
export function zeroWaiverRowRowsSql(db: SqlTag, options: { institutionId?: number; institutionIds?: readonly number[] | null; limit?: number } = {}) {
  const ids = options.institutionId != null ? [options.institutionId] : options.institutionIds?.length ? [...options.institutionIds] : null;
  const scoped = ids != null;
  const limit = Math.max(1, Math.min(options.limit ?? ZERO_WAIVER_ROW_LIMIT, ZERO_WAIVER_ROW_MAX_ROWS));
  return db<ZeroWaiverRowLiveRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.fee_name,
           fp.canonical_fee_key, fr.extraction_note AS source_line,
           (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint AS artifact_id
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount_kind = 'flat'
       AND fp.amount = 0
       AND (fr.extraction_note ~* ${ZERO_WAIVER_ROW_PREFILTER}
            OR (fr.extraction_note ~* ${ZERO_WAIVER_ROW_FREE_PREFILTER}
                AND EXISTS (SELECT 1 FROM agent_source_texts avoid_text
                             WHERE avoid_text.id = (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint
                               AND avoid_text.normalized_text ~* ${AVOID_FEES_HEADING_SQL})))
       -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
       AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
       AND (${!scoped} OR fp.institution_id = ANY(${ids ?? [0]}::bigint[]))
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Read-only: the texts Knox read, by artifact id. */
export async function zeroWaiverRowTexts(db: SqlTag, artifactIds: readonly number[]): Promise<Map<number, string>> {
  const texts = new Map<number, string>();
  const ids = [...new Set(artifactIds)];
  for (let start = 0; start < ids.length; start += TEXT_CHUNK) {
    const chunk = ids.slice(start, start + TEXT_CHUNK);
    const rows = await db<{ id: number | string; normalized_text: string | null }[]>`
      SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${chunk}::bigint[]) AND normalized_text IS NOT NULL
    `;
    for (const row of rows) if (row.normalized_text) texts.set(Number(row.id), row.normalized_text);
  }
  return texts;
}

function emptyResult(live: boolean, dryRun: boolean, scoped: boolean): ZeroWaiverRowResult {
  return {
    live, dryRun, scoped, checked: 0, noText: 0, matched: 0, institutions: 0,
    byKind: { no_fee_sentence: 0, waiver_requirement: 0, avoid_fee_advice: 0 }, samples: [], flagged: 0, waiting: 0, takenDown: [],
  };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckZeroWaiverRows(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<ZeroWaiverRowResult> {
  const live = options.live ?? ZERO_WAIVER_ROW_TAKEDOWN_LIVE;
  const result = emptyResult(live, options.dryRun, options.institutionId != null);

  let rows: ZeroWaiverRowLiveRow[];
  let texts: Map<number, string>;
  try {
    rows = await inSavepoint(db, (scope) => zeroWaiverRowRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
    const artifactIds = rows.map((row) => num(row.artifact_id)).filter((id): id is number => id != null);
    texts = await inSavepoint(db, (scope) => zeroWaiverRowTexts(scope, artifactIds));
  } catch (error) {
    console.warn("[darwin] zero waiver row check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findZeroWaiverRows(rows, texts);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: ZERO_WAIVER_ROW_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${ZERO_WAIVER_ROW_CHECK}, 'completed',
          ${`Read live $0 fees from a no-fee item or a waiver row: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(zeroWaiverRowDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] zero waiver row check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: ZeroWaiverRowMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-zero-waiver-row-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.amount = 0
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
                   WHEN fv.outlier_flags ? ${ZERO_WAIVER_ROW_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${ZERO_WAIVER_ROW_FLAG}::text)
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
    console.error("[darwin] zero waiver row takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: ZeroWaiverRowMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.zero_waiver_row_takedown', 'completed',
        ${`Archived ${archived.length} live $0 fee(s) read from a no-fee item or a waiver row, on their second look`},
        ${JSON.stringify({ version: ZERO_WAIVER_ROW_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] zero waiver row takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: ZeroWaiverRowMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    canonical_fee_key: fee.canonicalFeeKey,
    kind: fee.kind,
    source_line: fee.sourceLine,
    traced_line: fee.tracedLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function zeroWaiverRowDetail(result: ZeroWaiverRowResult) {
  return {
    check: ZERO_WAIVER_ROW_CHECK,
    version: ZERO_WAIVER_ROW_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    no_text: result.noText,
    matched: result.matched,
    institutions: result.institutions,
    by_kind: result.byKind,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
