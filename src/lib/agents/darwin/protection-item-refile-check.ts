import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { forLiveRelabel } from "@/lib/agents/knox/held-name-vocabulary";
import { bareProtectionName, PROTECTION_ITEM_TARGET, PROTECTION_TRANSFER_KEY } from "@/lib/agents/knox/protection-item";
import { checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of bare "Overdraft Protection" fees filed as the overdraft protection
 * transfer whose own schedule makes them the paid-overdraft item fee (Knox v150, `protection-item.ts`;
 * decision 2026-10-15, "Darwin re-checks every live fee against today's rules"). Alcose CU prints
 * "Overdraft Transfers $2.00" and then "Overdraft Protection $30.00 per item" with no other overdraft
 * fee (document 14159); since the bare-name transfer pattern, every read filed the $30 line as the
 * transfer. Knox v150 reads it as the overdraft fee, but only on new reads; the ones already live as
 * the transfer stay there unless this check moves them.
 *
 * Each verify step reads every live, flat `od_protection_transfer` fee whose name is a bare protection
 * name (the SQL pre-filter, `bareProtectionName` again in code) with its source document's latest
 * stored text, and reads that text again with today's free Knox team (`runFreeSpecialists`, rules
 * only, no provider call). `protectionItemVerdict`:
 * - `refile`: a read of the text under the fee's name and at its price is filed (as Darwin's verify
 *   files it, `refileCategory`) as the overdraft fee, none at that name and price is still the
 *   transfer, and the category guard accepts the name as the overdraft fee. Re-filed in place, name
 *   and price unchanged.
 * - kept, reported only: `still_transfer` (today's read is still the transfer), `not_read` (no read
 *   under that name at that price, or no stored text), `refused` (the guard refuses the name).
 *
 * Shadow first (CLAUDE.md standing rule): with `PROTECTION_ITEM_REFILE_LIVE` false (on by default since 2026-11-02), or in
 * a dry run, the step only reports. Switched on, a `refile` goes through the shared 12-hour second look
 * (check `darwin.protection_item_refile`) and is acted on at its second failure: the live row and its
 * verified row take the overdraft category, guarded on the old category, name and price and on no
 * current admin correction, the old values logged to `pipeline_feedback` (kind
 * `protection_item_refiled`) and a `darwin.protection_item_refiled` event. Nothing is taken down.
 *
 * Dry run, prod read-only, 2026-11-01: the pre-filter selects 92 live fees; 63 have a bare name in
 * code (29 name a transfer, savings, a transaction or a period in brackets); 5 would be re-filed at 5
 * institutions (94582, 95703, 112157, 131024, 140406), 49 stay the transfer, 9 are not read. None of
 * the 5 institutions has a live overdraft fee today. Live 51252 (Alcose CU) is already `overdraft`,
 * so it is never selected; v150 keeps a re-read of it there, and the overdraft transfer re-check keeps
 * it (`per_item`). See `protection-item-refile-check.test.ts`.
 */
export const PROTECTION_ITEM_REFILE_CHECK = "darwin.protection_item_refile";
export const PROTECTION_ITEM_REFILE_CHECK_VERSION = 1;
/** The switch, on since 2026-11-02, sampled clean 5 of 5, seed sw-2026-11-02: on re-files matches after the second look; off only reports. */
export const PROTECTION_ITEM_REFILE_LIVE = true;
export const PROTECTION_ITEM_REFILED_KIND = "protection_item_refiled";
export const PROTECTION_ITEM_LIMIT = 1_000;
export const PROTECTION_ITEM_SAMPLES = 20;

export type ProtectionItemOutcome = "refile" | "still_transfer" | "not_read" | "refused";

export interface ProtectionItemRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string;
  source_text: string | null;
}

export interface ProtectionItemVerdict {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string;
  outcome: ProtectionItemOutcome;
  sourceLine: string;
  reason: string;
}

export interface ProtectionItemFindings {
  checked: number;
  outcomes: Partial<Record<ProtectionItemOutcome, number>>;
  matched: number;
  institutions: number;
  samples: ProtectionItemVerdict[];
  keptSamples: ProtectionItemVerdict[];
}

