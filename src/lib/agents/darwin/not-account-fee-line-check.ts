import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { DIVIDEND_THRESHOLD_SQL, dividendThresholdSentence } from "@/lib/dividend-threshold";
import { onlineServiceMonthlyFee } from "@/lib/service-monthly-charge";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of two lines Knox v170 no longer reads as an account fee (Knox re-read backlog
 * dry run 3, Nov 2; decision 2026-10-15, "Darwin re-checks every live fee against today's rules"). Knox
 * drops new ones and Darwin's verify refuses them; the ones read before stay live:
 *
 * - `dividend_threshold`: a rate disclosure's balance threshold read as a fee, on Knox's own line
 *   (`dividendThresholdSentence`). Peninsula Community FCU's "If your average daily balance is below
 *   $100.00 ($5.00 for accounts held by those under 18 years of age), no dividends are earned" is live
 *   as a $5 minimum balance fee (73916).
 * - `online_service_monthly`: a monthly maintenance fee whose own line sits in a section of online,
 *   electronic or digital services (`onlineServiceMonthlyFee`, read on the text Knox read). University
 *   of Virginia Community CU's "| Monthly fee | No charge |" under "Personal Online Banking Fees" is live
 *   as $0 monthly maintenance (152003); no type of the 50 holds online banking's own charge.
 *
 * Each verify step reads every live flat fee whose stored line (Knox's `excerpt="..."`) carries the
 * no-earnings words (`DIVIDEND_THRESHOLD_SQL`), and every live flat monthly maintenance fee whose name
 * says monthly or maintenance and names no account, on a text that prints an online services section
 * title (`ONLINE_SECTION_SQL`). An admin-corrected fee is never read; a fee whose text is gone is not
 * judged for the section rule. An institution-scoped run reads that institution's only. Switched on
 * (`NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE`), a match goes through the shared 12-hour second look (check
 * `darwin.not_account_fee_line`) and is archived on its second failure: rolled back with its reason, its
 * verified row rejected with the reason's flag so publish does not bring it back, never deleted, and a
 * `darwin.not_account_fee_line_takedown` event lists them. In a dry run, or with the switch off (the
 * default), it only reports.
 *
 * Dry run, prod read-only, 2026-11-02 (this module's read and `findNotAccountFeeLines` on the texts): of
 * 493 live candidates, 2 match, 73916 (dividend threshold) and 152003 (online service monthly).
 */
export const NOT_ACCOUNT_FEE_LINE_CHECK = "darwin.not_account_fee_line";
export const NOT_ACCOUNT_FEE_LINE_CHECK_VERSION = 1;
/** The switch: off, the step only reports; on, matches come down after the second look. */
export const NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE = false;
export const DIVIDEND_THRESHOLD_REASON = "dividend_threshold";
export const ONLINE_SERVICE_MONTHLY_REASON = "online_service_monthly";
export const NOT_ACCOUNT_FEE_LINE_LIMIT = 5_000;
export const NOT_ACCOUNT_FEE_LINE_SAMPLES = 20;
export const NOT_ACCOUNT_FEE_LINE_MAX_ROWS = 10_000;
const TEXT_CHUNK = 50;

/** Postgres: a text that prints an online services section title on a line of its own. */
export const ONLINE_SECTION_SQL = String.raw`(?n)^\s*((personal|business|consumer)\s+)?(online|internet|electronic|digital|e-?|mobile)(\s*(&|and|/)\s*(online|internet|electronic|digital|mobile))?\s*(banking\s+)?(fees?|charges?|services?(\s+fees?)?)\s*:?\s*$`;
/** Postgres: a monthly maintenance name that says monthly or maintenance and names no account. */
const MONTHLY_NAME_SQL = String.raw`(monthly|per\s+month|maintenance)`;
const ACCOUNT_NAME_SQL = String.raw`\m(checking|savings|share|money\s+market|club|drafts?|accounts?|certificates?|ira|now)\M`;

export interface NotAccountFeeLineRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  /** Knox's extraction note, whose excerpt is the stored line. */
  source_line: string | null;
  /** The artifact the note names: the text Knox read. */
  artifact_id: number | string | null;
}

export interface NotAccountFeeLineMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  kind: typeof DIVIDEND_THRESHOLD_REASON | typeof ONLINE_SERVICE_MONTHLY_REASON;
  /** The sentence (dividend threshold) or the section title (online service). */
  evidence: string;
  reason: string;
}

