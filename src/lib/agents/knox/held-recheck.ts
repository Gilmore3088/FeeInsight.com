import { feeApplicability, scopedFeeStatements } from "@/lib/fee-audience";
import { sql } from "@/lib/data-store/connection";
import {
  classifyFeeText,
  confidenceFor,
  extractFromSegment,
  KNOX_HELD_NAME_RULES_LIVE,
  withHeldNameRules,
  type ExtractedFeeCandidate,
} from "@/lib/agents/knox/rules";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { rateFeeFromHeld, type RateFeeCandidate, type RateHoldReason } from "@/lib/agents/knox/percent";
import { KNOX_RATE_FEE_FLAG, KNOX_REREAD_ASSET_FLOOR } from "@/lib/agents/knox/extract";
import { KNOX_PAID_FLAG } from "@/lib/agents/knox/paid-extract";
import { currentCopySchemaReady } from "@/lib/agents/magellan/current-copy";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { NAME_LABEL_KIND } from "@/lib/agents/knox/label-queue";

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
  // A one-row recheck cannot replace one row with two audiences. The full document
  // reread creates new scoped observations; the ambiguous historical row stays held.
  if (scopedFeeStatements(excerpt).length > 0) return null;
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
    SELECT fr.fee_raw_id, fr.amount, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags
      FROM raw_fee_observations fr
      JOIN institution_sources inst ON inst.id = fr.institution_id
     WHERE fr.source = 'knox'
       AND (fr.outlier_flags ? 'knox_review:unclassified'
            OR (fr.outlier_flags ? 'knox_review:range' AND COALESCE(fr.extraction_note, fr.conditions) ~* ${CHANGED_PRICE_RANGE_SQL}))
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
            AND position(('text_hash=' || adt.text_hash || ';') IN COALESCE(COALESCE(fr.extraction_note, fr.conditions), '')) > 0
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
      // #1102: a line only the held-name rules file carries its own flag, so the release can be
      // counted and reversed on its own.
      if (KNOX_HELD_NAME_RULES_LIVE && !withHeldNameRules(false, () => recategorizeHeld(row))) flags.push(HELD_NAME_RULE_FLAG);
      const applicability = feeApplicability(promotedName(row, candidate), candidate.excerpt, candidate.amount);
      const updated = await db`
        UPDATE raw_fee_observations fr
           SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'knox_review:unclassified' - 'knox_review:range')
                               || ${JSON.stringify(flags)}::jsonb,
               extraction_note = ${promotedConditions(row.conditions ?? "", candidate)},
               conditions = NULL,
               extraction_confidence = ${candidate.confidence},
               frequency = COALESCE(fr.frequency, ${candidate.frequency}),
               fee_name = ${promotedName(row, candidate)},
               fee_audience = ${applicability.feeAudience},
               audience_evidence = ${applicability.audienceEvidence},
               fee_treatment = ${applicability.feeTreatment}
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
                AND other.fee_audience = ${applicability.feeAudience}
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
 * #1102 (K9): the held lines the held-name rules (`HELD_NAME_PATTERNS` in rules.ts) would send to
 * Darwin, read while the switch is off. Each extract step reads every held unclassified line on
 * its document's current text whose line could match one (`HELD_NAME_PREFILTER_SQL`, a superset),
 * and counts those only the held-name rules price at the row's own amount, and of those, the ones
 * that pass Darwin's category guard and trace on their own line with the shared source check.
 * Writes nothing; the step's detail (`held_name_preview`) is the dry run James reads.
 *
 * Production, 14 Oct 2026 (local run over the 4,304 prefiltered lines): 645 would go, 638 of them
 * pass both checks, at 299 banks; 436 of the 638 are set aside.
 */
export const HELD_NAME_RULE_FLAG = "knox_held_name_rule";
export const HELD_NAME_PREVIEW_LIMIT = 6000;
const HELD_NAME_PREVIEW_EXAMPLES = 10;
/** Every held-name rule needs one of these words in its line (box sizes: a prime mark). */
export const HELD_NAME_PREFILTER_SQL = String.raw`(stop[- ]?p|reconvey|clos|club|statement|\mIRA\M|[″′])`;

export interface HeldNamePreviewResult {
  live: boolean;
  /** Held unclassified lines read (prefiltered). */
  candidates: number;
  /** Lines only the held-name rules price at the row's own amount. */
  wouldRelease: number;
  /** Of those, lines that pass the category guard and trace on their own line. */
  passChecks: number;
  setAside: number;
  institutions: number;
  byCategory: Record<string, number>;
  examples: Array<{ feeRawId: number; feeName: string; amount: number; category: string }>;
}

/** The held-name rules' verdict on one held line: null unless only they file it. Pure. */
export function heldNameRelease(row: HeldRow): { candidate: ExtractedFeeCandidate; name: string; passChecks: boolean } | null {
  if (withHeldNameRules(false, () => recategorizeHeld(row))) return null;
  return withHeldNameRules(true, () => {
    const candidate = recategorizeHeld(row);
    if (!candidate) return null;
    const name = promotedName(row, candidate);
    const passChecks = checkFeeCategory(candidate.canonicalHint, name).ok &&
      checkFeeAgainstSource(heldExcerpt(row.conditions), name, candidate.amount, ".", candidate.canonicalHint).ok;
    return { candidate, name, passChecks };
  });
}

export async function previewHeldNameRules(
  db: SqlTag,
  options: { limit?: number; institutionId?: number | null; stateCode?: string | null } = {},
): Promise<HeldNamePreviewResult> {
  const empty: HeldNamePreviewResult = {
    live: KNOX_HELD_NAME_RULES_LIVE, candidates: 0, wouldRelease: 0, passChecks: 0, setAside: 0, institutions: 0, byCategory: {}, examples: [],
  };
  // Live, the held re-check sends these lines itself (`HELD_NAME_RULE_FLAG`).
  if (KNOX_HELD_NAME_RULES_LIVE) return empty;
  const limit = Math.max(1, Math.min(Number(options.limit) || HELD_NAME_PREVIEW_LIMIT, HELD_NAME_PREVIEW_LIMIT));
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const rows = await db<HeldRow[]>`
    SELECT fr.fee_raw_id, fr.amount, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags
      FROM raw_fee_observations fr
      JOIN institution_sources inst ON inst.id = fr.institution_id
     WHERE fr.source = 'knox'
       AND fr.outlier_flags ? 'knox_review:unclassified'
       AND NOT fr.outlier_flags ? 'needs_darwin_verification'
       AND substring(COALESCE(fr.extraction_note, fr.conditions) from 'excerpt="(.*)"') ~* ${HELD_NAME_PREFILTER_SQL}
       AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
       AND EXISTS (
         SELECT 1
           FROM agent_source_texts adt
          WHERE adt.source_document_id = fr.source_document_id
            AND adt.status = 'completed'
            AND adt.text_hash IS NOT NULL
            AND position(('text_hash=' || adt.text_hash || ';') IN COALESCE(COALESCE(fr.extraction_note, fr.conditions), '')) > 0
       )
     ORDER BY fr.fee_raw_id
     LIMIT ${limit}
  `;
  const result = { ...empty, candidates: rows.length };
  const banks = new Set<number>();
  for (const row of rows) {
    const release = heldNameRelease(row);
    if (!release) continue;
    result.wouldRelease += 1;
    if (!release.passChecks) continue;
    result.passChecks += 1;
    if (flagList(row.outlier_flags).includes(HELD_SET_ASIDE_FLAG)) result.setAside += 1;
    if (row.institution_id != null) banks.add(Number(row.institution_id));
    const category = release.candidate.canonicalHint;
    result.byCategory[category] = (result.byCategory[category] ?? 0) + 1;
    if (result.examples.length < HELD_NAME_PREVIEW_EXAMPLES) {
      result.examples.push({ feeRawId: Number(row.fee_raw_id), feeName: release.name, amount: release.candidate.amount, category });
    }
  }
  result.institutions = banks.size;
  return result;
}

/**
 * #1102: one decision per held name, across banks. A line Knox held as unclassified has a name
 * no rule files, so the held re-check above keeps it until the rules learn it. Two decisions file
 * the name instead, and send every held line with that exact name (`lessonName`) to Darwin:
 *
 * - a person's label (`label-queue.ts`, a `name_label` row): the labelled category, or no move for
 *   "No category fits";
 * - the store: with no label, a name that says fee or charge and is live (`published_fee_records`,
 *   flat, not rolled back or quarantined) under exactly one category at `SETTLED_NAME_MIN_BANKS` or
 *   more banks, and no other category, is settled ("Returned Statement Fee" at 3 banks, account research; "Rush Fee" at 6, rush card).
 *
 * A store decision files only a name that says fee or charge ("Minimum Balance" is a requirement,
 * and a box size's name key is only "x"). A line moves only when its own price is a plain price for
 * that category: it states no requirement ("to avoid", "required", "minimum balance to open"), it
 * is not one column of a table of accounts ("| None | $7.00 | $10.00"), Darwin's category guard
 * and price range accept it (`passesDarwinChecks`), today's name classifier does not read the name
 * as another category (a subordination live as other lending at 70 banks files as legal process
 * since Oct 15), the line is not a rate or a bundle price ("4 for $2"), and the row's price is the
 * line's price for that name (`priceUnderName`). It goes to Darwin with
 * `knox_name_filed:<label|store>` and `canonical_hint:<key>`, and keeps its name and amount. Darwin
 * still decides; Hamilton's rules re-check keeps such a fee live while its name and price trace in
 * its own text. A line that matched a decision but could not move is marked
 * `knox_name_file_checked:<ISO week>` and not read again by this pass that week. When a lane's pass
 * covers every candidate, the lane's other held lines get the same week mark, so the rest of the
 * week's steps read only new held lines, and the live-fee join behind the settled names has nothing
 * to probe (review of #1385: no scan of the live fees in every extract step). Set-aside lines are read too: the
 * decision is new, not the rules.
 */
export const NAME_FILED_FLAG_PREFIX = "knox_name_filed:";
export const NAME_FILE_CHECKED_PREFIX = "knox_name_file_checked:";

/** The week mark ("knox_name_file_checked:2026-W42", ISO week, UTC): lines are read again weekly. */
export function nameFileCheckedFlag(now: Date = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${NAME_FILE_CHECKED_PREFIX}${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
export const SETTLED_NAME_MIN_BANKS = 5;
export const NAME_FILE_LIMIT = 300;
/** A rate, or a price for a bundle of items, is not the plain price the store's fees are. */
const NOT_A_PLAIN_PRICE = /%|\b\d+\s+(?:for|per)\s+\$/i;
const DOLLAR_PRICE = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/;

/**
 * The row's price is the line's price for its name: the first price after the name when the line
 * prints the name, else the line's first price. "$10.00/month if none of the above criteria are met.
 * | Paper Statement Fee (per Statement) | $2.50" (raw 421833) is a $2.50 fee, not a $10 one. Pure.
 */
export function priceUnderName(name: string, excerpt: string, amount: number): boolean {
  const at = excerpt.toLowerCase().indexOf(name.trim().toLowerCase());
  const after = at >= 0 ? excerpt.slice(at + name.trim().length) : excerpt;
  const first = DOLLAR_PRICE.exec(after);
  if (first == null) return false;
  // The price belongs to another fee when that fee's name stands between ("Overdraft Transfer Fee
  // (Applicable to ... | Inquiry Fee12. . . . $1.00", raw 506621: the $1 is the inquiry fee's).
  if (OTHER_FEE_NAME.test(after.slice(0, first.index))) return false;
  return Math.abs(Number(first[1].replace(/,/g, "")) - amount) < 0.005;
}

/**
 * The clause that holds the row's price reads as another fee: "Monthly Service Charge¹ | ... A $25 fee
 * will be assessed for early withdrawals" (raw 454145) is an early-withdrawal price. Pure.
 */
export function priceClauseNamesOtherFee(key: string, name: string, excerpt: string, amount: number): boolean {
  const at = excerpt.toLowerCase().indexOf(name.trim().toLowerCase());
  const after = at >= 0 ? excerpt.slice(at + name.trim().length) : excerpt;
  const first = DOLLAR_PRICE.exec(after);
  if (!first || Math.abs(Number(first[1].replace(/,/g, "")) - amount) >= 0.005) return false;
  const start = Math.max(after.lastIndexOf("|", first.index), after.lastIndexOf(". ", first.index)) + 1;
  const ends = [after.indexOf("|", first.index), after.indexOf(". ", first.index)].filter((index) => index >= 0);
  const clause = after.slice(start, ends.length > 0 ? Math.min(...ends) : after.length);
  const reads = classifyFeeText(clause);
  if (reads != null && reads !== key) return true;
  // The classifier needs a fee's own name; a clause that prices a withdrawal or excess activity
  // is that fee's price whatever the row's name says.
  return OTHER_ACTIVITY_CLAUSE.test(clause) && key !== "early_closure" && key !== "account_research";
}

const OTHER_ACTIVITY_CLAUSE = /\bearly (?:withdrawals?|closures?|closing)\b|\bexcess(?:ive)? (?:withdrawals?|transactions?|activity)\b/i;

/** Another fee's name in a later cell: capitalized words ending in Fee or Charge, not "Fee charged ...". */
const OTHER_FEE_NAME = /(?:\||[.…]{2,}|\)\s)\s*(?:[A-Z][\w'’/&-]*\s+){0,4}(?:Fee|FEE|Charge|CHARGE)s?\d*\b(?!\s+(?:charged|is|applies|assessed|of|for|will|may))/;

export type NameFiledBy = "label" | "store";

/** A store decision needs the name live at this many banks (`SETTLED_NAME_MIN_BANKS` is the floor). */
export const SETTLED_TWO_WORD_MIN_BANKS = 10;
/** And this share of the name's live rows in one category. */
export const SETTLED_NAME_MIN_SHARE = 0.9;
/** Categories a lending fee belongs to; elsewhere a lending word on the line contradicts the filing. */
const LENDING_CATEGORIES: ReadonlySet<string> = new Set(["late_payment", "loan_origination", "appraisal_fee", "vehicle_title", "other_lending_fee", "cash_advance"]);
const LENDING_WORDS = /\b(?:loans?|heloc|home equity|mortgages?|lines? of credit|titled?|titles|liens?|collateral|deed)\b/i;
const COPY_WORDS = /\b(?:cop(?:y|ies)|photocop(?:y|ies)|research|reprint)\b/i;
/** A store decision's line contradicts its category ("Temporary Lien Fee ... collateral titled", a "Statement Fee | $2.00/Copy"). Pure. */
export function lineContradictsCategory(key: string, excerpt: string): boolean {
  if (LENDING_WORDS.test(excerpt) && !LENDING_CATEGORIES.has(key)) return true;
  return key === "paper_statement" && COPY_WORDS.test(excerpt);
}

/** A fee's name: it says fee or charge. "Minimum Balance" is a requirement, never a fee. */
const FEE_WORD_NAME = /\b(?:fees?|charges?)\b/i;
/** Requirement wording on the line: a balance to keep or an amount to open, not a price. */
const REQUIREMENT_LINE = /\bto avoid\b|\bavoided\b|\brequired\b|\brequirement\b|\bmust (?:maintain|keep|have)\b|\bto open\b|\bopening deposit\b|\bminimum (?:daily |average |monthly )?(?:collected )?balance (?:of|to|required|needed)\b/i;
/** A cell that is one column's price in a table of accounts or networks: "$7.00", "None", "N/A", "Free". */
const PRICE_CELL = /^(?:\$\s*\d[\d,]*(?:\.\d{1,2})?\b.*|\d[\d,]*\.\d{2}|none|n\/a|free|no charge|not applicable|[-–—])$/i;

/**
 * True when the line holds a price per column for several accounts (or networks), so its first
 * price belongs to one column only: "Monthly Maintenance Fee | None | $7.00 | $10.00 | $10.00 |
 * $5.00" (raw 361489, four products), "Credit card cash advance | None | $0.50 | $1.00 plus ATM
 * owner fees" (raw 275584, a network table). Pure.
 */
export function severalPriceColumns(name: string, excerpt: string): boolean {
  const at = excerpt.toLowerCase().indexOf(name.trim().toLowerCase());
  const after = at >= 0 ? excerpt.slice(at + name.trim().length) : excerpt;
  const cells = after.split("|").map((cell) => cell.trim()).filter(Boolean);
  if (cells.filter((cell) => PRICE_CELL.test(cell)).length >= 2) return true;
  // The same with no cell marks: two prices with nothing but spacing or leaders between them.
  return /\$\s*\d[\d,]*(?:\.\d{1,2})?[\s.…]*\$\s*\d/.test(after);
}

/**
 * Names the store settles but a line cannot place on its own: a bare "Closing Fee" (an account's
 * early closure, or a loan's closing) and a wire fee with no direction ("Wire Transfer Fee
 * (Domestic)": incoming or outgoing). The held-name rules keep these held for the same reason.
 */
const AMBIGUOUS_NAME = /^\W*(?:closing (?:fee|charge)s?|wire(?: transfers?)? (?:fee|charge)s?(?:\W+(?:domestic|international|foreign))?)\W*$/i;

/** The store's name key must still name something once digits go ("3 x 5" is "x"). */
function nameKeyUsable(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return key.split(" ").filter((word) => word.length >= 2).length >= 2;
}

export interface NameFileRow extends HeldRow {
  filed_key: string;
  filed_by: NameFiledBy;
  settled_banks: number | string | null;
  /** The settled category's live p5 and p95, weighted by row (store decisions). */
  range_p5?: number | string | null;
  range_p95?: number | string | null;
}

export interface NameFileResult {
  checked: number;
  filed: number;
  /** Matched a decision but stayed held, by reason. */
  kept: Record<string, number>;
  byCategory: Record<string, number>;
  bySource: Record<NameFiledBy, number>;
  institutions: number;
  examples: Array<{ feeRawId: number; feeName: string; amount: number; category: string; by: NameFiledBy }>;
  dryRun: boolean;
}

/** Why a held line a name decision covers stays held, or null when it moves. Pure. */
export function nameFileHold(
  row: Pick<NameFileRow, "fee_name" | "amount" | "conditions" | "filed_key"> & Partial<Pick<NameFileRow, "range_p5" | "range_p95">> & { filed_by?: NameFiledBy },
): string | null {
  const name = row.fee_name?.trim() ?? "";
  const amount = row.amount == null ? Number.NaN : Number(row.amount);
  if (!name || !Number.isFinite(amount)) return "no_price";
  if (!nameKeyUsable(name)) return "name_too_short";
  // Only a person's label files a name that does not say fee or charge (review of #1385).
  const byStore = (row.filed_by ?? "store") === "store";
  if (byStore && !FEE_WORD_NAME.test(name)) return "not_a_fee_name";
  if (byStore && AMBIGUOUS_NAME.test(name)) return "ambiguous_name";
  // A $0 line is the zero path's to judge (a free service or a missing price), not a settled fee.
  if (byStore && amount === 0) return "zero_price";
  const today = classifyFeeText(name);
  if (today && today !== row.filed_key) return "name_reads_other_category";
  const excerpt = heldExcerpt(row.conditions) ?? "";
  if (NOT_A_PLAIN_PRICE.test(excerpt)) return "not_a_plain_price";
  if (REQUIREMENT_LINE.test(excerpt)) return "requirement_line";
  if (severalPriceColumns(name, excerpt)) return "several_price_columns";
  if (!priceUnderName(name, excerpt, amount)) return "price_not_under_name";
  if (byStore && lineContradictsCategory(row.filed_key, `${name} ${excerpt}`)) return "line_contradicts_category";
  if (byStore && priceClauseNamesOtherFee(row.filed_key, name, excerpt, amount)) return "price_names_other_fee";
  // A store decision inherits the store's mistakes; a price outside the category's own live
  // spread (p5 to p95 of its live rows, weighted by row) waits for a person ("Early closure fee
  // of $500", raw 337301).
  if (byStore) {
    const p5 = row.range_p5 == null ? null : Number(row.range_p5);
    const p95 = row.range_p95 == null ? null : Number(row.range_p95);
    if (p5 == null || p95 == null || amount < p5 || amount > p95) return "outside_category_range";
  }
  if (!passesDarwinChecks(row.filed_key, name, amount)) return "darwin_checks";
  return null;
}

export function nameFiledConditions(conditions: string, key: string, by: NameFiledBy): string {
  return conditions
    .replace(/^Knox held for review \(unclassified\)/, `Knox filed a held line by its name (${by === "label" ? "a person's label" : "settled across banks"})`)
    .replace(/canonical_hint=none;/, `canonical_hint=${key};`);
}

const NAME_KEY_SQL = (column: string) =>
  `regexp_replace(btrim(lower(regexp_replace(${column}, '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g')`;

export async function fileHeldByName(
  db: SqlTag,
  options: { limit?: number; dryRun?: boolean; institutionId?: number | null; stateCode?: string | null; runId?: number | null; now?: Date } = {},
): Promise<NameFileResult> {
  const limit = Math.max(1, Math.min(Number(options.limit) || NAME_FILE_LIMIT, 1000));
  const dryRun = Boolean(options.dryRun);
  const result: NameFileResult = { checked: 0, filed: 0, kept: {}, byCategory: {}, bySource: { label: 0, store: 0 }, institutions: 0, examples: [], dryRun };
  const checkedFlag = nameFileCheckedFlag(options.now);
  const params: Array<string | number> = [limit, checkedFlag, SETTLED_NAME_MIN_BANKS, NAME_LABEL_KIND, SETTLED_NAME_MIN_SHARE, SETTLED_TWO_WORD_MIN_BANKS];
  const filters: string[] = [];
  if (options.institutionId) filters.push(`AND fr.institution_id = $${params.push(Number(options.institutionId))}`);
  const state = options.stateCode?.trim().toUpperCase();
  if (state) filters.push(`AND upper(btrim(inst.state_code)) = $${params.push(state)}`);
  const rows = await db.unsafe<NameFileRow[]>(
    `
      WITH held AS MATERIALIZED (
        SELECT fr.fee_raw_id, fr.amount, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fr.institution_id,
               fr.source_document_id, fr.fee_name, fr.outlier_flags, lower(btrim(fr.fee_name)) AS raw_name,
               ${NAME_KEY_SQL("fr.fee_name")} AS name
          FROM raw_fee_observations fr
          JOIN institution_sources inst ON inst.id = fr.institution_id
         WHERE fr.source = 'knox'
           AND fr.outlier_flags ? 'knox_review:unclassified'
           AND NOT fr.outlier_flags ? 'needs_darwin_verification'
           AND NOT fr.outlier_flags ? $2
           AND fr.amount IS NOT NULL
           ${filters.join("\n           ")}
      ), labels AS (
        -- A label's dedupe key is its name key (label-queue.ts), so this reads the unique index.
        SELECT DISTINCT ON (f.dedupe_key) substring(f.dedupe_key from 17) AS name, f.canonical_fee_key AS key
          FROM pipeline_feedback f
         WHERE f.dedupe_key IN (SELECT DISTINCT 'knox.name_label:' || name FROM held WHERE name <> '')
           AND f.kind = $4
         ORDER BY f.dedupe_key, f.created_at DESC
      ), raw_names AS MATERIALIZED (
        SELECT DISTINCT raw_name FROM held WHERE fee_name ~* '\\m(fee|fees|charge|charges)\\M'
      ), by_category AS (
        -- Live fees with one of the held names, as printed (lower-cased): a hash join on the live
        -- index, never a regex over every live fee. Their name keys are then counted by category.
        SELECT ${NAME_KEY_SQL("p.fee_name")} AS name, p.canonical_fee_key AS key,
               count(*) AS n, count(DISTINCT p.institution_id) AS banks
          FROM published_fee_records p
          JOIN raw_names r ON r.raw_name = lower(btrim(p.fee_name))
         WHERE p.rolled_back_at IS NULL AND p.quarantined_at IS NULL AND p.amount_kind = 'flat'
         GROUP BY 1, 2
      ), ranked AS (
        SELECT DISTINCT ON (name) name, key, n, banks, sum(n) OVER (PARTITION BY name) AS total
          FROM by_category
         ORDER BY name, n DESC, key
      ), settled AS (
        -- At least 90% of the name's live rows in one category, at 5 or more banks (10 for a
        -- two-word name such as "Statement Fee"), review of #1385.
        SELECT name, key, banks FROM ranked
         WHERE n >= $5::numeric * total
           AND banks >= CASE WHEN array_length(string_to_array(name, ' '), 1) <= 2 THEN $6::int ELSE $3::int END
      ), ranges AS (
        -- Each settled category's live spread (p5 to p95 of its live rows, weighted by row, not by
        -- bank), read on the category index.
        SELECT p.canonical_fee_key AS key,
               percentile_cont(0.05) WITHIN GROUP (ORDER BY p.amount) AS p5,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY p.amount) AS p95
          FROM published_fee_records p
         WHERE p.canonical_fee_key IN (SELECT key FROM settled)
           AND p.rolled_back_at IS NULL AND p.quarantined_at IS NULL AND p.amount_kind = 'flat' AND p.amount > 0
         GROUP BY 1
      )
      SELECT h.fee_raw_id, h.amount, h.conditions, h.institution_id, h.source_document_id, h.fee_name, h.outlier_flags,
             COALESCE(l.key, s.key) AS filed_key,
             CASE WHEN l.name IS NOT NULL THEN 'label' ELSE 'store' END AS filed_by,
             s.banks AS settled_banks, rg.p5 AS range_p5, rg.p95 AS range_p95
        FROM held h
        LEFT JOIN labels l ON l.name = h.name
        LEFT JOIN settled s ON s.name = h.name
        LEFT JOIN ranges rg ON rg.key = s.key
       WHERE ((l.name IS NOT NULL AND l.key IS NOT NULL) OR (l.name IS NULL AND s.name IS NOT NULL))
         -- Only lines from the document's current text, as the held re-check reads them.
         AND EXISTS (
           SELECT 1
             FROM agent_source_texts adt
            WHERE adt.source_document_id = h.source_document_id
              AND adt.status = 'completed'
              AND adt.text_hash IS NOT NULL
              AND position(('text_hash=' || adt.text_hash || ';') IN COALESCE(h.conditions, '')) > 0
         )
       ORDER BY h.fee_raw_id
       LIMIT $1
    `,
    params,
  );
  result.checked = rows.length;
  const checkedIds: number[] = [];
  const decisions: FeedbackRow[] = [];
  const banks = new Set<number>();
  for (const row of rows) {
    const key = row.filed_key;
    const by = row.filed_by;
    const hold = nameFileHold({ ...row, filed_by: by });
    if (hold) {
      result.kept[hold] = (result.kept[hold] ?? 0) + 1;
      checkedIds.push(Number(row.fee_raw_id));
      continue;
    }
    if (!dryRun) {
      const flags = ["needs_darwin_verification", `canonical_hint:${key}`, `${NAME_FILED_FLAG_PREFIX}${by}`];
      const name = row.fee_name?.trim() ?? "";
      const excerpt = heldExcerpt(row.conditions) ?? name;
      const applicability = feeApplicability(name, excerpt, Number(row.amount));
      const updated = await db`
        UPDATE raw_fee_observations fr
           SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'knox_review:unclassified') || ${JSON.stringify(flags)}::jsonb,
               extraction_note = ${nameFiledConditions(row.conditions ?? "", key, by)},
               conditions = NULL,
               -- The confidence today's rules give a priced fee line, as a promoted held line gets.
               extraction_confidence = ${confidenceFor(excerpt)},
               fee_audience = ${applicability.feeAudience},
               audience_evidence = ${applicability.audienceEvidence},
               fee_treatment = ${applicability.feeTreatment}
         WHERE fr.fee_raw_id = ${Number(row.fee_raw_id)}
           AND fr.outlier_flags ? 'knox_review:unclassified'
           AND NOT fr.outlier_flags ? 'needs_darwin_verification'
           -- The raw-row dedupe index is (document, name, amount, audience), as in the held re-check.
           AND NOT EXISTS (
             SELECT 1 FROM raw_fee_observations other
              WHERE other.source = 'knox'
                AND other.source_document_id = fr.source_document_id
                AND lower(other.fee_name) = lower(fr.fee_name)
                AND COALESCE(other.amount, -1) = COALESCE(fr.amount, -1)
                AND other.fee_audience = ${applicability.feeAudience}
                AND other.fee_raw_id <> fr.fee_raw_id
           )
        RETURNING fr.fee_raw_id
      `;
      if (updated.length === 0) {
        result.kept.same_page_row = (result.kept.same_page_row ?? 0) + 1;
        checkedIds.push(Number(row.fee_raw_id));
        continue;
      }
      decisions.push(heldDecision(row, { promotedTo: key }, versionsChecked(row), options.runId ?? null));
    }
    result.filed += 1;
    result.bySource[by] += 1;
    result.byCategory[key] = (result.byCategory[key] ?? 0) + 1;
    if (row.institution_id != null) banks.add(Number(row.institution_id));
    if (result.examples.length < 10) {
      result.examples.push({ feeRawId: Number(row.fee_raw_id), feeName: row.fee_name ?? "", amount: Number(row.amount), category: key, by });
    }
  }
  result.institutions = banks.size;
  // The week mark replaces an older week's, so a line carries one.
  const weekMark = (filter: string, filterParams: Array<string | number | number[]>) =>
    db.unsafe(
      `
        UPDATE raw_fee_observations fr
           SET outlier_flags = COALESCE((SELECT jsonb_agg(flag) FROM jsonb_array_elements(fr.outlier_flags) flag
                                          WHERE flag #>> '{}' NOT LIKE '${NAME_FILE_CHECKED_PREFIX}%'), '[]'::jsonb)
                               || jsonb_build_array($1::text)
          FROM institution_sources inst
         WHERE inst.id = fr.institution_id
           AND NOT fr.outlier_flags ? $1
           ${filter}
      `,
      [checkedFlag, ...filterParams],
    );
  if (!dryRun && checkedIds.length > 0) await weekMark("AND fr.fee_raw_id = ANY($2::bigint[])", [checkedIds]);
  // Every candidate read: the lane's other held lines need no read again this week.
  if (!dryRun && rows.length < limit && (options.institutionId || state)) {
    const laneParams: Array<string | number> = [];
    const laneFilters: string[] = [];
    if (options.institutionId) laneFilters.push(`AND fr.institution_id = $${laneParams.push(Number(options.institutionId)) + 1}`);
    if (state) laneFilters.push(`AND upper(btrim(inst.state_code)) = $${laneParams.push(state) + 1}`);
    await weekMark(
      `AND fr.source = 'knox' AND fr.outlier_flags ? 'knox_review:unclassified'
           AND NOT fr.outlier_flags ? 'needs_darwin_verification' ${laneFilters.join(" ")}`,
      laneParams,
    );
  }
  if (!dryRun && decisions.length > 0 && (await feedbackSchemaReady(db))) await recordFeedback(db, decisions);
  return result;
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
    SELECT fr.fee_raw_id, fr.amount, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags, adt.id AS document_text_id
      FROM raw_fee_observations fr
      JOIN institution_sources inst ON inst.id = fr.institution_id
      JOIN agent_source_texts adt
        ON adt.source_document_id = fr.source_document_id
       AND adt.status = 'completed'
       AND adt.text_hash IS NOT NULL
       AND position(('text_hash=' || adt.text_hash || ';') IN COALESCE(COALESCE(fr.extraction_note, fr.conditions), '')) > 0
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
               extraction_note = ${conditions},
               conditions = NULL,
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
 * Only rows Knox's paid reader produced are read again, so a row comes back only when two
 * independent readers agree on its name, amount and category. The first dry read (9 Oct, 17 rows
 * the free rules alone would have sent back) was 11 of 17 right against source: rule-read rows
 * brought back a $1,000 ATM limit, an ATM fee rebate and a courtesy-pay fee filed as an ATM fee.
 *
 * `SUPERSEDED_RECHECK_LIVE` off is a dry read: each row is read once per rules version and
 * marked with what the pass would do (`knox_superseded_would_promote:vN`), and nothing goes to
 * Darwin. The paid-only dry read (9 Oct, all 43 rows) would have sent one row, Northern Trust's
 * $25 overdraft, and it matched the source line, so the switch is on.
 *
 * Free-pass rows (#1093 step 2, approved by James 2026-10-12): until #1147 a re-read of the
 * same fee by the free team could not take its retired row back, so 1,626 free rows at 361
 * banks were retired and not live (counted 2026-10-12; 51 of those banks had no live fee).
 * Since #1147 a new read of the same fee takes its row back on insert, so the free pass
 * applies the same test to the rows lost before it: today's free team must read the row's own
 * name, amount and category in the document's current text, and the bank must have no live
 * twin. A row that passes goes to Darwin, whose free checks (the shared source check among
 * them) decide whether it goes live. The 9 Oct dry read of 17 free rows was 11 of 17 right
 * against source, so Darwin is the gate here, not Knox.
 */
export const SUPERSEDED_RECHECK_LIVE = true;
export const SUPERSEDED_RECHECK_LIMIT = 100;
export const SUPERSEDED_FREE_RECHECK_LIMIT = 200;
export const SUPERSEDED_RECHECK_PROMOTED_FLAG = "knox_promoted_from_superseded";
export const SUPERSEDED_RECHECK_SOURCE_FLAG = KNOX_PAID_FLAG;

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
  source: "paid" | "free";
}

export async function recheckSupersededRows(
  db: SqlTag,
  options: { limit?: number; dryRun?: boolean; live?: boolean; institutionId?: number | null; stateCode?: string | null; source?: "paid" | "free" } = {},
): Promise<SupersededRecheckResult> {
  const source = options.source ?? "paid";
  const paid = source === "paid";
  const limit = Math.max(1, Math.min(Number(options.limit) || (paid ? SUPERSEDED_RECHECK_LIMIT : SUPERSEDED_FREE_RECHECK_LIMIT), 500));
  const dryRun = Boolean(options.dryRun);
  const live = options.live ?? SUPERSEDED_RECHECK_LIVE;
  const flag = live ? supersededRecheckFlag() : supersededDryReadFlag();
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const empty = { checked: 0, promoted: 0, liveTwin: 0, notRead: 0, promotedIds: [], live, dryRun, source };
  // Only a document's current copy can bring a line back (before the copy migration, none).
  if (!(await currentCopySchemaReady(db))) return empty;
  const rows = await db<Array<HeldRow & { document_text_id: number | string; text_hash: string; has_live_twin: boolean }>>`
    SELECT fr.fee_raw_id, fr.amount, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags, adt.id AS document_text_id, adt.text_hash,
           EXISTS (
             SELECT 1 FROM published_fee_catalog pc
              WHERE pc.institution_id = fr.institution_id
                AND pc.fee_category = substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'canonical_hint=([a-z_]+);')
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
       AND (fr.outlier_flags ? ${SUPERSEDED_RECHECK_SOURCE_FLAG}) = ${paid}::boolean
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
               extraction_note = ${supersededConditions(row.conditions, row.text_hash, row.document_text_id)},
               conditions = NULL,
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
    source,
  };
}

