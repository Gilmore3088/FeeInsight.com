import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { CLEARED_KIND, FLAG_CLEARED_KIND, secondLook, secondLookDedupeKey, secondLookEventKey } from "@/lib/agents/hamilton/second-look";
import { ACCOUNT_TYPE_HOLD_REASON } from "@/lib/agents/hamilton/account-type-hold";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees read from a bank's Spanish copy of a schedule it also publishes
 * in English (#1909, James's live-fee check, Oct 18; decision 2026-10-15, "Darwin re-checks every
 * live fee against today's rules"). M&T publishes its checking fee guide in English
 * (`checking.fee.transparency.guide.pdf`) and Spanish (`spanish-checking-fee-transparency-guide.pdf`);
 * both were read, so "Cargo por sobregiro" $15 sat beside "Overdraft Fee" $15 and counted twice.
 *
 * A fee comes down only when all three hold:
 * - its stored document's address names a Spanish copy (`spanishCopyDocument`: "spanish",
 *   "español", a "/es/" path or an "-es."/"_ES-" token);
 * - its name reads as Spanish (`readsSpanish`: an accented letter, or two Spanish words). East West's
 *   `/es/personal-banking/fee-schedule` was stored with English names ("Non-Sufficient Funds Fee",
 *   "Cashier's Check: Non-Customer"), so it is not a translation and its rows stay;
 * - the same institution has a live fee in the same category at the same amount read from a
 *   document that is not a Spanish copy (the English twin). A Spanish-only fee stays live until its
 *   English line is: M&T's non-network ATM and outgoing wire rows, every row of a credit union whose
 *   English schedule is not on file (Express CU, Travis CU), and Puerto Rico's Spanish schedules.
 *
 * Every step reads every live fee on a Spanish-copy document (a few hundred at most; 127 on
 * 2026-10-18), so there is no cursor. An institution-scoped run reads only that institution's.
 *
 * Shadow first (CLAUDE.md standing rule): with `TRANSLATED_COPY_TAKEDOWN_LIVE` false, or in a dry
 * run, the step only reports what it would take down. Switched on, a matching fee goes through the
 * shared 12-hour second look (check `darwin.translated_copy`) and is archived on its second failure:
 * rolled back with `translated_copy: #<doc> twin #<fee>`, its verified row rejected with the
 * `translated_copy` flag, never deleted, and a `darwin.translated_copy_takedown` event lists them.
 * v3 (#1986): a fee taken down because its English twin was live comes back when no English line
 * of it is left (`translatedCopyRestoreVerdict`, behind `TRANSLATED_COPY_RESTORE_LIVE`): see
 * "The restore" below.
 *
 * v2 (review of v1): a fee with no dollar amount (a percent fee, `amount` NULL) never has a twin, so
 * two percent fees at different rates are not paired; "fondos", "insuficientes" and "cobro" read as
 * Spanish ("Fondos insuficientes" is a Spanish-only fee, not an English name).
 * Dry run, prod read-only, 2026-10-18 (`translatedCopyRowsSql` through `findTranslatedCopies`): 127
 * live fees on 12 Spanish-copy documents at 11 institutions; 35 would come down (Sound 22, OnPoint 6,
 * M&T 5, FirstBank PR 2), 34 Spanish names have no English twin and 58 carry an English name
 * (East West's 6 twinned rows among them), so 92 stay.
 */
export const TRANSLATED_COPY_CHECK = "darwin.translated_copy";
/** v3 (#1986): the restore of a Spanish fee whose English twin came down (see "The restore"). */
export const TRANSLATED_COPY_CHECK_VERSION = 3;
/**
 * The switch. On since 2026-10-18 (James, "Turn it on" on the decision card, 11:28 UTC), on the dry-run
 * count of 35 live fees at 4 institutions. Roll back by setting it to false.
 */
export const TRANSLATED_COPY_TAKEDOWN_LIVE = true;
export const TRANSLATED_COPY_REASON = "translated_copy";
export const TRANSLATED_COPY_FLAG = "translated_copy";
/** Live fees read per step (every fee on a Spanish-copy document; the cap is a guard). */
export const TRANSLATED_COPY_LIMIT = 2_000;
export const TRANSLATED_COPY_SAMPLES = 20;

/** A Spanish copy's address, written once for JS (case-insensitive) and Postgres (`~*`). */
export const SPANISH_COPY_URL = "(spanish|espa(n|ñ)ol|/es/|[-_/]es[-_.])";
const SPANISH_COPY_URL_RE = new RegExp(SPANISH_COPY_URL, "i");

/** Pure: the document's address names a Spanish copy. */
export function spanishCopyDocument(url: string | null | undefined): boolean {
  return SPANISH_COPY_URL_RE.test((url ?? "").trim());
}

/** Letters only Spanish uses in a fee name. */
const SPANISH_LETTERS = /[ñáéíóú¿¡]/iu;
/** Common Spanish words of a fee schedule (#1312's guard reads the same fees' names). */
const SPANISH_WORDS =
  /(?<![\p{L}])(?:cargos?|por|de|del|la|el|los|las|cuentas?|cheques?|pagos?|sobregiro|transferencias?|tarjetas?|caja|copias?|giro|postal|notario|retiros?|efectivo|comision|embargo|reemplazo|llave|cierre|detener|acciones|adelantos?|compra|mensual|mantenimiento|seguridad|extracto|escritura|partida|atrasado|legales|bancaria|nacional|internacional|saliente|entrante|miembro|repuesto|anticipado|regalo|sucursales|fondos|insuficientes|cobro)(?![\p{L}])/giu;

/** Pure: the fee's name reads as Spanish: a letter only Spanish uses, or two Spanish words. */
export function readsSpanish(name: string | null | undefined): boolean {
  const text = name ?? "";
  if (SPANISH_LETTERS.test(text)) return true;
  return (text.match(SPANISH_WORDS) ?? []).length >= 2;
}

export interface TranslatedCopyRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  source_document_id: number | string | null;
  document_url: string | null;
  /** A live fee of the same institution, category and amount from a document that is not a Spanish copy. */
  twin_fee_published_id: number | string | null;
  twin_fee_name: string | null;
}

export type TranslatedCopyVerdict = "translated_copy" | "kept_spanish_only" | "kept_english_name";

export interface TranslatedCopyMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  documentUrl: string;
  twinFeePublishedId: number | null;
  twinFeeName: string | null;
  verdict: TranslatedCopyVerdict;
  reason: string;
}