export interface ProtectionItemResult extends ProtectionItemFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  refiled: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;
const words = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Pure: what today's Knox reads on a live bare-protection transfer fee's own document, at its name and price. */
export function protectionItemVerdict(row: ProtectionItemRow): ProtectionItemVerdict | null {
  const amount = num(row.amount);
  const name = (row.fee_name ?? "").trim();
  if (amount == null || !name || row.canonical_fee_key !== PROTECTION_TRANSFER_KEY || !bareProtectionName(name)) return null;
  const base = {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: num(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    feeName: name,
    amount,
    canonicalFeeKey: row.canonical_fee_key,
    sourceLine: "",
  };
  const text = row.source_text ?? "";
  if (!text.trim()) return { ...base, outcome: "not_read", reason: "no stored text for its source document" };
  // v157's held-name vocabulary re-files a live fee only with `HELD_VOCABULARY_RELABEL_LIVE` on.
  const reads = forLiveRelabel(() => runFreeSpecialists(text)).candidates
    .filter((read) => sameAmount(read.amount, amount) && words(read.feeName) === words(name))
    .map((read) => ({ ...read, filed: refileCategory(read.canonicalHint, read.feeName) ?? read.canonicalHint }));
  const item = reads.find((read) => read.filed === PROTECTION_ITEM_TARGET);
  if (reads.some((read) => read.filed === PROTECTION_TRANSFER_KEY)) {
    return { ...base, sourceLine: reads[0].excerpt.slice(0, 300), outcome: "still_transfer", reason: "today's read of its document is still the transfer" };
  }
  if (!item) return { ...base, outcome: "not_read", reason: "no read of its document under this name at this price is the overdraft fee" };
  const sourceLine = item.excerpt.slice(0, 300);
  if (!checkFeeCategory(PROTECTION_ITEM_TARGET, name).ok) return { ...base, sourceLine, outcome: "refused", reason: "the category guard refuses the name as the overdraft fee" };
  return { ...base, sourceLine, outcome: "refile", reason: "protection_item_refile: its schedule prints its own overdraft transfer line and no other overdraft fee, so this line is the paid-overdraft item fee" };
}

/** Pure: the verdicts for the rows the read selected, counted by outcome. */
export function findProtectionItems(rows: ProtectionItemRow[]): ProtectionItemFindings & { matches: ProtectionItemVerdict[] } {
  const verdicts: ProtectionItemVerdict[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    const verdict = protectionItemVerdict(row);
    if (!verdict) continue;
    seen.add(feeId);
    verdicts.push(verdict);
  }
  const outcomes: Partial<Record<ProtectionItemOutcome, number>> = {};
  for (const verdict of verdicts) outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
  const matches = verdicts.filter((verdict) => verdict.outcome === "refile");
  return {
    checked: seen.size,
    outcomes,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, PROTECTION_ITEM_SAMPLES),
    keptSamples: verdicts.filter((verdict) => verdict.outcome === "refused").slice(0, PROTECTION_ITEM_SAMPLES),
    matches,
  };
}

/** Postgres pre-filter on the live name: a bare protection programme name (`bareProtectionName` checks it again). */
export const PROTECTION_ITEM_NAME_PREFILTER = String.raw`^\W*(overdraft|OD|O/D)\s+protection\W*(\([^)]*\))?\W*(fees?)?\W*$`;

/** Read-only: every live bare-protection transfer fee with its source document's latest stored text. */
export function protectionItemRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? PROTECTION_ITEM_LIMIT, 5_000));
  return db<ProtectionItemRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key, text.normalized_text AS source_text
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN LATERAL (
        SELECT t.normalized_text FROM agent_source_texts t
         WHERE t.source_document_id = fr.source_document_id AND t.status = 'completed'
         ORDER BY t.id DESC LIMIT 1
      ) text ON true
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount_kind = 'flat'
       AND fp.amount IS NOT NULL
       AND fp.canonical_fee_key = ${PROTECTION_TRANSFER_KEY}
       AND fp.fee_name ~* ${PROTECTION_ITEM_NAME_PREFILTER}
       -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never re-file an admin-corrected fee.
       AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Pure: the `pipeline_feedback` row a re-filed fee is logged with (its old category kept). */