/**
 * A retired row today's free team reads with the same name and amount but files under another
 * category. `recheckSupersededRows` needs the row's own category, so it leaves these retired
 * ("not read the same way today"), and before #1147 the re-read's insert hit the dedupe index
 * on (document, name, amount, audience), so no other row carries the fee either. Measured 14 Oct
 * on Oregonians CU's schedule (document 13279): "Card Replacement" $10 was retired as
 * atm_non_network, "Incoming Wires" $10 as nsf and "Bad Address/Returned Mail" $10 as
 * monthly_maintenance; today's rules read all three as card_replacement,
 * wire_domestic_incoming and account_research, and none is live.
 *
 * The pass files such a row under today's category: its old `canonical_hint:` flags go, today's
 * goes on, and `knox_refiled_from:<old>` records the old one for review and reversal. The live
 * twin test uses today's category. Rows Darwin already judged for something other than the
 * category (an envelope, peer or duplicate rejection) are left retired: Darwin does not judge a
 * row twice at one version, so sending one back would park it in the queue with no decision.
 *
 * It also repairs rows a re-read took over (#1147) whose first `canonical_hint:` flag is not the
 * category the re-read wrote in `conditions`, the stale flag `insertCandidate` now drops. Rows
 * Darwin already verified are left as they are.
 *
 * This changes production rows. James switched it on (Oct 15, #1093). Off, every extract
 * step reads a sample of the candidates (25, a new sample each hour), writes nothing, and reports
 * the candidate count and what it would do with the sample. A dry-run Knox extract
 * (`run_kind = dry_run`) reads them all and writes nothing. On, it reads 200 a pass in id order,
 * re-files, and marks every row it read with `knox_superseded_refile:vN`.
 *
 * A state lane's extract step re-files only its state's rows, and a direct run for one bank only
 * that bank's (`stateCode`, `institutionId`): unscoped, every lane read all banks' rows (1,336
 * candidates at 317 banks, Oct 15), and the scan took a zero-document extract from 7 s to 53 s.
 * Each state's rows are re-filed on its lane's next extract step. Switched off, a state lane skips
 * the read-only sample (`skipSample`).
 */