export interface TranslatedCopyFindings {
  /** Live fees read on Spanish-copy documents. */
  checked: number;
  matched: number;
  keptSpanishOnly: number;
  keptEnglishName: number;
  documents: number;
  institutions: number;
  samples: TranslatedCopyMatch[];
  keptSamples: TranslatedCopyMatch[];
}

export interface TranslatedCopyResult extends TranslatedCopyFindings {
  live: boolean;
  dryRun: boolean;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
  /** v3 (#1986): archived fees whose English twin is gone (see "The restore"). */
  restore: TranslatedCopyRestoreResult;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: the verdict for one live fee on a Spanish-copy document (see the module note). */
export function translatedCopyVerdict(feeName: string | null | undefined, twinFeePublishedId: number | string | null | undefined): TranslatedCopyVerdict {
  if (!readsSpanish(feeName)) return "kept_english_name";
  return num(twinFeePublishedId ?? null) == null ? "kept_spanish_only" : "translated_copy";
}

/** Pure: the rows on a Spanish-copy document, with a verdict for each. `passing` is every fee that stays. */
export function findTranslatedCopies(rows: TranslatedCopyRow[]): TranslatedCopyFindings & { matches: TranslatedCopyMatch[]; passing: number[] } {
  const matches: TranslatedCopyMatch[] = [];
  const kept: TranslatedCopyMatch[] = [];
  let keptSpanishOnly = 0;
  let keptEnglishName = 0;
  let checked = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const documentId = num(row.source_document_id);
    const url = (row.document_url ?? "").trim();
    if (documentId == null || !spanishCopyDocument(url)) continue;
    checked += 1;
    const verdict = translatedCopyVerdict(row.fee_name, row.twin_fee_published_id);
    const twinId = num(row.twin_fee_published_id);
    const match: TranslatedCopyMatch = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      sourceDocumentId: documentId,
      documentUrl: url,
      twinFeePublishedId: twinId,
      twinFeeName: row.twin_fee_name ?? null,
      verdict,
      reason: `${TRANSLATED_COPY_REASON}: #${documentId} twin #${twinId ?? "none"}`,
    };
    if (verdict === "translated_copy") {
      matches.push(match);
      continue;
    }
    if (verdict === "kept_spanish_only") keptSpanishOnly += 1;
    else keptEnglishName += 1;
    kept.push(match);
  }
  return {
    checked,
    matched: matches.length,
    keptSpanishOnly,
    keptEnglishName,
    documents: new Set(matches.map((fee) => fee.sourceDocumentId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, TRANSLATED_COPY_SAMPLES),
    keptSamples: kept.slice(0, TRANSLATED_COPY_SAMPLES),
    matches,
    passing: kept.map((fee) => fee.feePublishedId),
  };
}

