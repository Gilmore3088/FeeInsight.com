import { sql } from "@/lib/data-store/connection";
import { extractFromSegment, type ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { rateFeeFromHeld, type RateFeeCandidate, type RateHoldReason } from "@/lib/agents/knox/percent";
import { KNOX_RATE_FEE_FLAG } from "@/lib/agents/knox/extract";

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

export function heldRecheckFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_recheck:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

export interface HeldRow {
  fee_raw_id: number | string;
  amount: number | string | null;
  conditions: string | null;
}

export interface HeldRecheckResult {
  checked: number;
  promoted: number;
  stillHeld: number;
  /** Category -> lines promoted to it in this pass. */
  promotedByCategory: Record<string, number>;
  dryRun: boolean;
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
  options: { limit?: number; dryRun?: boolean; institutionId?: number | null; stateCode?: string | null } = {},
): Promise<HeldRecheckResult> {
  const limit = Math.max(1, Math.min(Number(options.limit) || HELD_RECHECK_DEFAULT_LIMIT, 1000));
  const dryRun = Boolean(options.dryRun);
  const recheckFlag = heldRecheckFlag();
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const rows = await db<HeldRow[]>`
    SELECT fr.fee_raw_id, fr.amount, fr.conditions
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
  let promoted = 0;
  for (const row of rows) {
    const candidate = recategorizeHeld(row);
    if (!candidate) {
      stillHeldIds.push(Number(row.fee_raw_id));
      continue;
    }
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

  return { checked: rows.length, promoted, stillHeld: stillHeldIds.length, promotedByCategory, dryRun };
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