export const SUPERSEDED_REFILE_LIVE = true;
export const SUPERSEDED_REFILE_LIMIT = 200;
/** Off: the read-only sample each extract step takes. */
export const SUPERSEDED_REFILE_SAMPLE = 25;
/** One dry-run extract reads every candidate (455 to read on 14 Oct, after Darwin-judged rows). */
export const SUPERSEDED_REFILE_DRY_LIMIT = 1500;
export const SUPERSEDED_REFILED_FROM_PREFIX = "knox_refiled_from:";
export const STALE_HINT_REPAIRED_FLAG = "knox_stale_hint_repaired";
/** Darwin reasons a re-file can change: Darwin re-judges category rejections on a guard change. */
export const DARWIN_CATEGORY_REASONS = ["category_mismatch", "category_lesson_pending"] as const;

export function supersededRefileFlag(version: number = KNOX_RULES_STRATEGY.version): string {
  return `knox_superseded_refile:${KNOX_RULES_STRATEGY.strategy}:v${version}`;
}

/**
 * Today's read of a retired row under a new category: the same name and amount, another
 * category. Null when today's team reads the row under its own category (the superseded
 * re-check's case) or does not read it. Pure.
 */
export function refiledRead(row: HeldRow, candidates: ExtractedFeeCandidate[]): ExtractedFeeCandidate | null {
  const hint = heldHint(row.conditions);
  const name = (row.fee_name ?? "").trim().toLowerCase();
  const amount = Number(row.amount);
  if (!hint || !name || row.amount == null || !Number.isFinite(amount)) return null;
  const same = candidates.filter((candidate) =>
    Math.abs(candidate.amount - amount) < 0.005 && candidate.feeName.trim().toLowerCase() === name,
  );
  if (same.length === 0 || same.some((candidate) => candidate.canonicalHint === hint)) return null;
  return same[0];
}