/**
 * Read-only: every live fee on a Spanish-copy document, with its English twin (lowest id) if one
 * is live. The same read the step makes; run it in the SQL editor or a dry run for the count.
 */
export function translatedCopyRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? TRANSLATED_COPY_LIMIT, 20_000));
  return db<TranslatedCopyRow[]>`
    SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key, fr.source_document_id, btrim(sd.document_url) AS document_url,
           twin.fee_published_id AS twin_fee_published_id, twin.fee_name AS twin_fee_name
      FROM source_documents sd
      JOIN raw_fee_observations fr ON fr.source_document_id = sd.id
      JOIN verified_fee_observations fv ON fv.fee_raw_id = fr.fee_raw_id
      JOIN published_fee_records fp ON fp.lineage_ref = fv.fee_verified_id
      LEFT JOIN LATERAL (
        SELECT other.fee_published_id, other.fee_name
          FROM published_fee_records other
          JOIN verified_fee_observations ov ON ov.fee_verified_id = other.lineage_ref
          JOIN raw_fee_observations orw ON orw.fee_raw_id = ov.fee_raw_id
          JOIN source_documents od ON od.id = orw.source_document_id
         WHERE other.institution_id = fp.institution_id
           AND other.canonical_fee_key = fp.canonical_fee_key
           AND fp.amount IS NOT NULL
           AND other.amount = fp.amount
           AND other.fee_published_id <> fp.fee_published_id
           AND other.rolled_back_at IS NULL
           AND other.quarantined_at IS NULL
           AND btrim(od.document_url) !~* ${SPANISH_COPY_URL}
         ORDER BY other.fee_published_id
         LIMIT 1
      ) twin ON TRUE
     WHERE btrim(sd.document_url) ~* ${SPANISH_COPY_URL}
       AND fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * The restore (v3, #1986). A Spanish fee archived as `translated_copy: #<doc> twin #<fee>` stood down
 * only because its English twin was live. When another rule later takes that twin down, nothing read
 * the Spanish fee again, so the institution lost the fee entirely (35 takedowns at 4 institutions on
 * Oct 18). Each verify step now reads every such takedown (`translatedCopyRestoreRowsSql`, a few
 * dozen rows, no cursor) and judges it (`translatedCopyRestoreVerdict`). It comes back only when all
 * of these hold, and stays down otherwise:
 * - its own state is this check's alone: still rolled back with the translated-copy reason by a
 *   `darwin-translated-copy-<run>` batch, not quarantined, its verified row rejected with
 *   `translated_copy` as its last flag, and no other check's second look pending or confirmed on it
 *   (`other_takedown`);
 * - the twin its reason names is no longer live at its category and amount (`twin_live`);
 * - no other English line of it is there: no live (or account-type-held) fee at the institution,
 *   category and amount on a document that is not a Spanish copy (`english_twin_live`), and no
 *   verified English row at that price waiting to publish (`english_twin_waiting`), whatever the
 *   named twin's status;
 * - the twin did not come down for a newer copy of the schedule (`older_edition`, `refreshed by`,
 *   `superseded by`, `newer_copy_drops_fee`, `not_on_current_copy`): the English line was replaced,
 *   so the Spanish copy is no proof of today's price (`twin_replaced`; OnPoint's Oregon reconveyance
 *   fee is $133 in its Spanish copy and $153 in the current English edition);
 * - it has a dollar amount (`no_amount`) and its own document's newest text still states it
 *   (`checkFeeAgainstSource`, ok or tiered; `no_text`, `not_on_own_document`).
 *
 * Switched on (`TRANSLATED_COPY_RESTORE_LIVE`) and not a dry run, a restorable fee comes back live in
 * one statement that re-checks its state: the rollback cleared, its verified row `verified` again
 * without the `translated_copy` flag and with `rules_recheck_restored:translated_copy_twin_gone`
 * (so the learning sync's `restored_after_takedown` record names why it came back), its second look
 * set to `takedown_cleared` (so a twin that returns starts a fresh 12-hour look), and a
 * `darwin.translated_copy_restored` event. Off, the step only reports what it would restore.
 */
/**
 * The restore's switch. Off: restoring changes live data, so it goes on by PR once a dry run's sample
 * checks clean against the bank's own document (DECISIONS 2026-10-20). Dry run, prod read-only,
 * 2026-10-26: 35 archived; 0 would come back (32 twins still live; 64334, 64337 and 64339 at OnPoint
 * lost their twins to the dated-edition check, so they stay down: 64337 and 64339 have the current
 * edition's verified English row waiting to publish, and 64334 is `twin_replaced`).
 */
export const TRANSLATED_COPY_RESTORE_LIVE = false;
export const TRANSLATED_COPY_RESTORED_FLAG = "rules_recheck_restored:translated_copy_twin_gone";
export const TRANSLATED_COPY_BATCH_PREFIX = "darwin-translated-copy-";
/** A twin's takedown that means a newer copy of the schedule replaced it (see "The restore"). */
export const TWIN_REPLACED_REASON = /^(?:older_edition:|refreshed by #|superseded by #|newer_copy_drops_fee:|not_on_current_copy:)/;

export interface TranslatedCopyRestoreRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  rolled_back_reason: string | null;
  source_document_id: number | string | null;
  /** True while the row is in the state this check left it in (see "The restore"). */
  own_state_clean: boolean | null;
  /** Another check's pending or confirmed second look on this fee. */
  other_takedown: string | null;
  named_twin_id: number | string | null;
  named_twin_live: boolean | null;
  named_twin_reason: string | null;
  /** A live (or account-type-held) English fee at the institution, category and amount. */
  english_twin_id: number | string | null;
  /** A verified English row at that price not yet on the catalog. */
  english_waiting_id: number | string | null;
  newest_text: string | null;
}

export type TranslatedCopyRestoreVerdict =
  | "restore"
  | "other_takedown"
  | "twin_live"
  | "english_twin_live"
  | "english_twin_waiting"
  | "twin_replaced"
  | "no_amount"
  | "no_text"
  | "not_on_own_document";

export interface TranslatedCopyRestoreFee {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number | null;
  namedTwinId: number | null;
  namedTwinReason: string | null;
  englishTwinId: number | null;
  verdict: TranslatedCopyRestoreVerdict;
}

export interface TranslatedCopyRestoreResult {
  live: boolean;
  /** Archived translated-copy takedowns read. */
  archived: number;
  /** Fees that pass every rule: restored when on, else what it would restore. */
  restorable: TranslatedCopyRestoreFee[];
  /** Kept down, by verdict. */
  kept: Partial<Record<TranslatedCopyRestoreVerdict, number>>;
  keptSamples: TranslatedCopyRestoreFee[];
  restored: number[];
}

/** Pure: whether one archived translated-copy takedown comes back (see "The restore"). */
export function translatedCopyRestoreVerdict(row: TranslatedCopyRestoreRow): TranslatedCopyRestoreVerdict {
  if (!row.own_state_clean || row.other_takedown) return "other_takedown";
  if (row.named_twin_live) return "twin_live";
  if (num(row.english_twin_id) != null) return "english_twin_live";
  if (num(row.english_waiting_id) != null) return "english_twin_waiting";
  if (TWIN_REPLACED_REASON.test(row.named_twin_reason ?? "")) return "twin_replaced";
  const amount = num(row.amount);
  if (amount == null) return "no_amount";
  if (!row.newest_text) return "no_text";
  const traced = checkFeeAgainstSource(row.newest_text, row.fee_name ?? "", amount, ".", row.canonical_fee_key);
  return traced.ok || traced.reason === "tiered_fee" ? "restore" : "not_on_own_document";
}

/** Pure: the verdict for every archived row. */
export function judgeTranslatedCopyRestores(rows: TranslatedCopyRestoreRow[]): Omit<TranslatedCopyRestoreResult, "live" | "restored"> {
  const restorable: TranslatedCopyRestoreFee[] = [];
  const keptFees: TranslatedCopyRestoreFee[] = [];
  const kept: TranslatedCopyRestoreResult["kept"] = {};
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const verdict = translatedCopyRestoreVerdict(row);
    const fee: TranslatedCopyRestoreFee = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      sourceDocumentId: num(row.source_document_id),
      namedTwinId: num(row.named_twin_id),
      namedTwinReason: row.named_twin_reason ?? null,
      englishTwinId: num(row.english_twin_id),
      verdict,
    };
    if (verdict === "restore") {
      restorable.push(fee);
      continue;
    }
    kept[verdict] = (kept[verdict] ?? 0) + 1;
    keptFees.push(fee);
  }
  // Samples show the rarer verdicts first: a twin still live is the common case.
  const keptSamples = [...keptFees.filter((fee) => fee.verdict !== "twin_live"), ...keptFees.filter((fee) => fee.verdict === "twin_live")]
    .slice(0, TRANSLATED_COPY_SAMPLES);
  return { archived: rows.length, restorable, kept, keptSamples };
}

