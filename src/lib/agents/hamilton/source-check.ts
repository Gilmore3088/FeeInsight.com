import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { PENDING_KIND, SECOND_LOOK_MIN_MINUTES, secondLook } from "@/lib/agents/hamilton/second-look";
import { checkFeeAgainstSource, checkRateAgainstSource, type SourceCheckFailure } from "@/lib/custom-report/source-check";
import { isPercentFee, ratePercentOf, type RateFields } from "@/lib/percent-fees";

type SqlTag = typeof sql;

/**
 * Institutions source-checked per publish step; later steps pick up the rest. A strategy
 * bump makes every institution due at once (about 3,000), and publish steps run about 12
 * times an hour, so 120 a step clears a full re-check in about 2 hours where 40 took 6
 * while new fees kept adding more. A 40-institution step took 4-15 s and reads about 20 KB
 * of text per institution.
 */
export const SOURCE_CHECK_INSTITUTION_LIMIT = 120;
export const SOURCE_CHECK_REASON = "source_check_untraceable";
// Version 2: a line carrying several fees gives each fee its own price, and fees an
// earlier version took down are re-checked and restored when they trace.
// Version 3: the shared reader learned six layouts (PR 195), so every institution is
// checked again and fees the older reader took down are restored when they now trace.
// Bump this whenever checkFeeAgainstSource changes what it can read.
// Version 4: a daily cap traces to the cap figure on its fee's row ("Maximum of $120.00 per day"),
// so the caps the older check took down as thresholds are checked again and restored.
// Version 5: a price with a note in parentheses under its name ("$29.00/presentment (applies
// to ...)"), and figures in a name's note ("Gift Cards ($25 up to $500 Only) | $5"), are read,
// so fees the older check took down for those layouts are checked again and restored.
// Version 6: a price charged per $100 of the item ("Cashier Check (per $100.00) $1.00") is not
// a flat fee (priced_per_amount); "$.50" is a price; a price with a unit and a qualifier under
// its name ("$5.00 per month for each acct., following ..."), "Fee $35.00" under a name, a
// balance to maintain, and a name wrapped onto the next line are read (Darwin's sample: 13 of
// 20 recent takedowns were real prices). Every institution is checked again; institutions
// with source-check takedowns go first, so wrongly taken-down fees come back soonest.
// Version 7: a two-column page flattened row by row is also read one column at a time, and a
// name that runs onto the next row ("PROCESSING OF LEVIES**" / "IRS or Court-ordered
// Garnishments ... $100.00") is read with that row.
// Version 8: a name split from its price at a ";" in a run-on paragraph ("Check Cashing for
// non-members;" / "on us only $5.00 Bad Address Correction Fee $3.00") is read to the next row's
// first price.
// Version 9: a "Current Fee" column label between name and price, a price followed by a
// sentence ("$25.00 Per Month. Applicable after ..."), an allowance before the price ("5 Free per
// month," / "$2.50 each additional") and a fee named inside another row's note ("(Lost key
// replacement $75.00)") are read (a fresh sample of older takedowns: 6 of 11 readable were real).
// Version 10: a box-size grid (sizes closing one row, their prices closing the next) and a price
// wrapped under its name ("Returned Check | Verification of Deposit | $20" / "$30 | ...") are
// read one fee per row, so neither fee takes the other's price (Space Coast, Oct 7).
// Version 11: a row with two columns' names and one price ("Stop Payment | Monthly Statement –
// Electronic | Free") gives the price to the second name (First American Bank, Oct 7).
// Version 12: "(greater than or equal to $0)" is a balance condition, not a $0 fee (Citizens, Oct 7).
export const SOURCE_CHECK_STRATEGY = { strategy: "hamilton.source_check", version: 12 } as const;

/**
 * An institution is checked again whenever a newer live fee appears, so a fee
 * published after its last check is never left unchecked.
 */
export function sourceCheckFingerprint(maxLiveFeeId: number | string): string {
  return `v${SOURCE_CHECK_STRATEGY.version}:${maxLiveFeeId}`;
}