export function protectionItemFeedbackRow(verdict: ProtectionItemVerdict, runId: number | null): FeedbackRow {
  return {
    aboutStage: "extract",
    signal: "wrong",
    kind: PROTECTION_ITEM_REFILED_KIND,
    reportedBy: "darwin",
    checkName: PROTECTION_ITEM_REFILE_CHECK,
    aboutVersion: PROTECTION_ITEM_REFILE_CHECK_VERSION,
    institutionId: verdict.institutionId,
    sourceDocumentId: null,
    feeVerifiedId: verdict.feeVerifiedId,
    feePublishedId: verdict.feePublishedId,
    canonicalFeeKey: verdict.canonicalFeeKey,
    amount: verdict.amount,
    weight: 0,
    evidence: { from: verdict.canonicalFeeKey, to: PROTECTION_ITEM_TARGET, fee_name: verdict.feeName, source_line: verdict.sourceLine },
    runId,
    dedupeKey: `${PROTECTION_ITEM_REFILE_CHECK}:v${PROTECTION_ITEM_REFILE_CHECK_VERSION}:${verdict.feePublishedId}:${verdict.canonicalFeeKey}:${PROTECTION_ITEM_TARGET}`,
  };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckProtectionItems(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<ProtectionItemResult> {
  const live = options.live ?? PROTECTION_ITEM_REFILE_LIVE;
  const result: ProtectionItemResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, outcomes: {}, matched: 0, institutions: 0, samples: [], keptSamples: [], flagged: 0, waiting: 0, refiled: [],
  };

  let rows: ProtectionItemRow[];
  try {
    rows = await inSavepoint(db, (scope) => protectionItemRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] protection item check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findProtectionItems(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: PROTECTION_ITEM_REFILE_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) result.refiled = await refile(db, options, look.confirmed);
  }

  if (!options.dryRun && result.matched > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${PROTECTION_ITEM_REFILE_CHECK}, 'completed',
          ${`Read ${result.checked} live bare "Overdraft Protection" transfer fee(s) against their documents: ${result.matched} at ${result.institutions} institution(s) are the paid-overdraft item fee; ${live ? `${result.flagged} flagged, ${result.refiled.length} re-filed` : "switch off, would re-file, nothing written"}`},
          ${JSON.stringify(protectionItemDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] protection item check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Re-file confirmed fees in place, guarded on the old category, name and price. Never takes a fee down. */
async function refile(db: SqlTag, options: { runId: number; stepId?: number | null }, fees: ProtectionItemVerdict[]): Promise<number[]> {
  try {
    const done = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET canonical_fee_key = ${PROTECTION_ITEM_TARGET}
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.canonicalFeeKey)}::text[],
                      ${fees.map((fee) => fee.feeName)}::text[], ${fees.map((fee) => fee.amount)}::numeric[])
               AS v(fee_published_id, from_key, old_name, amount)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = v.from_key
           AND fp.fee_name = v.old_name
           AND fp.amount = v.amount
           AND fp.rolled_back_at IS NULL
           AND fp.quarantined_at IS NULL
           -- Same check as notAdminCorrectedSql("fp"), written inline for the tagged template.
           AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected
                            WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const applied = fees.filter((fee) => ids.has(fee.feePublishedId));
      const withVerified = applied.filter((fee) => fee.feeVerifiedId != null);
      if (withVerified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET canonical_fee_key = ${PROTECTION_ITEM_TARGET}
            FROM unnest(${withVerified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${withVerified.map((fee) => fee.canonicalFeeKey)}::text[])
                 AS v(fee_verified_id, from_key)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND fv.canonical_fee_key = v.from_key
        `;
      }
      if (applied.length > 0) {
        await recordFeedback(scope, applied.map((fee) => protectionItemFeedbackRow(fee, options.runId)));
        await scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.protection_item_refiled', 'completed',
            ${`Re-filed ${applied.length} live bare "Overdraft Protection" fee(s) as the overdraft fee their schedule reads, on their second look; name and price unchanged, old values kept in pipeline_feedback`},
            ${JSON.stringify({ version: PROTECTION_ITEM_REFILE_CHECK_VERSION, refiled: applied.length, samples: applied.slice(0, 50).map(sampleDetail) })}::jsonb
          )
        `;
      }
      return applied.map((fee) => fee.feePublishedId);
    });
    if (done.length > 0) invalidatePublicReadCache();
    return done;
  } catch (error) {
    console.error("[darwin] protection item re-file failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function sampleDetail(fee: ProtectionItemVerdict) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    outcome: fee.outcome,
    source_line: fee.sourceLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function protectionItemDetail(result: ProtectionItemResult) {
  return {
    check: PROTECTION_ITEM_REFILE_CHECK,
    version: PROTECTION_ITEM_REFILE_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    outcomes: result.outcomes,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    refiled: result.refiled,
    samples: result.samples.map(sampleDetail),
    samples_kept: result.keptSamples.map(sampleDetail),
  };
}