/**
 * Read-only: every translated-copy takedown, with what the restore judges it by. Run it in the SQL
 * editor or a dry run for the count. Prefixes are matched with `left(...) = prefix` (prod collation).
 */
export function translatedCopyRestoreRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? TRANSLATED_COPY_LIMIT, 20_000));
  const reasonPrefix = `${TRANSLATED_COPY_REASON}:`;
  const heldPrefix = `${ACCOUNT_TYPE_HOLD_REASON}:`;
  return db<TranslatedCopyRestoreRow[]>`
    -- translated_copy_restore_rows
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key, fp.rolled_back_reason, fr.source_document_id,
           (left(COALESCE(fp.rolled_back_by_batch_id, ''), ${TRANSLATED_COPY_BATCH_PREFIX.length}::int) = ${TRANSLATED_COPY_BATCH_PREFIX}
             AND fp.quarantined_at IS NULL
             AND fv.review_status = 'rejected'
             AND fv.outlier_flags->>-1 = ${TRANSLATED_COPY_FLAG}) AS own_state_clean,
           other_look.check_name AS other_takedown,
           named.fee_published_id AS named_twin_id,
           (named.rolled_back_at IS NULL AND named.quarantined_at IS NULL
             AND named.institution_id = fp.institution_id
             AND named.canonical_fee_key = fp.canonical_fee_key
             AND named.amount = fp.amount) IS TRUE AS named_twin_live,
           named.rolled_back_reason AS named_twin_reason,
           english.fee_published_id AS english_twin_id,
           waiting.fee_verified_id AS english_waiting_id,
           newest.normalized_text AS newest_text
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN published_fee_records named
        ON named.fee_published_id = NULLIF(substring(fp.rolled_back_reason FROM ' twin #([0-9]+)$'), '')::bigint
      LEFT JOIN LATERAL (
        SELECT look.check_name
          FROM pipeline_feedback look
         WHERE look.fee_published_id = fp.fee_published_id
           AND look.kind IN ('takedown_pending', 'takedown_confirmed')
           AND look.check_name IS DISTINCT FROM ${TRANSLATED_COPY_CHECK}
         ORDER BY look.id
         LIMIT 1
      ) other_look ON TRUE
      LEFT JOIN LATERAL (
        SELECT other.fee_published_id
          FROM published_fee_records other
          JOIN verified_fee_observations ov ON ov.fee_verified_id = other.lineage_ref
          JOIN raw_fee_observations orw ON orw.fee_raw_id = ov.fee_raw_id
          JOIN source_documents od ON od.id = orw.source_document_id
         WHERE other.institution_id = fp.institution_id
           AND other.canonical_fee_key = fp.canonical_fee_key
           AND fp.amount IS NOT NULL
           AND other.amount = fp.amount
           AND other.fee_published_id <> fp.fee_published_id
           AND ((other.rolled_back_at IS NULL AND other.quarantined_at IS NULL)
                OR left(COALESCE(other.rolled_back_reason, ''), ${heldPrefix.length}::int) = ${heldPrefix})
           AND btrim(od.document_url) !~* ${SPANISH_COPY_URL}
         ORDER BY other.fee_published_id
         LIMIT 1
      ) english ON TRUE
      LEFT JOIN LATERAL (
        SELECT wv.fee_verified_id
          FROM verified_fee_observations wv
          JOIN raw_fee_observations wr ON wr.fee_raw_id = wv.fee_raw_id
          JOIN source_documents wd ON wd.id = wr.source_document_id
         WHERE wv.institution_id = fp.institution_id
           AND wv.canonical_fee_key = fp.canonical_fee_key
           AND fp.amount IS NOT NULL
           AND wv.amount = fp.amount
           AND wv.fee_verified_id <> fv.fee_verified_id
           AND wv.review_status IN ('verified', 'approved')
           AND btrim(wd.document_url) !~* ${SPANISH_COPY_URL}
           AND NOT EXISTS (
             SELECT 1 FROM published_fee_records wp
              WHERE wp.lineage_ref = wv.fee_verified_id AND wp.rolled_back_at IS NOT NULL
           )
         ORDER BY wv.fee_verified_id
         LIMIT 1
      ) waiting ON TRUE
      LEFT JOIN LATERAL (
        SELECT ast.normalized_text
          FROM agent_source_texts ast
         WHERE ast.source_document_id = fr.source_document_id
           AND ast.status = 'completed'
           AND ast.normalized_text IS NOT NULL
         ORDER BY ast.id DESC
         LIMIT 1
      ) newest ON TRUE
     WHERE fp.rolled_back_at IS NOT NULL
       AND left(COALESCE(fp.rolled_back_reason, ''), ${reasonPrefix.length}::int) = ${reasonPrefix}
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * Reads and judges every translated-copy takedown; switched on and not a dry run, brings back the
 * restorable ones (see "The restore"). Never throws: a failed read restores nothing, and a failed
 * write leaves every fee down.
 */
export async function restoreTranslatedCopies(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<TranslatedCopyRestoreResult> {
  const live = options.live ?? TRANSLATED_COPY_RESTORE_LIVE;
  const result: TranslatedCopyRestoreResult = { live, archived: 0, restorable: [], kept: {}, keptSamples: [], restored: [] };
  let rows: TranslatedCopyRestoreRow[];
  try {
    rows = await inSavepoint(db, (scope) => translatedCopyRestoreRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] translated copy restore read failed", error instanceof Error ? error.message : error);
    return result;
  }
  Object.assign(result, judgeTranslatedCopyRestores(rows));
  if (!live || options.dryRun || result.restorable.length === 0) return result;

  const now = options.now ?? new Date();
  const reasonPrefix = `${TRANSLATED_COPY_REASON}:`;
  try {
    result.restored = await inSavepoint(db, async (scope) => {
      // The state is re-checked in the write: a fee another rule touched since the read stays down.
      const back = await scope<{ fee_published_id: number | string }[]>`
        WITH eligible AS (
          SELECT fp.fee_published_id, fp.lineage_ref
            FROM published_fee_records fp
            JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
           WHERE fp.fee_published_id = ANY(${result.restorable.map((fee) => fee.feePublishedId)}::bigint[])
             AND fp.rolled_back_at IS NOT NULL
             AND fp.quarantined_at IS NULL
             AND left(COALESCE(fp.rolled_back_reason, ''), ${reasonPrefix.length}::int) = ${reasonPrefix}
             AND left(COALESCE(fp.rolled_back_by_batch_id, ''), ${TRANSLATED_COPY_BATCH_PREFIX.length}::int) = ${TRANSLATED_COPY_BATCH_PREFIX}
             AND fv.review_status = 'rejected'
             AND fv.outlier_flags->>-1 = ${TRANSLATED_COPY_FLAG}
        ), verified AS (
          UPDATE verified_fee_observations fv
             SET review_status = 'verified',
                 outlier_flags = (fv.outlier_flags - ${TRANSLATED_COPY_FLAG}::text) || jsonb_build_array(${TRANSLATED_COPY_RESTORED_FLAG}::text)
            FROM eligible e
           WHERE fv.fee_verified_id = e.lineage_ref
          RETURNING fv.fee_verified_id
        )
        UPDATE published_fee_records fp
           SET rolled_back_at = NULL, rolled_back_by_batch_id = NULL, rolled_back_reason = NULL
          FROM eligible e
         WHERE fp.fee_published_id = e.fee_published_id
           AND e.lineage_ref IN (SELECT fee_verified_id FROM verified)
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(back.map((row) => Number(row.fee_published_id)));
      const restored = result.restorable.filter((fee) => ids.has(fee.feePublishedId));
      // The second look goes from confirmed to cleared with the restore, or neither happens.
      if (restored.length > 0) await recordFeedback(scope, restored.flatMap((fee) => restoreClearedFeedback(fee, options.runId, now)));
      return restored.map((fee) => fee.feePublishedId);
    });
  } catch (error) {
    console.error("[darwin] translated copy restore failed", error instanceof Error ? error.message : error);
    result.restored = [];
    return result;
  }
  if (result.restored.length === 0) return result;
  invalidatePublicReadCache();
  const done = new Set(result.restored);
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.translated_copy_restored', 'completed',
        ${`Restored ${result.restored.length} fee(s) read from a Spanish copy whose English twin is no longer live`},
        ${JSON.stringify({
          version: TRANSLATED_COPY_CHECK_VERSION,
          restored: result.restored.length,
          reason: "english_twin_gone",
          samples: result.restorable.filter((fee) => done.has(fee.feePublishedId)).slice(0, 50).map(restoreSampleDetail),
        })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] translated copy restore event failed", error instanceof Error ? error.message : error);
  }
  return result;
}