/** The marker a restore leaves, so the restored fee's institution is checked again. */
export const SOURCE_CHECK_RESTORE_PREFIX = "restored:";

/**
 * Another check (the newer-copy check, the rules re-check) can put an older row live
 * again. Its id is below the institution's highest live id, so the fingerprint above
 * would not change and the restored fee would go live without a source check. A marker
 * attempt per restored row makes the institution due again: a check counts only while
 * no marker is newer than it.
 */
export async function markRestoredForSourceCheck(
  db: SqlTag,
  restored: Array<{ institution_id: number | string; fee_published_id: number | string }>,
  options: { runId: number; restoredBy: string },
): Promise<void> {
  if (restored.length === 0) return;
  await db`
    INSERT INTO pipeline_attempts (
      institution_id, stage, strategy, strategy_version, input_fingerprint, outcome,
      yield_count, cost_microusd, agent_run_id, detail
    )
    SELECT v.institution_id, 'publish', ${SOURCE_CHECK_STRATEGY.strategy}, ${SOURCE_CHECK_STRATEGY.version},
           ${SOURCE_CHECK_RESTORE_PREFIX} || v.fee_published_id::text || ':' || ${options.runId}::text, 'ok',
           0, 0, ${options.runId},
           jsonb_build_object('restored_fee_published_id', v.fee_published_id, 'restored_by', ${options.restoredBy}::text)
      FROM unnest(
             ${restored.map((row) => Number(row.institution_id))}::bigint[],
             ${restored.map((row) => Number(row.fee_published_id))}::bigint[]
           ) AS v(institution_id, fee_published_id)
  `;
}

export interface LiveFeeRow extends RateFields {
  fee_published_id: number | string;
  lineage_ref: number | string;
  fee_raw_id: number | string;
  institution_id: number | string;
  source: string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  /** Taken down by an earlier source check; restored if it now traces. */
  taken_down?: boolean | null;
}

export interface InstitutionText {
  source_document_id: number | string;
  normalized_text: string;
}

export type SourceVerdict =
  | { kind: "traced"; sourceDocumentId: number }
  | { kind: "relinked"; sourceDocumentId: number }
  | { kind: "untraceable"; reason: SourceCheckFailure | "no_amount" };

/**
 * Pure: is this live fee stated in the bank's own stored schedule? Its own document is
 * tried first. A fee from another source (imported with no document, or with one that
 * was never read) may be relinked to another stored document of the institution; a
 * Knox fee answers only to the document Knox read it from. A tiered fee ("Negative $25 or less
 * | $5") is the bank's real price for that band, so it stays live.
 */
export function traceLiveFee(fee: LiveFeeRow, texts: InstitutionText[]): SourceVerdict {
  // A percentage fee traces by its rate ("1.1%"), never as a dollar amount.
  const rate = ratePercentOf(fee);
  if (fee.amount == null && rate == null) return { kind: "untraceable", reason: "no_amount" };
  const amount = Number(fee.amount);
  const ownId = fee.source_document_id == null ? null : Number(fee.source_document_id);
  const ordered = [...texts]
    .filter((text) => fee.source !== "knox" || Number(text.source_document_id) === ownId)
    .sort((a, b) => Number(Number(b.source_document_id) === ownId) - Number(Number(a.source_document_id) === ownId));
  let reason: SourceCheckFailure = "no_source_text";
  for (const text of ordered) {
    const result = isPercentFee(fee)
      ? checkRateAgainstSource(text.normalized_text, fee.fee_name, rate as number, ".")
      : checkFeeAgainstSource(text.normalized_text, fee.fee_name, amount, ".", fee.canonical_fee_key);
    if (result.ok || result.reason === "tiered_fee") {
      const documentId = Number(text.source_document_id);
      return documentId === ownId ? { kind: "traced", sourceDocumentId: documentId } : { kind: "relinked", sourceDocumentId: documentId };
    }
    if (Number(text.source_document_id) === ownId || reason === "no_source_text") reason = result.reason;
  }
  return { kind: "untraceable", reason };
}