/** Flags for a row filed under a new category: old `canonical_hint:` flags out, today's in. Pure. */
export function refiledFlags(flags: string[], newHint: string, oldHint: string): string[] {
  const kept = flags.filter((flag) =>
    !flag.startsWith("canonical_hint:") && flag !== "superseded_by_reread" && flag !== "needs_darwin_verification",
  );
  return [
    "needs_darwin_verification",
    `canonical_hint:${newHint}`,
    ...kept,
    SUPERSEDED_RECHECK_PROMOTED_FLAG,
    `${SUPERSEDED_REFILED_FROM_PREFIX}${oldHint}`,
  ].filter((flag, index, all) => all.indexOf(flag) === index);
}

/** A retired row's audit text with today's category and text hash. Pure. */
export function refiledConditions(conditions: string | null, newHint: string, textHash: string, textId: number | string): string {
  return supersededConditions(conditions, textHash, textId).replace(/canonical_hint=[a-z0-9_]+;/, `canonical_hint=${newHint};`);
}

export interface SupersededRefileSample {
  fee_raw_id: number;
  institution_id: number;
  fee_name: string;
  amount: number;
  from: string;
  to: string;
}

export interface SupersededRefileResult {
  live: boolean;
  dryRun: boolean;
  /**
   * `sample`: off, a read-only sample; `dry_run`: every candidate, read-only; `live`: writes;
   * `skipped`: off, in a state lane, nothing read.
   */
  mode: "sample" | "dry_run" | "live" | "skipped";
  /** Retired rows this rules version has not re-filed or marked, their banks, and how many Darwin already judged. */
  candidates: number;
  candidateInstitutions: number;
  candidatesDarwinDecided: number;
  checked: number;
  /** Re-filed and sent to Darwin; in a dry run, the rows that would be. */
  refiled: number;
  liveTwin: number;
  notRead: number;
  darwinDecided: number;
  refiledIds: number[];
  /** Up to 25 re-files, for a hand check against the source line. */
  sample: SupersededRefileSample[];
  /** Taken-over rows whose first category flag is stale (repaired when live). */
  staleHintRows: number;
  staleHintRepaired: number;
}