function restoreClearedFeedback(fee: TranslatedCopyRestoreFee, runId: number, now: Date): FeedbackRow[] {
  const row = {
    aboutStage: "publish" as const,
    aboutStrategy: TRANSLATED_COPY_CHECK,
    reportedBy: "gutenberg" as const,
    checkName: TRANSLATED_COPY_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: fee.amount,
    runId,
    evidence: {
      original_kind: "takedown_confirmed",
      restored: true,
      restore_reason: "english_twin_gone",
      named_twin_fee_published_id: fee.namedTwinId,
      named_twin_reason: fee.namedTwinReason,
      cleared_run_id: runId,
      cleared_at: now.toISOString(),
    },
  };
  return [
    { ...row, dedupeKey: secondLookDedupeKey(TRANSLATED_COPY_CHECK, fee.feePublishedId), signal: "right", kind: CLEARED_KIND, weight: 1 },
    { ...row, dedupeKey: secondLookEventKey(TRANSLATED_COPY_CHECK, fee.feePublishedId, "cleared", runId), signal: "right", kind: FLAG_CLEARED_KIND, weight: 0 },
  ];
}

function restoreSampleDetail(fee: TranslatedCopyRestoreFee) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    named_twin_fee_published_id: fee.namedTwinId,
    named_twin_reason: fee.namedTwinReason,
    english_twin_fee_published_id: fee.englishTwinId,
    verdict: fee.verdict,
  };
}