export interface SourceCheckTakedown {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

export interface SourceCheckResult {
  institutionsChecked: number;
  liveFeesChecked: number;
  traced: number;
  relinked: number;
  takedowns: SourceCheckTakedown[];
  /** Fees an earlier source check took down that now trace, put back live. */
  restored: number;
  /** Failed for the first time: logged for a second look, still live. */
  flagged: number;
  /** Failed again before their second look was due: still live. */
  awaitingSecondLook: number;
  /** Passed after an earlier failure: their pending flag is cleared. */
  cleared: number;
}

const EMPTY_RESULT: SourceCheckResult = {
  institutionsChecked: 0,
  liveFeesChecked: 0,
  traced: 0,
  relinked: 0,
  takedowns: [],
  restored: 0,
  flagged: 0,
  awaitingSecondLook: 0,
  cleared: 0,
};
const TAKEN_DOWN = `${SOURCE_CHECK_REASON}:%`;

/**
 * Hamilton repair: every live fee must be stated in the bank's own stored schedule
 * (`checkFeeAgainstSource`, the same rule the report gate uses). For a batch of
 * institutions not checked since their newest live fee, each live fee is traced to its
 * own document's text, or relinked to another stored document of the institution that
 * states it. A fee that can't be traced is logged for a second look (`second-look.ts`) and
 * stays live; when a later run still can't trace it, it is taken down: kept, with
 * `rolled_back_at`, the batch id and the reason, and its verified row rejected so the
 * next publish does not bring it back. Clearing `rolled_back_at` restores it. Fees an
 * earlier version took down are re-checked with the institution and restored (with their
 * verified row) when they now trace. A dry run reports and writes nothing.
 */
export async function takeDownUntraceableFees(
  db: SqlTag,
  options: {
    runId: number;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    institutionLimit?: number;
  },
): Promise<SourceCheckResult> {
  const limit = options.institutionLimit ?? SOURCE_CHECK_INSTITUTION_LIMIT;
  let fees: LiveFeeRow[];
  let texts: Array<InstitutionText & { institution_id: number | string }>;
  let fingerprints: Map<number, string>;
  try {
    const due = await inSavepoint(db, (scope) => scope<{ institution_id: number | string; max_fee_id: number | string }[]>`
      SELECT live.institution_id, live.max_fee_id
        FROM (
          SELECT fp.institution_id, MAX(fp.fee_published_id) AS max_fee_id
            FROM published_fee_records fp
            JOIN institution_sources inst ON inst.id = fp.institution_id
           WHERE (fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${TAKEN_DOWN})
           GROUP BY fp.institution_id
        ) live
       WHERE NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.stage = 'publish'
            AND pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
            AND pa.institution_id = live.institution_id
            AND pa.input_fingerprint = 'v' || ${SOURCE_CHECK_STRATEGY.version}::text || ':' || live.max_fee_id::text
            -- A fee restored after this check went live unchecked (markRestoredForSourceCheck).
            AND NOT EXISTS (
              SELECT 1 FROM pipeline_attempts restore
               WHERE restore.stage = 'publish'
                 AND restore.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
                 AND restore.institution_id = live.institution_id
                 AND restore.input_fingerprint LIKE ${`${SOURCE_CHECK_RESTORE_PREFIX}%`}
                 AND restore.id > pa.id
            )
       )
          -- A live fee that failed its first look is due its second.
          OR EXISTS (
            SELECT 1 FROM pipeline_feedback f
              JOIN published_fee_records pending ON pending.fee_published_id = f.fee_published_id
             WHERE f.check_name = ${SOURCE_CHECK_STRATEGY.strategy}
               AND f.kind = ${PENDING_KIND}
               AND f.institution_id = live.institution_id
               AND pending.rolled_back_at IS NULL
               AND (f.evidence->>'flagged_at')::timestamptz <= NOW() - make_interval(mins => ${SECOND_LOOK_MIN_MINUTES})
          )
       ORDER BY NOT (
                  (${options.institutionId ?? null}::bigint IS NULL OR live.institution_id = ${options.institutionId ?? null}::bigint)
                  AND (${options.stateCode ?? null}::text IS NULL OR EXISTS (
                    SELECT 1 FROM institution_sources inst
                     WHERE inst.id = live.institution_id AND upper(btrim(inst.state_code)) = ${options.stateCode ?? null}::text
                  ))
                ),
                EXISTS (
                  SELECT 1 FROM pipeline_attempts pa
                   WHERE pa.stage = 'publish'
                     AND pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
                     AND pa.institution_id = live.institution_id
                     AND pa.input_fingerprint NOT LIKE ${`${SOURCE_CHECK_RESTORE_PREFIX}%`}
                ),
                -- Banks with fees this check took down first: a reader fix restores them soonest.
                NOT EXISTS (
                  SELECT 1 FROM published_fee_records down
                   WHERE down.institution_id = live.institution_id
                     AND down.rolled_back_reason LIKE ${TAKEN_DOWN}
                ),
                live.institution_id
       LIMIT ${limit}
    `);
    if (due.length === 0) return EMPTY_RESULT;
    fingerprints = new Map(due.map((row) => [Number(row.institution_id), sourceCheckFingerprint(row.max_fee_id)]));
    const ids = [...fingerprints.keys()];
    fees = await inSavepoint(db, (scope) => scope<LiveFeeRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fv.fee_raw_id, fp.institution_id, fr.source, fr.source_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount, fp.amount_kind, fp.rate_percent,
             fp.rolled_back_at IS NOT NULL AS taken_down
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE (fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${TAKEN_DOWN})
         AND fp.institution_id = ANY(${ids}::bigint[])
    `);
    texts = await inSavepoint(db, (scope) => scope<Array<InstitutionText & { institution_id: number | string }>>`
      SELECT DISTINCT ON (source_document_id) institution_id, source_document_id, normalized_text
        FROM agent_source_texts
       WHERE institution_id = ANY(${ids}::bigint[])
         AND status = 'completed'
         AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    `);
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("takeDownUntraceableFees select failed:", error);
    return EMPTY_RESULT;
  }

  const textsByInstitution = new Map<number, InstitutionText[]>();
  for (const text of texts) {
    const id = Number(text.institution_id);
    textsByInstitution.set(id, [...(textsByInstitution.get(id) ?? []), text]);
  }
  const result: SourceCheckResult = { ...EMPTY_RESULT, takedowns: [] };
  const passing: number[] = [];
  const relinks: Array<{ feeRawId: number; sourceDocumentId: number }> = [];
  const linkedKeys = new Set<string>();
  const verifiedIds: number[] = [];
  const restores: number[] = [];
  const failing: Array<SourceCheckTakedown & { sourceDocumentId: number | null; feeVerifiedId: number }> = [];
  const perInstitution = new Map<number, { checked: number; takenDown: number; relinked: number; restored: number }>(
    [...fingerprints.keys()].map((id) => [id, { checked: 0, takenDown: 0, relinked: 0, restored: 0 }]),
  );
  for (const fee of fees) {
    const institutionId = Number(fee.institution_id);
    const counts = perInstitution.get(institutionId)!;
    const verdict = traceLiveFee(fee, textsByInstitution.get(institutionId) ?? []);
    if (fee.taken_down) {
      // Already down: restore it when it now traces, otherwise leave it down.
      if (verdict.kind === "untraceable") continue;
      restores.push(Number(fee.fee_published_id));
      counts.restored += 1;
    }
    result.liveFeesChecked += 1;
    counts.checked += 1;
    if (verdict.kind !== "untraceable" && !fee.taken_down) passing.push(Number(fee.fee_published_id));
    if (verdict.kind === "traced") {
      result.traced += 1;
    } else if (verdict.kind === "relinked") {
      result.relinked += 1;
      counts.relinked += 1;
      const linkKey = `${fee.source}|${verdict.sourceDocumentId}|${fee.fee_name}`;
      if (!linkedKeys.has(linkKey)) {
        linkedKeys.add(linkKey);
        relinks.push({ feeRawId: Number(fee.fee_raw_id), sourceDocumentId: verdict.sourceDocumentId });
      }
    } else {
      failing.push({
        feePublishedId: Number(fee.fee_published_id),
        institutionId,
        canonicalFeeKey: fee.canonical_fee_key,
        feeName: fee.fee_name,
        amount: fee.amount == null ? null : Number(fee.amount),
        sourceDocumentId: fee.source_document_id == null ? null : Number(fee.source_document_id),
        reason: verdict.reason,
        feeVerifiedId: Number(fee.lineage_ref),
      });
    }
  }
  result.institutionsChecked = perInstitution.size;
  result.restored = restores.length;

  // A takedown is a last resort: only a fee that failed an earlier look too comes down.
  const look = await secondLook(db, {
    check: SOURCE_CHECK_STRATEGY.strategy,
    runId: options.runId,
    failing,
    passing,
    dryRun: options.dryRun,
  });
  result.flagged = look.flagged;
  result.awaitingSecondLook = look.waiting;
  result.cleared = look.cleared;
  for (const fee of look.confirmed) {
    perInstitution.get(fee.institutionId)!.takenDown += 1;
    verifiedIds.push(fee.feeVerifiedId);
    result.takedowns.push({
      feePublishedId: fee.feePublishedId,
      institutionId: fee.institutionId,
      canonicalFeeKey: fee.canonicalFeeKey,
      feeName: fee.feeName,
      amount: fee.amount,
      reason: fee.reason,
    });
  }

  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (relinks.length > 0) {
        await scope`
          UPDATE raw_fee_observations fr
             SET source_document_id = link.source_document_id
            FROM unnest(${relinks.map((link) => link.feeRawId)}::bigint[], ${relinks.map((link) => link.sourceDocumentId)}::bigint[])
                 AS link(fee_raw_id, source_document_id)
           WHERE fr.fee_raw_id = link.fee_raw_id
             -- An imported row is unique per (source, document, name); a duplicate keeps
             -- its old link rather than failing the batch.
             AND NOT EXISTS (
               SELECT 1 FROM raw_fee_observations other
                WHERE other.source = fr.source
                  AND other.source_document_id = link.source_document_id
                  AND other.fee_name = fr.fee_name
             )
        `;
      }
      if (restores.length > 0) {
        // A restore never makes an exact second copy of a fee that is live again.
        const restored = await scope<{ lineage_ref: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL
           WHERE fp.fee_published_id = ANY(${restores}::bigint[])
             AND fp.rolled_back_reason LIKE ${TAKEN_DOWN}
             AND NOT EXISTS (
               SELECT 1 FROM published_fee_records live
                WHERE live.rolled_back_at IS NULL
                  AND live.institution_id = fp.institution_id
                  AND live.canonical_fee_key = fp.canonical_fee_key
                  AND live.amount IS NOT DISTINCT FROM fp.amount
                  AND live.rate_percent IS NOT DISTINCT FROM fp.rate_percent
                  AND live.fee_name = fp.fee_name
             )
          RETURNING fp.lineage_ref
        `;
        result.restored = restored.length;
        if (restored.length > 0) {
          await scope`
            UPDATE verified_fee_observations
               SET review_status = 'verified',
                   outlier_flags = outlier_flags - ${SOURCE_CHECK_REASON}
             WHERE fee_verified_id = ANY(${restored.map((row) => Number(row.lineage_ref))}::bigint[])
               AND review_status = 'rejected'
               AND outlier_flags ? ${SOURCE_CHECK_REASON}
          `;
        }
      }
      if (result.takedowns.length > 0) {
        await scope`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = ${SOURCE_CHECK_REASON} || ':' || takedown.reason
            FROM unnest(${result.takedowns.map((row) => row.feePublishedId)}::bigint[], ${result.takedowns.map((row) => row.reason)}::text[])
                 AS takedown(fee_published_id, reason)
           WHERE fp.fee_published_id = takedown.fee_published_id
             AND fp.rolled_back_at IS NULL
        `;
        await scope`
          UPDATE verified_fee_observations
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN outlier_flags ? ${SOURCE_CHECK_REASON} THEN outlier_flags
                   ELSE COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([SOURCE_CHECK_REASON])}::jsonb
                 END
           WHERE fee_verified_id = ANY(${verifiedIds}::bigint[])
             AND review_status IN ('verified', 'approved')
        `;
      }
      for (const [institutionId, counts] of perInstitution) {
        await recordAttempt(scope, {
          institutionId,
          sourceDocumentId: null,
          stage: "publish",
          strategy: SOURCE_CHECK_STRATEGY.strategy,
          version: SOURCE_CHECK_STRATEGY.version,
          fingerprint: fingerprints.get(institutionId)!,
          outcome: counts.checked === 0 ? "empty" : counts.takenDown > 0 ? "ok_partial" : "ok",
          yieldCount: counts.checked - counts.takenDown,
          costMicrousd: 0,
          runId: options.runId,
          detail: { live_fees_checked: counts.checked, relinked: counts.relinked, taken_down: counts.takenDown, restored: counts.restored },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.source_check', 'completed',
          ${`Source-checked ${result.liveFeesChecked} live fee(s) at ${result.institutionsChecked} institution(s): ${result.traced} traced, ${result.relinked} relinked to a stored schedule, ${result.takedowns.length} taken down after a second look, ${result.flagged} flagged for a second look, ${result.restored} restored`},
          ${JSON.stringify({
            batch_id: options.batchId,
            institutions_checked: result.institutionsChecked,
            live_fees_checked: result.liveFeesChecked,
            traced: result.traced,
            relinked: result.relinked,
            taken_down: result.takedowns.length,
            restored: result.restored,
            flagged_for_second_look: result.flagged,
            awaiting_second_look: result.awaitingSecondLook,
            cleared_after_first_look: result.cleared,
            samples: result.takedowns.slice(0, 20).map((row) => ({
              fee_published_id: row.feePublishedId,
              institution_id: row.institutionId,
              canonical_fee_key: row.canonicalFeeKey,
              fee_name: row.feeName,
              amount: row.amount,
              reason: row.reason,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("takeDownUntraceableFees write failed:", error);
    return { ...result, relinked: 0, takedowns: [], restored: 0 };
  }
  if (result.takedowns.length > 0 || result.restored > 0) invalidatePublicReadCache();
  return result;
}

/** Imported fees linked to their document through an identical imported row, per publish step. */
export const IMPORTED_TWIN_LINK_LIMIT = 100;

/** One check per (verified row, twin raw row) pair. */
export function importedTwinFingerprint(feeVerifiedId: number | string, twinRawId: number | string): string {
  return `twin-v1:${feeVerifiedId}:${twinRawId}`;
}

interface ImportedTwinRow extends LiveFeeRow {
  twin_raw_id: number | string;
  twin_document_id: number | string;
  normalized_text: string | null;
}

export interface ImportedTwinLinkResult {
  checked: number;
  linked: number;
  untraced: number;
}

/**
 * Pure: an imported live fee may take its twin's document only when that document's text
 * states the fee (the same shared check the source check uses).
 */
export function twinStatesFee(row: ImportedTwinRow): boolean {
  if (!row.normalized_text) return false;
  const verdict = traceLiveFee({ ...row, source_document_id: row.twin_document_id }, [
    { source_document_id: row.twin_document_id, normalized_text: row.normalized_text },
  ]);
  return verdict.kind === "traced";
}

/**
 * Hamilton repair: an imported live fee with no document gets its document. The April
 * import (`migration_v10`) wrote some fee lines twice, once with the schedule's document
 * and once without, and published the copy without one. The source check traces those
 * fees to the schedule but cannot relink them: an imported row is unique per (source,
 * document, name), and the twin already holds that slot. Here the fee's verified row is
 * pointed at the twin (same institution, source, name and amount, never Darwin-verified
 * itself) once the twin's document states the fee. No fee is published or taken down; a
 * dry run reports and writes nothing.
 */
export async function linkImportedFeesToTwins(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<ImportedTwinLinkResult> {
  const empty: ImportedTwinLinkResult = { checked: 0, linked: 0, untraced: 0 };
  let rows: ImportedTwinRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope<ImportedTwinRow[]>`
      SELECT DISTINCT ON (fp.fee_published_id)
             fp.fee_published_id, fp.lineage_ref, fv.fee_raw_id, fp.institution_id, fr.source, fr.source_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount, fp.amount_kind, fp.rate_percent,
             twin.fee_raw_id AS twin_raw_id, twin.source_document_id AS twin_document_id,
             (SELECT t.normalized_text FROM agent_source_texts t
               WHERE t.source_document_id = twin.source_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
               ORDER BY t.id DESC LIMIT 1) AS normalized_text
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN raw_fee_observations twin
          ON twin.institution_id = fr.institution_id
         AND twin.source = fr.source
         AND twin.fee_name = fr.fee_name
         AND twin.fee_raw_id <> fr.fee_raw_id
         AND twin.source_document_id IS NOT NULL
         AND twin.amount IS NOT DISTINCT FROM fr.amount
         AND twin.rate_percent IS NOT DISTINCT FROM fr.rate_percent
       WHERE fp.rolled_back_at IS NULL
         AND fr.source_document_id IS NULL
         AND fr.source <> 'knox'
         AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
         AND NOT EXISTS (
           SELECT 1 FROM verified_fee_observations tv
            WHERE tv.fee_raw_id = twin.fee_raw_id AND tv.outlier_flags ? 'agentic_darwin_verified'
         )
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.stage = 'publish'
              AND pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
              AND pa.input_fingerprint = 'twin-v1:' || fv.fee_verified_id::text || ':' || twin.fee_raw_id::text
         )
       ORDER BY fp.fee_published_id, twin.fee_raw_id
       LIMIT ${options.limit ?? IMPORTED_TWIN_LINK_LIMIT}
    `);
  } catch (error) {
    console.error("linkImportedFeesToTwins select failed:", error);
    return empty;
  }
  if (rows.length === 0) return empty;
  // One verified row per twin: the Darwin dedupe index allows one verified row per raw row.
  const usedTwins = new Set<string>();
  const links = rows.filter((row) => {
    if (!twinStatesFee(row) || usedTwins.has(String(row.twin_raw_id))) return false;
    usedTwins.add(String(row.twin_raw_id));
    return true;
  });
  const linkedIds = new Set(links.map((row) => String(row.fee_published_id)));
  const result: ImportedTwinLinkResult = { checked: rows.length, linked: links.length, untraced: rows.length - links.length };
  if (options.dryRun) return result;
  try {
    await inSavepoint(db, async (scope) => {
      if (links.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET fee_raw_id = link.twin_raw_id
            FROM unnest(${links.map((row) => Number(row.lineage_ref))}::bigint[], ${links.map((row) => Number(row.twin_raw_id))}::bigint[])
                 AS link(fee_verified_id, twin_raw_id)
           WHERE fv.fee_verified_id = link.fee_verified_id
        `;
      }
      for (const row of rows) {
        const linked = linkedIds.has(String(row.fee_published_id));
        await recordAttempt(scope, {
          institutionId: Number(row.institution_id),
          sourceDocumentId: Number(row.twin_document_id),
          stage: "publish",
          strategy: SOURCE_CHECK_STRATEGY.strategy,
          version: SOURCE_CHECK_STRATEGY.version,
          fingerprint: importedTwinFingerprint(row.lineage_ref, row.twin_raw_id),
          outcome: linked ? "ok" : "unchanged",
          yieldCount: linked ? 1 : 0,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: {
            fee_published_id: Number(row.fee_published_id),
            previous_fee_raw_id: Number(row.fee_raw_id),
            twin_raw_id: Number(row.twin_raw_id),
            twin_document_id: Number(row.twin_document_id),
            linked,
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.imported_twin_link', 'completed',
          ${`Linked ${result.linked} imported live fee(s) with no document to their schedule through an identical imported row; ${result.untraced} left as they are`},
          ${JSON.stringify({ checked: result.checked, linked: result.linked, untraced: result.untraced })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("linkImportedFeesToTwins write failed:", error);
    return { ...result, linked: 0 };
  }
  return result;
}