export async function refileSupersededRows(
  db: SqlTag,
  options: {
    limit?: number;
    dryRun?: boolean;
    live?: boolean;
    institutionId?: number | null;
    /** A state lane's state: only its banks' rows are read. */
    stateCode?: string | null;
    /** Off, read nothing instead of the read-only sample (state lanes). */
    skipSample?: boolean;
    now?: Date;
  } = {},
): Promise<SupersededRefileResult> {
  const live = options.live ?? SUPERSEDED_REFILE_LIVE;
  // Off, the pass only reads; a dry-run extract reads every candidate, any other step a sample.
  const dryRun = Boolean(options.dryRun) || !live;
  const sampleMode = !options.dryRun && !live;
  const mode: SupersededRefileResult["mode"] = options.dryRun ? "dry_run" : live ? "live" : options.skipSample ? "skipped" : "sample";
  const result: SupersededRefileResult = {
    live, dryRun, mode, candidates: 0, candidateInstitutions: 0, candidatesDarwinDecided: 0, checked: 0, refiled: 0, liveTwin: 0, notRead: 0,
    darwinDecided: 0, refiledIds: [], sample: [], staleHintRows: 0, staleHintRepaired: 0,
  };
  if (sampleMode && options.skipSample) return result;
  if (!(await currentCopySchemaReady(db))) return result;
  const defaultLimit = mode === "dry_run" ? SUPERSEDED_REFILE_DRY_LIMIT : mode === "sample" ? SUPERSEDED_REFILE_SAMPLE : SUPERSEDED_REFILE_LIMIT;
  const cap = mode === "dry_run" ? SUPERSEDED_REFILE_DRY_LIMIT : mode === "sample" ? SUPERSEDED_REFILE_SAMPLE : 500;
  const limit = Math.max(1, Math.min(Number(options.limit) || defaultLimit, cap));
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const flag = supersededRefileFlag();
  const categoryReasons = [...DARWIN_CATEGORY_REASONS];
  // A read-only sample puts the rows Darwin has not judged first, in an order that changes each hour.
  const sampleKey = mode === "sample" ? (options.now ?? new Date()).toISOString().slice(0, 13) : null;

  const rows = await db<Array<HeldRow & {
    document_text_id: number | string; text_hash: string; darwin_decided: boolean;
    total: number | string; decided_total: number | string; institutions: number | string;
  }>>`
    WITH candidates AS (
    SELECT fr.fee_raw_id, fr.amount, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fr.institution_id, fr.source_document_id,
           fr.fee_name, fr.outlier_flags, adt.id AS document_text_id, adt.text_hash,
           EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
                AND pa.strategy = 'verify.rules'
                AND COALESCE(pa.detail->>'reason_code', '') <> ALL(${categoryReasons}::text[])
           ) AS darwin_decided
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
       AND NOT fr.outlier_flags ? ${KNOX_PAID_FLAG}
       AND NOT fr.outlier_flags ? 'needs_darwin_verification'
       AND NOT fr.outlier_flags ? ${flag}
       AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
       AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
    )
    SELECT c.*,
           (SELECT COUNT(*) FROM candidates) AS total,
           (SELECT COUNT(*) FROM candidates WHERE darwin_decided) AS decided_total,
           (SELECT COUNT(DISTINCT institution_id) FROM candidates) AS institutions
      FROM candidates c
     ORDER BY CASE WHEN ${sampleKey}::text IS NULL THEN 0 WHEN c.darwin_decided THEN 1 ELSE 0 END,
              CASE WHEN ${sampleKey}::text IS NULL THEN NULL ELSE md5(c.fee_raw_id::text || ${sampleKey}::text) END,
              c.fee_raw_id
     LIMIT ${limit}
  `;
  result.checked = rows.length;
  result.candidates = Number(rows[0]?.total ?? 0);
  result.candidateInstitutions = Number(rows[0]?.institutions ?? 0);

  result.candidatesDarwinDecided = Number(rows[0]?.decided_total ?? 0);

  const readable = rows.filter((row) => !row.darwin_decided);
  result.darwinDecided = rows.length - readable.length;
  const textIds = [...new Set(readable.map((row) => Number(row.document_text_id)))];
  const texts = textIds.length === 0 ? [] : await db<Array<{ id: number | string; normalized_text: string | null }>>`
    SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${textIds}::bigint[])
  `;
  const reads = new Map<number, ExtractedFeeCandidate[]>();
  for (const text of texts) reads.set(Number(text.id), text.normalized_text ? runFreeSpecialists(text.normalized_text).candidates : []);

  const found = readable
    .map((row) => ({ row, read: refiledRead(row, reads.get(Number(row.document_text_id)) ?? []) }))
    .filter((entry): entry is { row: typeof entry.row; read: ExtractedFeeCandidate } => entry.read !== null);
  result.notRead = readable.length - found.length;

  // A live fee of today's category at that price already stands for the fee (a live twin).
  const twins = found.length === 0 ? [] : await db<Array<{ institution_id: number | string; fee_category: string; amount: number | string }>>`
    SELECT DISTINCT pc.institution_id, pc.fee_category, pc.amount
      FROM published_fee_catalog pc
      JOIN jsonb_to_recordset(${JSON.stringify(found.map(({ row, read }) => ({ i: Number(row.institution_id), c: read.canonicalHint, a: Number(row.amount) })))}::jsonb)
           AS want(i int, c text, a numeric)
        ON pc.institution_id = want.i AND pc.fee_category = want.c AND pc.amount = want.a
  `;
  const twinKeys = new Set(twins.map((twin) => `${Number(twin.institution_id)}|${twin.fee_category}|${Number(twin.amount).toFixed(2)}`));

  const markedIds = rows.map((row) => Number(row.fee_raw_id));
  for (const { row, read } of found) {
    const id = Number(row.fee_raw_id);
    if (twinKeys.has(`${Number(row.institution_id)}|${read.canonicalHint}|${Number(row.amount).toFixed(2)}`)) {
      result.liveTwin += 1;
      continue;
    }
    const oldHint = heldHint(row.conditions) ?? "none";
    if (!dryRun) {
      const updated = await db`
        UPDATE raw_fee_observations fr
           SET outlier_flags = ${JSON.stringify(refiledFlags(flagList(row.outlier_flags), read.canonicalHint, oldHint))}::jsonb,
               extraction_note = ${refiledConditions(row.conditions, read.canonicalHint, row.text_hash, row.document_text_id)},
               conditions = NULL,
               extraction_confidence = ${read.confidence},
               frequency = COALESCE(fr.frequency, ${read.frequency})
         WHERE fr.fee_raw_id = ${id}
           AND fr.outlier_flags ? 'superseded_by_reread'
           AND NOT fr.outlier_flags ? 'needs_darwin_verification'
        RETURNING fr.fee_raw_id
      `;
      if (updated.length === 0) continue;
    }
    result.refiled += 1;
    result.refiledIds.push(id);
    if (result.sample.length < 25) {
      result.sample.push({ fee_raw_id: id, institution_id: Number(row.institution_id), fee_name: String(row.fee_name), amount: Number(row.amount), from: oldHint, to: read.canonicalHint });
    }
  }
  if (!dryRun && markedIds.length > 0) {
    // Every row read is marked for this rules version; a re-filed row also carries it.
    await db`
      UPDATE raw_fee_observations
         SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([flag])}::jsonb
       WHERE fee_raw_id = ANY(${markedIds}::bigint[])
         AND NOT COALESCE(outlier_flags, '[]'::jsonb) ? ${flag}
    `;
  }

  // Rows a re-read took over whose first category flag is not the one the re-read wrote.
  const stale = await db<Array<{ fee_raw_id: number | string }>>`
    SELECT fr.fee_raw_id
      FROM raw_fee_observations fr
      JOIN institution_sources inst ON inst.id = fr.institution_id
     WHERE fr.source = 'knox'
       AND fr.outlier_flags ? 'knox_reread_took_over'
       AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
       AND substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'canonical_hint=([a-z0-9_]+);') IS NOT NULL
       AND (
         SELECT kept.flag #>> '{}'
           FROM jsonb_array_elements(fr.outlier_flags) WITH ORDINALITY AS kept(flag, ord)
          WHERE kept.flag #>> '{}' LIKE 'canonical_hint:%'
          ORDER BY kept.ord
          LIMIT 1
       ) IS DISTINCT FROM 'canonical_hint:' || substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'canonical_hint=([a-z0-9_]+);')
       AND (${institutionId}::int IS NULL OR fr.institution_id = ${institutionId}::int)
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
     ORDER BY fr.fee_raw_id
     LIMIT ${limit}
  `;
  result.staleHintRows = stale.length;
  if (!dryRun && stale.length > 0) {
    const repaired = await db`
      UPDATE raw_fee_observations fr
         SET outlier_flags = jsonb_build_array('canonical_hint:' || substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'canonical_hint=([a-z0-9_]+);'))
                             || COALESCE((
                                  SELECT jsonb_agg(kept.flag ORDER BY kept.ord)
                                    FROM jsonb_array_elements(fr.outlier_flags) WITH ORDINALITY AS kept(flag, ord)
                                   WHERE kept.flag #>> '{}' NOT LIKE 'canonical_hint:%'
                                ), '[]'::jsonb)
                             || ${JSON.stringify([STALE_HINT_REPAIRED_FLAG])}::jsonb
       WHERE fr.fee_raw_id = ANY(${stale.map((row) => Number(row.fee_raw_id))}::bigint[])
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
      RETURNING fr.fee_raw_id
    `;
    result.staleHintRepaired = repaired.length;
  }
  return result;
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
    SELECT fr.fee_raw_id, fr.amount, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fr.institution_id, fr.source_document_id,
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
               extraction_note = ${heldConditions(row.conditions ?? "")},
               conditions = NULL
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
// v2 (#1102): a rate stated as a share of what it is charged on traces without the word "fee"
// (`checkRateAgainstSource`), and check cashing and international ATM fees publish as rates.
export const HELD_RATE_RECHECK_VERSION = 2;
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
    SELECT fr.fee_raw_id, fr.source_document_id, fr.fee_name, COALESCE(fr.extraction_note, fr.conditions) AS conditions, fr.frequency,
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
           AND position(('text_hash=' || t.text_hash || ';') IN COALESCE(COALESCE(fr.extraction_note, fr.conditions), '')) > 0
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
               extraction_note = ${(row.conditions ?? "").replace(/^Knox held for review \(percentage\)/, `Knox rate rules v${HELD_RATE_RECHECK_VERSION} read a percentage fee held for review`).replace(/canonical_hint=[^;]*;/, `canonical_hint=${rate.canonicalHint};`)},
               conditions = NULL,
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