export interface NotAccountFeeLineFindings {
  checked: number;
  /** Section candidates whose text is gone: not judged. */
  noText: number;
  matched: number;
  dividendThreshold: number;
  onlineServiceMonthly: number;
  institutions: number;
  samples: NotAccountFeeLineMatch[];
}

export interface NotAccountFeeLineResult extends NotAccountFeeLineFindings {
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

/** Pure: the matches among the rows the read selected, the section rule on each row's own text (by artifact id). */
export function findNotAccountFeeLines(
  rows: readonly NotAccountFeeLineRow[],
  texts: ReadonlyMap<number, string>,
): NotAccountFeeLineFindings & { matches: NotAccountFeeLineMatch[] } {
  const matches: NotAccountFeeLineMatch[] = [];
  const seen = new Set<number>();
  let noText = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const amount = num(row.amount);
    if (amount == null || amount < 0) continue;
    const name = (row.fee_name ?? "").trim();
    const line = excerptOf(row.source_line);
    const base = {
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      amount,
      canonicalFeeKey: row.canonical_fee_key,
    };
    const sentence = amount > 0 ? dividendThresholdSentence(line, amount) : null;
    if (sentence) {
      matches.push({ ...base, kind: DIVIDEND_THRESHOLD_REASON, evidence: sentence.slice(0, 300), reason: `${DIVIDEND_THRESHOLD_REASON}: "${sentence.slice(0, 120)}"` });
      continue;
    }
    if (row.canonical_fee_key !== "monthly_maintenance") continue;
    const artifactId = num(row.artifact_id);
    const text = artifactId == null ? undefined : texts.get(artifactId);
    if (!text) {
      noText += 1;
      continue;
    }
    const section = onlineServiceMonthlyFee(name, line, text);
    if (!section) continue;
    matches.push({ ...base, kind: ONLINE_SERVICE_MONTHLY_REASON, evidence: section.slice(0, 160), reason: `${ONLINE_SERVICE_MONTHLY_REASON}: "${name.slice(0, 80)}" under "${section.slice(0, 80)}"` });
  }
  return {
    checked: seen.size,
    noText,
    matched: matches.length,
    dividendThreshold: matches.filter((fee) => fee.kind === DIVIDEND_THRESHOLD_REASON).length,
    onlineServiceMonthly: matches.filter((fee) => fee.kind === ONLINE_SERVICE_MONTHLY_REASON).length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, NOT_ACCOUNT_FEE_LINE_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live flat fee whose stored line carries the no-earnings words, and every live flat
 * monthly maintenance fee named as a monthly charge for no account on a text that prints an online
 * services section title, with the artifact Knox read.
 */
export function notAccountFeeLineRowsSql(db: SqlTag, options: { institutionId?: number; institutionIds?: readonly number[] | null; limit?: number } = {}) {
  const ids = options.institutionId != null ? [options.institutionId] : options.institutionIds?.length ? [...options.institutionIds] : null;
  const scoped = ids != null;
  const limit = Math.max(1, Math.min(options.limit ?? NOT_ACCOUNT_FEE_LINE_LIMIT, NOT_ACCOUNT_FEE_LINE_MAX_ROWS));
  return db<NotAccountFeeLineRow[]>`
    WITH live AS (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.fee_name, fp.amount,
             fp.canonical_fee_key, fr.extraction_note AS source_line,
             (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint AS artifact_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.amount >= 0
         -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
         AND (${!scoped} OR fp.institution_id = ANY(${ids ?? [0]}::bigint[]))
    ),
    dividend AS (
      SELECT * FROM live WHERE live.amount > 0 AND live.source_line ~* ${DIVIDEND_THRESHOLD_SQL}
    ),
    monthly AS (
      SELECT * FROM live
       WHERE live.canonical_fee_key = 'monthly_maintenance'
         AND live.fee_name ~* ${MONTHLY_NAME_SQL}
         AND live.fee_name !~* ${ACCOUNT_NAME_SQL}
    ),
    sectioned AS (
      SELECT a.id
        FROM agent_source_texts a
       WHERE a.id IN (SELECT DISTINCT artifact_id FROM monthly WHERE artifact_id IS NOT NULL)
         AND a.normalized_text ~* ${ONLINE_SECTION_SQL}
    )
    SELECT * FROM dividend
    UNION
    SELECT m.* FROM monthly m JOIN sectioned s ON s.id = m.artifact_id
     ORDER BY fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Read-only: the texts Knox read, by artifact id. */
export async function notAccountFeeLineTexts(db: SqlTag, artifactIds: readonly number[]): Promise<Map<number, string>> {
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

function emptyResult(live: boolean, dryRun: boolean, scoped: boolean): NotAccountFeeLineResult {
  return { live, dryRun, scoped, checked: 0, noText: 0, matched: 0, dividendThreshold: 0, onlineServiceMonthly: 0, institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [] };
}

/** One step's re-check (see the module note). Never throws: a failed read reports nothing, and a failed write leaves the fees as they were. */
export async function recheckNotAccountFeeLines(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<NotAccountFeeLineResult> {
  const live = options.live ?? NOT_ACCOUNT_FEE_LINE_TAKEDOWN_LIVE;
  const result = emptyResult(live, options.dryRun, options.institutionId != null);

  let rows: NotAccountFeeLineRow[];
  let texts: Map<number, string>;
  try {
    rows = await inSavepoint(db, (scope) => notAccountFeeLineRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
    const artifactIds = rows
      .filter((row) => row.canonical_fee_key === "monthly_maintenance")
      .map((row) => num(row.artifact_id))
      .filter((id): id is number => id != null);
    texts = await inSavepoint(db, (scope) => notAccountFeeLineTexts(scope, artifactIds));
  } catch (error) {
    console.warn("[darwin] not-account-fee line check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findNotAccountFeeLines(rows, texts);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: NOT_ACCOUNT_FEE_LINE_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${NOT_ACCOUNT_FEE_LINE_CHECK}, 'completed',
          ${`Read live fees whose line is no account fee: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s) (${result.dividendThreshold} dividend threshold, ${result.onlineServiceMonthly} online service monthly); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(notAccountFeeLineDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] not-account-fee line check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the reason's flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: NotAccountFeeLineMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-not-account-fee-line-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      for (const kind of [DIVIDEND_THRESHOLD_REASON, ONLINE_SERVICE_MONTHLY_REASON] as const) {
        const verified = fees.filter((fee) => fee.kind === kind && ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
        if (verified.length === 0) continue;
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${kind} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${kind}::text)
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
    console.error("[darwin] not-account-fee line takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: NotAccountFeeLineMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.not_account_fee_line_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) whose line is no account fee, on their second look`},
        ${JSON.stringify({ version: NOT_ACCOUNT_FEE_LINE_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] not-account-fee line takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: NotAccountFeeLineMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    kind: fee.kind,
    evidence: fee.evidence,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function notAccountFeeLineDetail(result: NotAccountFeeLineResult) {
  return {
    check: NOT_ACCOUNT_FEE_LINE_CHECK,
    version: NOT_ACCOUNT_FEE_LINE_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    no_text: result.noText,
    matched: result.matched,
    dividend_threshold: result.dividendThreshold,
    online_service_monthly: result.onlineServiceMonthly,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