function findingsOnly(found: ReturnType<typeof findTranslatedCopies>): TranslatedCopyFindings {
  const { matches: _matches, passing: _passing, ...findings } = found;
  void _matches;
  void _passing;
  return findings;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing checked,
 * and a failed write leaves the fees as they were.
 */
export async function recheckTranslatedCopies(
  db: SqlTag,
  options: {
    runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; restoreLive?: boolean; limit?: number; now?: Date;
  },
): Promise<TranslatedCopyResult> {
  const live = options.live ?? TRANSLATED_COPY_TAKEDOWN_LIVE;
  // The restore runs first, so a fee it brings back is read below as live (a Spanish-only fee stays).
  const restore = await restoreTranslatedCopies(db, { ...options, live: options.restoreLive ?? TRANSLATED_COPY_RESTORE_LIVE });
  const result: TranslatedCopyResult = {
    live, dryRun: options.dryRun, ...findingsOnly(findTranslatedCopies([])), flagged: 0, waiting: 0, cleared: 0, takenDown: [], restore,
  };
  let rows: TranslatedCopyRow[];
  try {
    rows = await inSavepoint(db, (scope) => translatedCopyRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] translated copy check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  const found = findTranslatedCopies(rows);
  Object.assign(result, findingsOnly(found));

  if (live && !options.dryRun && (found.matches.length > 0 || found.passing.length > 0)) {
    const look = await secondLook(db, {
      check: TRANSLATED_COPY_CHECK, runId: options.runId, failing: found.matches, passing: found.passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  // The step's report. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${TRANSLATED_COPY_CHECK}, 'completed',
          ${`Read ${result.checked} live fee(s) on Spanish copies of a schedule: ${result.matched} have an English twin at the same price and would come down, ${result.keptSpanishOnly} have no English twin and ${result.keptEnglishName} carry an English name, so they stay; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}; of ${restore.archived} archived, ${restore.restorable.length} have no English line left (${restore.live ? `${restore.restored.length} restored` : "restore switch off, nothing restored"})`},
          ${JSON.stringify(translatedCopyDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] translated copy check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: TranslatedCopyMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-translated-copy-${runId}`},
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
                   WHEN fv.outlier_flags ? ${TRANSLATED_COPY_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${TRANSLATED_COPY_FLAG}::text)
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
    console.error("[darwin] translated copy takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: TranslatedCopyMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.translated_copy_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) read from Spanish copies of a schedule whose English line is live, on their second look`},
        ${JSON.stringify({ version: TRANSLATED_COPY_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] translated copy takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: TranslatedCopyMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    document_url: fee.documentUrl,
    twin_fee_published_id: fee.twinFeePublishedId,
    twin_fee_name: fee.twinFeeName,
    verdict: fee.verdict,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function translatedCopyDetail(result: TranslatedCopyResult) {
  return {
    check: TRANSLATED_COPY_CHECK,
    version: TRANSLATED_COPY_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    checked: result.checked,
    matched: result.matched,
    kept_spanish_only: result.keptSpanishOnly,
    kept_english_name: result.keptEnglishName,
    documents: result.documents,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
    kept_samples: result.keptSamples.map(sampleDetail),
    restore: {
      switch_live: result.restore.live,
      archived: result.restore.archived,
      restorable: result.restore.restorable.length,
      kept: result.restore.kept,
      restored: result.restore.restored,
      restorable_samples: result.restore.restorable.slice(0, TRANSLATED_COPY_SAMPLES).map(restoreSampleDetail),
      kept_samples: result.restore.keptSamples.map(restoreSampleDetail),
    },
  };
}
