import { sql } from "@/lib/data-store/connection";
import { classifyFeeText, extractFromSegment, type ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { rateFeeFromHeld, type RateFeeCandidate, type RateHoldReason } from "@/lib/agents/knox/percent";
import { KNOX_RATE_FEE_FLAG, KNOX_REREAD_ASSET_FLOOR } from "@/lib/agents/knox/extract";
import { currentCopySchemaReady } from "@/lib/agents/magellan/current-copy";
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
 *
 * v34: a line held as a range that says the bank changed a price ("We've lowered Overdraft
 * Paid Item fees from $38 to $30", Pinnacle) is re-read too, since today's rules read the
 * later figure as the price. It is promoted only when that price is the row's stored
 * amount (the range's lower end), so a raised price ("increased from $4 to $5") stays held.
 */
export const HELD_RECHECK_DEFAULT_LIMIT = 300;
/** Range lines worth re-reading: those that say a price was changed (see `FEE_CHANGED_FROM` in rules.ts). */
export const CHANGED_PRICE_RANGE_SQL = String.raw`\m(lowered|reduced|decreased|raised|increased|changed)\M[^$]{0,120}\mfrom\s*\$`;
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
      /^Knox held for review \((?:unclassified|range)\)/,
      `Knox ${KNOX_RULES_STRATEGY.strategy} v${KNOX_RULES_STRATEGY.version} categorized a line held for review`,
    )
    .replace(/canonical_hint=none;/, `canonical_hint=${candidate.canonicalHint};`);
}

/**
 * v34: the held row keeps its name when that name already says the category; a name
 * that does not ("You still pay", Park National) takes the one today's rules read from
 * the same excerpt, so Darwin's category guard can check it.
 */
export function promotedName(row: HeldRow, candidate: ExtractedFeeCandidate): string {
  const name = row.fee_name?.trim();
  return name && classifyFeeText(name) === candidate.canonicalHint ? name : candidate.feeName;
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
       AND (fr.outlier_flags ? 'knox_review:unclassified'
            OR (fr.outlier_flags ? 'knox_review:range' AND fr.conditions ~* ${CHANGED_PRICE_RANGE_SQL}))
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
     -- $10B+ banks first, as Knox's re-reads go: a full pass over every held line takes
     -- about 12 hours at 300 a step, and the largest banks' gaps show most.
     ORDER BY (COALESCE(inst.asset_size, 0) >= ${KNOX_REREAD_ASSET_FLOOR}) DESC, fr.fee_raw_id
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
           SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'knox_review:unclassified' - 'knox_review:range')
                               || ${JSON.stringify(flags)}::jsonb,
               conditions = ${promotedConditions(row.conditions ?? "", candidate)},
               extraction_confidence = ${candidate.confidence},
               frequency = COALESCE(fr.frequency, ${candidate.frequency}),
               fee_name = ${promotedName(row, candidate)}
         WHERE fr.fee_raw_id = ${Number(row.fee_raw_id)}
           AND (fr.outlier_flags ? 'knox_review:unclassified' OR fr.outlier_flags ? 'knox_review:range')
           AND NOT fr.outlier_flags ? 'needs_darwin_verification'
           -- The dedupe index is (document, name, amount): a held "Stop Payment (each)" renamed
           -- "Stop Payment" beside the same page's "Stop Payment" row is that fee already, and
           -- renaming it failed the whole extract step (Guaranty Bank and Trust, Oct 8).
           AND NOT EXISTS (
             SELECT 1 FROM raw_fee_observations other
              WHERE other.source = 'knox'
                AND other.source_document_id = fr.source_document_id
                AND lower(other.fee_name) = lower(${promotedName(row, candidate)})
                AND COALESCE(other.amount, -1) = COALESCE(fr.amount, -1)
                AND other.fee_raw_id <> fr.fee_raw_id
           )
        RETURNING fr.fee_raw_id
      `;
      if (updated.length === 0) {
        stillHeldIds.push(Number(row.fee_raw_id));
        continue;
      }
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
 * A fee Knox read but held because the self-check could not trace it to its source
 * (`knox_review:untraced`) stayed held after the self-check learned to trace it: Knox does
 * not extract a text twice per rules version, and the raw-row dedupe (document, name,
 * amount) kept the held row in place of the traced read. Arvest's "Overdraft (OD) - Paid
 * Item" $17 (raw 449097) was held at 04:50 on 9 Oct, traced from v57 on, and still held at
 * 08:15 (1,568 such rows at 774 banks then).
 *
 * Each pass re-reads the current text of a batch of those rows with today's free team. A row
 * is promoted to Darwin only when today's team reads a traced fee with the row's own name,
 * amount and category; the rest are marked with the rules version and read again when the
 * rules change. Nothing is deleted.
 */
export const UNTRACED_RECHECK_LIMIT = 100;
export const UNTRACED_RECHECK_PROMOTED_FLAG = "knox_promoted_from_untraced";

export function untracedRecheckFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_untraced_recheck:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

/** The category Knox read for a held row (`canonical_hint=X;` in its audit text), or null. */
export function heldHint(conditions: string | null): string | null {
  const hint = /canonical_hint=([a-z_]+);/.exec(conditions ?? "")?.[1];
  return hint && hint !== "none" ? hint : null;
}

/** Today's traced read of an untraced held row: same name, amount and category. Pure. */
export function tracedRead(row: HeldRow, candidates: ExtractedFeeCandidate[]): ExtractedFeeCandidate | null {
  const hint = heldHint(row.conditions);
  const name = (row.fee_name ?? "").trim().toLowerCase();
  const amount = Number(row.amount);
  if (!hint || !name || row.amount == null || !Number.isFinite(amount)) return null;
  return candidates.find((candidate) =>
    candidate.canonicalHint === hint &&
    Math.abs(candidate.amount - amount) < 0.005 &&
    candidate.feeName.trim().toLowerCase() === name,
  ) ?? null;
}

export interface UntracedRecheckResult {
  checked: number;
  promoted: number;
  stillHeld: number;
  dryRun: boolean;
}

export async function recheckUntracedRows(
  db: SqlTag,
  options: { limit?: number; dryRun?: boolean; institutionId?: number | null; stateCode?: string | null } = {},
): Promise<UntracedRecheckResult> {
  const limit = Math.max(1, Math.min(Number(options.limit) || UNTRACED_RECHECK_LIMIT, 500));
  const dryRun = Boolean(options.dryRun);
  const flag = untracedRecheckFlag();
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const rows = await db<Array<HeldRow & { document_text_id: number | string }>>`
    SELECT fr.fee_raw_id, fr.amount, fr.conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags, adt.id AS document_text_id
      FROM raw_fee_observations fr
      JOIN institution_sources inst ON inst.id = fr.institution_id
      JOIN agent_source_texts adt
        ON adt.source_document_id = fr.source_document_id
       AND adt.status = 'completed'
       AND adt.text_hash IS NOT NULL
       AND position(('text_hash=' || adt.text_hash || ';') IN COALESCE(fr.conditions, '')) > 0
     WHERE fr.source = 'knox'
       AND fr.outlier_flags ? 'knox_review:untraced'
       AND NOT fr.outlier_flags ? 'needs_darwin_verification'
       AND NOT fr.outlier_flags ? ${flag}
       AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
     ORDER BY (COALESCE(inst.asset_size, 0) >= ${KNOX_REREAD_ASSET_FLOOR}) DESC, fr.fee_raw_id
     LIMIT ${limit}
  `;
  if (rows.length === 0) return { checked: 0, promoted: 0, stillHeld: 0, dryRun };

  const textIds = [...new Set(rows.map((row) => Number(row.document_text_id)))];
  const texts = await db<Array<{ id: number | string; normalized_text: string | null }>>`
    SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${textIds}::bigint[])
  `;
  const reads = new Map<number, ExtractedFeeCandidate[]>();
  for (const text of texts) reads.set(Number(text.id), text.normalized_text ? runFreeSpecialists(text.normalized_text).candidates : []);

  const stillHeldIds: number[] = [];
  let promoted = 0;
  for (const row of rows) {
    const read = tracedRead(row, reads.get(Number(row.document_text_id)) ?? []);
    if (!read) {
      stillHeldIds.push(Number(row.fee_raw_id));
      continue;
    }
    if (!dryRun) {
      const flags = ["needs_darwin_verification", `canonical_hint:${read.canonicalHint}`, UNTRACED_RECHECK_PROMOTED_FLAG];
      if (read.waivable) flags.push("waivable");
      const conditions = (row.conditions ?? "").replace(
        /^Knox held for review \(untraced\)/,
        `Knox ${KNOX_RULES_STRATEGY.strategy} v${KNOX_RULES_STRATEGY.version} traced a line held for review`,
      );
      const updated = await db`
        UPDATE raw_fee_observations fr
           SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'knox_review:untraced') || ${JSON.stringify(flags)}::jsonb,
               conditions = ${conditions},
               extraction_confidence = ${read.confidence},
               frequency = COALESCE(fr.frequency, ${read.frequency})
         WHERE fr.fee_raw_id = ${Number(row.fee_raw_id)}
           AND fr.outlier_flags ? 'knox_review:untraced'
           AND NOT fr.outlier_flags ? 'needs_darwin_verification'
        RETURNING fr.fee_raw_id
      `;
      if (updated.length === 0) {
        stillHeldIds.push(Number(row.fee_raw_id));
        continue;
      }
    }
    promoted += 1;
  }
  if (!dryRun && stillHeldIds.length > 0) {
    await db`
      UPDATE raw_fee_observations
         SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([flag])}::jsonb
       WHERE fee_raw_id = ANY(${stillHeldIds}::bigint[])
    `;
  }
  return { checked: rows.length, promoted, stillHeld: stillHeldIds.length, dryRun };
}

/**
 * A re-read retires the rows Knox took from a document's older text (`superseded_by_reread`),
 * then inserts today's read. The raw dedupe (document, name, amount) keeps the retired row, so
 * a line the new text still prints under the same name and price was dropped, and the fee was
 * read but never reached Darwin. Northern Trust's "Overdrafts Paid and Items Paid against
 * Nonsufficient Funds" $25 (raw 457013) was retired and blocked this way at 08:46 on 9 Oct.
 *
 * Each pass re-reads the current text of a batch of retired rows with today's free team. A row
 * goes back to Darwin only when today's team reads a traced fee with the row's own name, amount
 * and category, and the bank has no live fee of that category at that price (a live twin). Its
 * audit text takes the current text's hash, so the next re-read of that text keeps it. The rest
 * are marked with the rules version and read again when the rules change. Nothing is deleted.
 *
 * `SUPERSEDED_RECHECK_LIVE` off is a dry read: each row is read once per rules version and
 * marked with what the pass would do (`knox_superseded_would_promote:vN`), and nothing goes to
 * Darwin.
 */
export const SUPERSEDED_RECHECK_LIVE = false;
export const SUPERSEDED_RECHECK_LIMIT = 100;
export const SUPERSEDED_RECHECK_PROMOTED_FLAG = "knox_promoted_from_superseded";

export function supersededRecheckFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_superseded_recheck:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

export function supersededDryReadFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_superseded_dry_read:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

export function supersededWouldPromoteFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_superseded_would_promote:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

/** A retired row's audit text with the current text's hash and a note of today's read. Pure. */
export function supersededConditions(conditions: string | null, textHash: string, textId: number | string): string {
  const note = `Knox ${KNOX_RULES_STRATEGY.strategy} v${KNOX_RULES_STRATEGY.version} read this line again in Rosetta artifact #${textId}. `;
  return note + (conditions ?? "").replace(/text_hash=[0-9a-f]+;/, `text_hash=${textHash};`);
}

