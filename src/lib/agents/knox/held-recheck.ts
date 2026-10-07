import { sql } from "@/lib/data-store/connection";
import { extractFromSegment, type ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { rateFeeFromHeld, type RateFeeCandidate, type RateHoldReason } from "@/lib/agents/knox/percent";
import { KNOX_RATE_FEE_FLAG } from "@/lib/agents/knox/extract";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";

type SqlTag = typeof sql;

/**
 * Knox re-reads the lines it held as unclassified with today's rules.
 *
 * A held line stays in `raw_fee_observations` without `needs_darwin_verification`, and
 * Knox does not extract a document's text twice, so a line an older rules version could
 * not categorize stayed held after the rules learned it ("Courtesy Pay Fee | $30" held by
 * an early version, an overdraft fee today). Each pass re-reads a batch of those lines
 * from their stored excerpt. A line today's rules price at the same amount takes the
 * category and goes to Darwin; the rest are marked with the rules version so they are not
 * re-read until the rules change again. Only lines from the document's current text are
 * re-read; lines from a replaced text stay held.
 */
export const HELD_RECHECK_DEFAULT_LIMIT = 300;
export const HELD_RECHECK_PROMOTED_FLAG = "knox_promoted_from_held";
/**
 * A line still uncategorized after this many rules versions is set aside: flagged
 * `knox_set_aside` and logged, never deleted. Every later rules version still re-reads it,
 * so a set-aside line can come back (James, Oct 7 2026: "never deleted, just archive and
 * can always be revisited").
 */
export const HELD_SET_ASIDE_AFTER_VERSIONS = 3;
export const HELD_SET_ASIDE_FLAG = "knox_set_aside";

export function heldRecheckFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_recheck:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

export interface HeldRow {
  fee_raw_id: number | string;
  amount: number | string | null;
  conditions: string | null;
  institution_id?: number | string | null;
  source_document_id?: number | string | null;
  fee_name?: string | null;
  outlier_flags?: unknown;
}

export interface HeldRecheckResult {
  checked: number;
  promoted: number;
  stillHeld: number;
  /** Lines set aside in this pass after HELD_SET_ASIDE_AFTER_VERSIONS versions. */
  setAside: number;
  /** Decisions written to the shared learning store (`pipeline_feedback`). */
  logged: number;
  /** Category -> lines promoted to it in this pass. */
  promotedByCategory: Record<string, number>;
  dryRun: boolean;
}

function flagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Rules versions that have read this held line, this pass included, oldest first. */
export function versionsChecked(row: HeldRow, version: number = KNOX_RULES_STRATEGY.version): number[] {
  const prefix = `knox_recheck:${KNOX_RULES_STRATEGY.strategy}:v`;
  const seen = new Set(
    flagList(row.outlier_flags)
      .filter((flag) => flag.startsWith(prefix))
      .map((flag) => Number(flag.slice(prefix.length)))
      .filter(Number.isFinite),
  );
  seen.add(version);
  return [...seen].sort((a, b) => a - b);
}

/**
 * The decision log entry for one held line: every pass re-judges it under one dedupe key,
 * so the row carries the versions that read it and the latest outcome.
 */
export function heldDecision(
  row: HeldRow,
  outcome: { promotedTo: string } | { setAside: boolean },
  versions: number[],
  runId: number | null,
): FeedbackRow {
  const promoted = "promotedTo" in outcome;
  return {
    aboutStage: "extract",
    aboutStrategy: KNOX_RULES_STRATEGY.strategy,
    aboutVersion: KNOX_RULES_STRATEGY.version,
    signal: promoted ? "restored" : "missed",
    kind: promoted ? "promoted_from_held" : outcome.setAside ? "set_aside_no_category" : "held_no_category",
    reportedBy: "knox",
    checkName: "knox.held_recheck",
    institutionId: row.institution_id == null ? null : Number(row.institution_id),
    sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
    feeRawId: Number(row.fee_raw_id),
    canonicalFeeKey: promoted ? outcome.promotedTo : null,
    amount: row.amount == null ? null : Number(row.amount),
    weight: promoted ? 1 : 0.5,
    evidence: {
      fee_name: row.fee_name ?? null,
      excerpt: heldExcerpt(row.conditions),
      versions_checked: versions,
      promoted_to: promoted ? outcome.promotedTo : null,
      set_aside: !promoted && "setAside" in outcome && outcome.setAside,
    },
    runId,
    dedupeKey: `knox.held:raw:${Number(row.fee_raw_id)}`,
  };
}

/** The line Knox stored with a held row: `excerpt="..."` at the end of `conditions`. */
export function heldExcerpt(conditions: string | null): string | null {
  const match = /excerpt="([\s\S]*)"\s*$/.exec(conditions ?? "");
  return match?.[1]?.trim() || null;
}

/**
 * Today's rules on a held line: the fee they price at the row's amount, if any. The
 * amount must match, so the row keeps its name and amount and only gains a category.
 */
export function recategorizeHeld(row: HeldRow): ExtractedFeeCandidate | null {
  const excerpt = heldExcerpt(row.conditions);
  const amount = Number(row.amount);
  if (!excerpt || row.amount == null || !Number.isFinite(amount)) return null;
  const { candidates } = extractFromSegment(excerpt);
  return candidates.find((candidate) => Math.abs(candidate.amount - amount) < 0.005) ?? null;
}

export function promotedConditions(conditions: string, candidate: ExtractedFeeCandidate): string {
  return conditions
    .replace(
      /^Knox held for review \(unclassified\)/,
      `Knox ${KNOX_RULES_STRATEGY.strategy} v${KNOX_RULES_STRATEGY.version} categorized a line held for review`,
    )
    .replace(/canonical_hint=none;/, `canonical_hint=${candidate.canonicalHint};`);
}

export async function recheckHeldRows(
  db: SqlTag,
  options: {
    limit?: number;
    dryRun?: boolean;
    institutionId?: number | null;
    stateCode?: string | null;
    runId?: number | null;
  } = {},
): Promise<HeldRecheckResult> {
  const limit = Math.max(1, Math.min(Number(options.limit) || HELD_RECHECK_DEFAULT_LIMIT, 1000));
  const dryRun = Boolean(options.dryRun);
  const recheckFlag = heldRecheckFlag();
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const rows = await db<HeldRow[]>`
    SELECT fr.fee_raw_id, fr.amount, fr.conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags
      FROM raw_fee_observations fr
      JOIN institution_sources inst ON inst.id = fr.institution_id
     WHERE fr.source = 'knox'
       AND fr.outlier_flags ? 'knox_review:unclassified'
       AND NOT fr.outlier_flags ? 'needs_darwin_verification'
       AND NOT fr.outlier_flags ? ${recheckFlag}
       AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
       AND EXISTS (
         SELECT 1
           FROM agent_source_texts adt
          WHERE adt.source_document_id = fr.source_document_id
            AND adt.status = 'completed'
            AND adt.text_hash IS NOT NULL
            AND position(('text_hash=' || adt.text_hash || ';') IN COALESCE(fr.conditions, '')) > 0
       )
     ORDER BY fr.fee_raw_id
     LIMIT ${limit}
  `;

  const promotedByCategory: Record<string, number> = {};
  const stillHeldIds: number[] = [];
  const setAsideIds: number[] = [];
  const decisions: FeedbackRow[] = [];
  let promoted = 0;
  for (const row of rows) {
    const versions = versionsChecked(row);
    const candidate = recategorizeHeld(row);
    if (!candidate) {
      stillHeldIds.push(Number(row.fee_raw_id));
      const setAside = versions.length >= HELD_SET_ASIDE_AFTER_VERSIONS;
      if (setAside && !flagList(row.outlier_flags).includes(HELD_SET_ASIDE_FLAG)) setAsideIds.push(Number(row.fee_raw_id));
      decisions.push(heldDecision(row, { setAside }, versions, options.runId ?? null));
      continue;
    }
    decisions.push(heldDecision(row, { promotedTo: candidate.canonicalHint }, versions, options.runId ?? null));
    if (!dryRun) {
      const flags = ["needs_darwin_verification", `canonical_hint:${candidate.canonicalHint}`, HELD_RECHECK_PROMOTED_FLAG];
      if (candidate.waivable) flags.push("waivable");
      const updated = await db`
        UPDATE raw_fee_observations fr
           SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'knox_review:unclassified')
                               || ${JSON.stringify(flags)}::jsonb,
               conditions = ${promotedConditions(row.conditions ?? "", candidate)},
               extraction_confidence = ${candidate.confidence},
               frequency = COALESCE(fr.frequency, ${candidate.frequency})
         WHERE fr.fee_raw_id = ${Number(row.fee_raw_id)}
           AND fr.outlier_flags ? 'knox_review:unclassified'
           AND NOT fr.outlier_flags ? 'needs_darwin_verification'
        RETURNING fr.fee_raw_id
      `;
      if (updated.length === 0) continue;
    }
    promoted += 1;
    promotedByCategory[candidate.canonicalHint] = (promotedByCategory[candidate.canonicalHint] ?? 0) + 1;
  }

  if (!dryRun && stillHeldIds.length > 0) {
    await db`
      UPDATE raw_fee_observations
         SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([recheckFlag])}::jsonb
       WHERE fee_raw_id = ANY(${stillHeldIds}::bigint[])
    `;
  }
  if (!dryRun && setAsideIds.length > 0) {
    // Set aside, never deleted: the row and its evidence stay, and later versions re-read it.
    await db`
      UPDATE raw_fee_observations
         SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([HELD_SET_ASIDE_FLAG])}::jsonb
       WHERE fee_raw_id = ANY(${setAsideIds}::bigint[])
         AND NOT outlier_flags ? ${HELD_SET_ASIDE_FLAG}
    `;
  }
  let logged = 0;
  if (!dryRun && decisions.length > 0 && (await feedbackSchemaReady(db))) {
    logged = await recordFeedback(db, decisions);
  }

  return {
    checked: rows.length,
    promoted,
    stillHeld: stillHeldIds.length,
    setAside: setAsideIds.length,
    logged,
    promotedByCategory,
    dryRun,
  };
}

/**
 * A rules fix can take back a category an earlier version gave a held line (v28: "Phone Call
 * Collection Fee" is debt collection, not a check sent for collection). Each pass re-reads
 * the lines Knox promoted from held that Darwin has not verified yet. A line today's rules
 * no longer price under the same category goes back on hold: it leaves Darwin's queue, gets
 * `knox_promotion_withdrawn:vN`, and the decision is logged as `wrong`. The row is kept and
 * the held re-check reads it again when the rules change. Lines that keep their category are
 * marked checked for this version. Rate fees are left to the rate rules. Rows Darwin already verified are left to Hamilton's rules
 * re-check (`hamilton/rules-recheck.ts`), which takes live fees down the same way.
 */
export const PROMOTION_RECHECK_LIMIT = 500;

export function promotionCheckedFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_promotion_checked:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

export function promotionWithdrawnFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_promotion_withdrawn:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

/** The category Knox gave a promoted line (`canonical_hint:X`), or null. */
export function promotedHint(row: HeldRow): string | null {
  const flag = flagList(row.outlier_flags).find((value) => value.startsWith("canonical_hint:"));
  return flag ? flag.slice("canonical_hint:".length) : null;
}

/** A promoted line's audit text put back as a held line's. */
export function heldConditions(conditions: string): string {
  return conditions
    .replace(/^Knox \S+ v\d+ categorized a line held for review/, "Knox held for review (unclassified)")
    .replace(/canonical_hint=[a-z_]+;/, "canonical_hint=none;");
}

export interface PromotionRecheckResult {
  checked: number;
  withdrawn: number;
  /** Category -> lines taken back from it in this pass. */
  withdrawnByCategory: Record<string, number>;
  logged: number;
  dryRun: boolean;
}

export async function recheckPromotedRows(
  db: SqlTag,
  options: { limit?: number; dryRun?: boolean; institutionId?: number | null; runId?: number | null } = {},
): Promise<PromotionRecheckResult> {
  const limit = Math.max(1, Math.min(Number(options.limit) || PROMOTION_RECHECK_LIMIT, 2000));
  const dryRun = Boolean(options.dryRun);
  const checkedFlag = promotionCheckedFlag();
  const institutionId = options.institutionId ?? null;
  const rows = await db<HeldRow[]>`
    SELECT fr.fee_raw_id, fr.amount, fr.conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags
      FROM raw_fee_observations fr
     WHERE fr.source = 'knox'
       AND fr.outlier_flags ? ${HELD_RECHECK_PROMOTED_FLAG}
       AND NOT fr.outlier_flags ? ${checkedFlag}
       -- Rate fees (recheckHeldRates) have no dollar amount; the rate rules judge them.
       AND NOT fr.outlier_flags ? ${KNOX_RATE_FEE_FLAG}
       AND fr.amount IS NOT NULL
       AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
       AND NOT EXISTS (
         SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id
       )
     ORDER BY fr.fee_raw_id
     LIMIT ${limit}
  `;

  const keptIds: number[] = [];
  const withdrawnByCategory: Record<string, number> = {};
  const decisions: FeedbackRow[] = [];
  let withdrawn = 0;
  for (const row of rows) {
    const hint = promotedHint(row);
    const candidate = recategorizeHeld(row);
    if (!hint || candidate?.canonicalHint === hint) {
      keptIds.push(Number(row.fee_raw_id));
      continue;
    }
    if (!dryRun) {
      const updated = await db`
        UPDATE raw_fee_observations fr
           SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb)
                                 - 'needs_darwin_verification'
                                 - ${`canonical_hint:${hint}`}
                                 - ${HELD_RECHECK_PROMOTED_FLAG})
                               || ${JSON.stringify(["knox_review:unclassified", heldRecheckFlag(), promotionWithdrawnFlag()])}::jsonb,
               conditions = ${heldConditions(row.conditions ?? "")}
         WHERE fr.fee_raw_id = ${Number(row.fee_raw_id)}
           AND fr.outlier_flags ? ${HELD_RECHECK_PROMOTED_FLAG}
           AND NOT EXISTS (
             SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id
           )
        RETURNING fr.fee_raw_id
      `;
      if (updated.length === 0) continue;
    }
    withdrawn += 1;
    withdrawnByCategory[hint] = (withdrawnByCategory[hint] ?? 0) + 1;
    decisions.push({
      aboutStage: "extract",
      aboutStrategy: KNOX_RULES_STRATEGY.strategy,
      aboutVersion: KNOX_RULES_STRATEGY.version,
      signal: "wrong",
      kind: "promotion_withdrawn",
      reportedBy: "knox",
      checkName: "knox.promotion_recheck",
      institutionId: row.institution_id == null ? null : Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      feeRawId: Number(row.fee_raw_id),
      canonicalFeeKey: hint,
      amount: row.amount == null ? null : Number(row.amount),
      weight: 1,
      evidence: {
        fee_name: row.fee_name ?? null,
        excerpt: heldExcerpt(row.conditions),
        withdrawn_from: hint,
        read_today_as: candidate?.canonicalHint ?? null,
      },
      runId: options.runId ?? null,
      // Its own key, so the promotion's log row stays as history.
      dedupeKey: `knox.held_withdrawn:raw:${Number(row.fee_raw_id)}`,
    });
  }

  if (!dryRun && keptIds.length > 0) {
    await db`
      UPDATE raw_fee_observations
         SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([checkedFlag])}::jsonb
       WHERE fee_raw_id = ANY(${keptIds}::bigint[])
         AND NOT outlier_flags ? ${checkedFlag}
    `;
  }
  let logged = 0;
  if (!dryRun && decisions.length > 0 && (await feedbackSchemaReady(db))) {
    logged = await recordFeedback(db, decisions);
  }
  return { checked: rows.length, withdrawn, withdrawnByCategory, logged, dryRun };
}

/**
 * Held percentage lines from before Knox read rates (`knox_review:percentage`): each pass
 * re-reads a batch against its document's current text. A rate in a category that
 * publishes rates (`percentFeeAllowed`) that traces to the text becomes a rate fee
 * (`amount_kind` 'percent', amount NULL) with a clean name and goes to Darwin; the rest
 * are marked so they are not re-read until the rate rules change.
 */
export const HELD_RATE_RECHECK_VERSION = 1;
export const HELD_RATE_RECHECK_DEFAULT_LIMIT = 100;

export function heldRateRecheckFlag(version: number = HELD_RATE_RECHECK_VERSION): string {
  return `knox_rate_recheck:v${version}`;
}

export interface HeldRateRow {
  fee_raw_id: number | string;
  source_document_id: number | string;
  fee_name: string;
  conditions: string | null;
  frequency: string | null;
  outlier_flags: string[] | null;
  normalized_text: string | null;
}

export interface HeldRateRecheckResult {
  checked: number;
  promoted: number;
  stillHeld: number;
  promotedByCategory: Record<string, number>;
  /** Why held rows stayed held. */
  heldReasons: Record<string, number>;
  dryRun: boolean;
}

/** Today's rate rules on a held percentage row: the rate fee it becomes, or why it stays held. */
export function rateFromHeldRow(row: HeldRateRow): RateFeeCandidate | RateHoldReason {
  const excerpt = heldExcerpt(row.conditions);
  if (!excerpt) return "no_rate";
  const hint = (row.outlier_flags ?? []).find((flag) => flag.startsWith("canonical_hint:"))?.slice("canonical_hint:".length) ?? null;
  return rateFeeFromHeld(
    { shape: "percentage", feeName: row.fee_name, canonicalHint: hint, percent: null, frequency: row.frequency, excerpt },
    row.normalized_text,
  );
}

export async function recheckHeldRates(
  db: SqlTag,
  options: { limit?: number; dryRun?: boolean; institutionId?: number | null; stateCode?: string | null } = {},
): Promise<HeldRateRecheckResult> {
  const limit = Math.max(1, Math.min(Number(options.limit) || HELD_RATE_RECHECK_DEFAULT_LIMIT, 500));
  const dryRun = Boolean(options.dryRun);
  const recheckFlag = heldRateRecheckFlag();
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const rows = await db<HeldRateRow[]>`
    SELECT fr.fee_raw_id, fr.source_document_id, fr.fee_name, fr.conditions, fr.frequency,
           ARRAY(SELECT jsonb_array_elements_text(COALESCE(fr.outlier_flags, '[]'::jsonb))) AS outlier_flags,
           adt.normalized_text
      FROM raw_fee_observations fr
      JOIN institution_sources inst ON inst.id = fr.institution_id
      JOIN LATERAL (
        SELECT t.normalized_text
          FROM agent_source_texts t
         WHERE t.source_document_id = fr.source_document_id
           AND t.status = 'completed'
           AND t.text_hash IS NOT NULL
           AND position(('text_hash=' || t.text_hash || ';') IN COALESCE(fr.conditions, '')) > 0
         ORDER BY t.id DESC
         LIMIT 1
      ) adt ON true
     WHERE fr.source = 'knox'
       AND fr.amount IS NULL
       AND fr.amount_kind = 'flat'
       AND fr.outlier_flags ? 'knox_review:percentage'
       AND NOT fr.outlier_flags ? 'needs_darwin_verification'
       AND NOT fr.outlier_flags ? ${recheckFlag}
       AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
     ORDER BY fr.fee_raw_id
     LIMIT ${limit}
  `;

  const promotedByCategory: Record<string, number> = {};
  const heldReasons: Record<string, number> = {};
  const stillHeldIds: number[] = [];
  let promoted = 0;
  for (const row of rows) {
    const rate = rateFromHeldRow(row);
    if (typeof rate === "string") {
      heldReasons[rate] = (heldReasons[rate] ?? 0) + 1;
      stillHeldIds.push(Number(row.fee_raw_id));
      continue;
    }
    if (!dryRun) {
      const oldHints = (row.outlier_flags ?? []).filter((flag) => flag.startsWith("canonical_hint:"));
      const flags = ["needs_darwin_verification", `canonical_hint:${rate.canonicalHint}`, HELD_RECHECK_PROMOTED_FLAG, KNOX_RATE_FEE_FLAG];
      // The dedupe index (document, name, amount) treats every rate as amount -1: a second
      // row of the same document under the same clean name stays held.
      const updated = await db`
        UPDATE raw_fee_observations fr
           SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'knox_review:percentage' - ${oldHints}::text[])
                               || ${JSON.stringify(flags)}::jsonb,
               fee_name = ${rate.feeName},
               conditions = ${(row.conditions ?? "").replace(/^Knox held for review \(percentage\)/, `Knox rate rules v${HELD_RATE_RECHECK_VERSION} read a percentage fee held for review`).replace(/canonical_hint=[^;]*;/, `canonical_hint=${rate.canonicalHint};`)},
               amount_kind = 'percent',
               rate_percent = ${rate.ratePercent},
               rate_min_amount = ${rate.rateMinAmount},
               rate_max_amount = ${rate.rateMaxAmount},
               rate_basis = ${rate.rateBasis}
         WHERE fr.fee_raw_id = ${Number(row.fee_raw_id)}
           AND fr.amount IS NULL
           AND fr.outlier_flags ? 'knox_review:percentage'
           AND NOT fr.outlier_flags ? 'needs_darwin_verification'
           AND NOT EXISTS (
             SELECT 1 FROM raw_fee_observations other
              WHERE other.source = 'knox'
                AND other.source_document_id = fr.source_document_id
                AND lower(other.fee_name) = lower(${rate.feeName})
                AND other.amount IS NULL
                AND other.fee_raw_id <> fr.fee_raw_id
           )
        RETURNING fr.fee_raw_id
      `;
      if (updated.length === 0) {
        heldReasons.duplicate_name = (heldReasons.duplicate_name ?? 0) + 1;
        stillHeldIds.push(Number(row.fee_raw_id));
        continue;
      }
    }
    promoted += 1;
    promotedByCategory[rate.canonicalHint] = (promotedByCategory[rate.canonicalHint] ?? 0) + 1;
  }

  if (!dryRun && stillHeldIds.length > 0) {
    await db`
      UPDATE raw_fee_observations
         SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([recheckFlag])}::jsonb
       WHERE fee_raw_id = ANY(${stillHeldIds}::bigint[])
    `;
  }

  return { checked: rows.length, promoted, stillHeld: stillHeldIds.length, promotedByCategory, heldReasons, dryRun };
}
