import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";

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
 *
 * Dry run, prod read-only, 2026-10-18 (`translatedCopyRowsSql` through `findTranslatedCopies`): 127
 * live fees on 12 Spanish-copy documents at 11 institutions; 35 would come down (Sound 22, OnPoint 6,
 * M&T 5, FirstBank PR 2), 33 Spanish names have no English twin and 59 carry an English name
 * (East West's 6 twinned rows among them), so 92 stay.
 */
export const TRANSLATED_COPY_CHECK = "darwin.translated_copy";
export const TRANSLATED_COPY_CHECK_VERSION = 1;
/** The switch. Off (shadow) until James sees the dry-run count. Turn on by PR; roll back by setting it to false. */
export const TRANSLATED_COPY_TAKEDOWN_LIVE = false;
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
  /(?<![\p{L}])(?:cargos?|por|de|del|la|el|los|las|cuentas?|cheques?|pagos?|sobregiro|transferencias?|tarjetas?|caja|copias?|giro|postal|notario|retiros?|efectivo|comision|embargo|reemplazo|llave|cierre|detener|acciones|adelantos?|compra|mensual|mantenimiento|seguridad|extracto|escritura|partida|atrasado|legales|bancaria|nacional|internacional|saliente|entrante|miembro|repuesto|anticipado|regalo|sucursales)(?![\p{L}])/giu;

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
           AND other.amount IS NOT DISTINCT FROM fp.amount
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
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<TranslatedCopyResult> {
  const live = options.live ?? TRANSLATED_COPY_TAKEDOWN_LIVE;
  const result: TranslatedCopyResult = {
    live, dryRun: options.dryRun, ...findingsOnly(findTranslatedCopies([])), flagged: 0, waiting: 0, cleared: 0, takenDown: [],
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
          ${`Read ${result.checked} live fee(s) on Spanish copies of a schedule: ${result.matched} have an English twin at the same price and would come down, ${result.keptSpanishOnly} have no English twin and ${result.keptEnglishName} carry an English name, so they stay; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
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
  };
}