export interface SupersededRecheckResult {
  checked: number;
  promoted: number;
  liveTwin: number;
  notRead: number;
  promotedIds: number[];
  live: boolean;
  dryRun: boolean;
}

export async function recheckSupersededRows(
  db: SqlTag,
  options: { limit?: number; dryRun?: boolean; live?: boolean; institutionId?: number | null; stateCode?: string | null } = {},
): Promise<SupersededRecheckResult> {
  const limit = Math.max(1, Math.min(Number(options.limit) || SUPERSEDED_RECHECK_LIMIT, 500));
  const dryRun = Boolean(options.dryRun);
  const live = options.live ?? SUPERSEDED_RECHECK_LIVE;
  const flag = live ? supersededRecheckFlag() : supersededDryReadFlag();
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const empty = { checked: 0, promoted: 0, liveTwin: 0, notRead: 0, promotedIds: [], live, dryRun };
  // Only a document's current copy can bring a line back (before the copy migration, none).
  if (!(await currentCopySchemaReady(db))) return empty;
  const rows = await db<Array<HeldRow & { document_text_id: number | string; text_hash: string; has_live_twin: boolean }>>`
    SELECT fr.fee_raw_id, fr.amount, fr.conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags, adt.id AS document_text_id, adt.text_hash,
           EXISTS (
             SELECT 1 FROM published_fee_catalog pc
              WHERE pc.institution_id = fr.institution_id
                AND pc.fee_category = substring(fr.conditions FROM 'canonical_hint=([a-z_]+);')
                AND pc.amount = fr.amount
           ) AS has_live_twin
      FROM raw_fee_observations fr
      JOIN institution_sources inst ON inst.id = fr.institution_id
      JOIN source_documents doc ON doc.id = fr.source_document_id AND doc.superseded_by_id IS NULL
      JOIN LATERAL (
        SELECT t.id, t.text_hash FROM agent_source_texts t
         WHERE t.source_document_id = fr.source_document_id
           AND t.status = 'completed'
           AND t.text_hash IS NOT NULL
           AND t.normalized_text IS NOT NULL
         ORDER BY t.id DESC
         LIMIT 1
      ) adt ON TRUE
     WHERE fr.source = 'knox'
       AND fr.outlier_flags ? 'superseded_by_reread'
       AND NOT fr.outlier_flags ? 'needs_darwin_verification'
       AND NOT fr.outlier_flags ? ${flag}
       AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
       AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
     ORDER BY (COALESCE(inst.asset_size, 0) >= ${KNOX_REREAD_ASSET_FLOOR}) DESC, fr.fee_raw_id
     LIMIT ${limit}
  `;
  if (rows.length === 0) return empty;

  const textIds = [...new Set(rows.map((row) => Number(row.document_text_id)))];
  const texts = await db<Array<{ id: number | string; normalized_text: string | null }>>`
    SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${textIds}::bigint[])
  `;
  const reads = new Map<number, ExtractedFeeCandidate[]>();
  for (const text of texts) reads.set(Number(text.id), text.normalized_text ? runFreeSpecialists(text.normalized_text).candidates : []);

  const markedIds: number[] = [];
  const wouldPromoteIds: number[] = [];
  const promotedIds: number[] = [];
  let liveTwin = 0;
  let notRead = 0;
  for (const row of rows) {
    const read = tracedRead(row, reads.get(Number(row.document_text_id)) ?? []);
    if (!read) {
      notRead += 1;
      markedIds.push(Number(row.fee_raw_id));
      continue;
    }
    if (row.has_live_twin) {
      liveTwin += 1;
      markedIds.push(Number(row.fee_raw_id));
      continue;
    }
    if (!live) {
      wouldPromoteIds.push(Number(row.fee_raw_id));
      markedIds.push(Number(row.fee_raw_id));
      continue;
    }
    if (!dryRun) {
      const flags = ["needs_darwin_verification", `canonical_hint:${read.canonicalHint}`, SUPERSEDED_RECHECK_PROMOTED_FLAG];
      if (read.waivable) flags.push("waivable");
      const updated = await db`
        UPDATE raw_fee_observations fr
           SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'superseded_by_reread') || ${JSON.stringify(flags)}::jsonb,
               conditions = ${supersededConditions(row.conditions, row.text_hash, row.document_text_id)},
               extraction_confidence = ${read.confidence},
               frequency = COALESCE(fr.frequency, ${read.frequency})
         WHERE fr.fee_raw_id = ${Number(row.fee_raw_id)}
           AND fr.outlier_flags ? 'superseded_by_reread'
           AND NOT fr.outlier_flags ? 'needs_darwin_verification'
        RETURNING fr.fee_raw_id
      `;
      if (updated.length === 0) {
        markedIds.push(Number(row.fee_raw_id));
        continue;
      }
    }
    promotedIds.push(Number(row.fee_raw_id));
  }
  if (!dryRun && markedIds.length > 0) {
    await db`
      UPDATE raw_fee_observations
         SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([flag])}::jsonb
       WHERE fee_raw_id = ANY(${markedIds}::bigint[])
    `;
  }
  if (!dryRun && wouldPromoteIds.length > 0) {
    await db`
      UPDATE raw_fee_observations
         SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([supersededWouldPromoteFlag()])}::jsonb
       WHERE fee_raw_id = ANY(${wouldPromoteIds}::bigint[])
    `;
  }
  return {
    checked: rows.length,
    promoted: live ? promotedIds.length : wouldPromoteIds.length,
    liveTwin,
    notRead,
    promotedIds: live ? promotedIds : wouldPromoteIds,
    live,
    dryRun,
  };
}

/**
 * A rules fix can take back a category an earlier version gave a held line (v30: "Phone Call
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
