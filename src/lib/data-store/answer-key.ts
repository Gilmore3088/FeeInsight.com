import { z } from "zod";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { sql } from "./connection";
import type { GoalScorecard } from "@/lib/agents/goal-scorecard";
import { queueBoardFromDetail, type QueueBoard } from "@/lib/agents/queue-board";
import { eligibleReferences, readReferenceEligibility, referenceScoreCohort, sameReferenceCohort, type ReferenceEligibilitySnapshot } from "./answer-key-reference-store";
import type { ReferenceScoreCohort } from "./answer-key-eligibility";

/**
 * The answer key: hand-checked fee documents and fees for ~60 institutions, the
 * measuring stick for the pipeline (Atlas's score-answer-key step reads it). Rows
 * start 'prefilled' (drafted from stored text) and become 'confirmed' when a person
 * has checked them on /admin/answer-key. Only confirmed institutions and confirmed
 * fee rows are scored.
 *
 * Prefill JSON (import format, version 1):
 *
 *   {
 *     "version": 1,
 *     "generated_at": "2026-10-04T00:00:00Z",       // optional
 *     "institutions": [{
 *       "institution_id": 123,                       // institution_sources.id
 *       "institution_name": "Example Bank",          // optional, for people only
 *       "document_url": "https://example.com/fees.pdf",
 *       "document_type": "html" | "text_pdf" | "scanned_pdf" | "js_page",
 *       "content_hash": "sha256…" | null,            // optional: same bytes count as the right document
 *       "notes": "why this bank is in the key",      // optional
 *       "fees": [{
 *         "canonical_key": "overdraft",              // a key from src/lib/fee-taxonomy.ts
 *         "amount": 32.00 | null,
 *         "amount_kind": "fixed" | "free" | "varies",// optional; defaults from amount (null → varies, 0 → free)
 *         "frequency": "per_item" | null,
 *         "conditions": "max 4 per day" | null,
 *         "source_line": "Overdraft fee (per item) $32.00",
 *         "uncertain": false                         // true when the drafter was not sure
 *       }]
 *     }]
 *   }
 *
 * Importing never touches a confirmed institution; it replaces the fee rows of a
 * prefilled one.
 */

type SqlTag = typeof sql;

/**
 * Answer-key scorer versions (#1280). Each run stores one `answer_key_score_runs` row
 * per version, and every reader picks one series, so a rule change never splices two
 * series into one trend. v2 scores the bank's link and the key's own documents; v3 is v2 plus fees
 * published as a rate (`published_fee_rate_catalog`), which can match a key fee keyed as
 * "varies". v4 is v3 plus the bank's documents holding the same text as the key's document (one
 * page Magellan stored under several URLs). v1 (the bank's newest stored page, every document's
 * fees) and v2 keep running for their history. v5 is v4 with the key's lines read in today's
 * taxonomy: a line under a category a live split has since divided is scored under the category the
 * split gives its printed line (`keyFeesForVersion`, answer-key-score.ts). The headline stays v3
 * until James moves it: v4 and v5 are changes of measure, not of data.
 */
export const ANSWER_KEY_SCORER_VERSIONS = [1, 2, 3, 4, 5] as const;
export type AnswerKeyScorerVersion = (typeof ANSWER_KEY_SCORER_VERSIONS)[number];
/** The series the scoreboard, the admin page and the goal read. */
export const ANSWER_KEY_SCORER_VERSION: AnswerKeyScorerVersion = 3;

export const ANSWER_KEY_DOCUMENT_TYPES = ["html", "text_pdf", "scanned_pdf", "js_page"] as const;
export type AnswerKeyDocumentType = (typeof ANSWER_KEY_DOCUMENT_TYPES)[number];
export const ANSWER_KEY_AMOUNT_KINDS = ["fixed", "free", "varies"] as const;
export type AnswerKeyAmountKind = (typeof ANSWER_KEY_AMOUNT_KINDS)[number];
export type AnswerKeyStatus = "prefilled" | "confirmed";

export const VALID_ANSWER_KEY_CANONICAL_KEYS: ReadonlySet<string> = new Set(Object.values(CANONICAL_KEY_MAP));

export interface AnswerKeyFee {
  id: number;
  canonical_key: string;
  amount: number | null;
  amount_kind: AnswerKeyAmountKind;
  frequency: string | null;
  conditions: string | null;
  source_line: string | null;
  uncertain: boolean;
  status: AnswerKeyStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface AnswerKeyInstitution {
  id: number;
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  charter_type: string | null;
  asset_size: number | null;
  document_url: string;
  document_type: AnswerKeyDocumentType;
  content_hash: string | null;
  status: AnswerKeyStatus;
  notes: string | null;
  prefill_source: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  fee_count: number;
  confirmed_fee_count: number;
  uncertain_fee_count: number;
}

export interface AnswerKeyBankScore {
  institution_id: number;
  precision: number | null;
  recall: number | null;
  stages: Record<string, { right: boolean | null; matched?: number; expected?: number; predicted?: number }>;
}

export interface AnswerKeyListRow extends AnswerKeyInstitution {
  score: AnswerKeyBankScore | null;
  eligibility?: { status: string; reason: string; eventId: number | null; checkedAt: string | null };
}

/**
 * Who keyed a bank without a person checking it. Claude threads confirmed 62 banks as
 * `knox-hand-key` (Oct 5-6); those still need a person, and only a person's confirmation
 * counts toward the human-checked accuracy number.
 */
export const MACHINE_ANSWER_KEYERS: ReadonlySet<string> = new Set(["knox-hand-key"]);

/** True when a person (not a Claude thread) confirmed the bank's key. */
export function isPersonChecked(row: Pick<AnswerKeyInstitution, "status" | "confirmed_by">): boolean {
  return row.status === "confirmed" && !MACHINE_ANSWER_KEYERS.has(row.confirmed_by ?? "");
}

/**
 * Who checked one fee row. A person's bank-level confirmation covers every row on the key, so a
 * row a Claude thread keyed (`knox-hand-key`) counts as that person's once they confirm the bank.
 */
export function feeCheckedBy(
  feeConfirmedBy: string | null,
  institution: Pick<AnswerKeyInstitution, "status" | "confirmed_by">,
): string | null {
  if (MACHINE_ANSWER_KEYERS.has(feeConfirmedBy ?? "") && isPersonChecked(institution)) return institution.confirmed_by;
  return feeConfirmedBy;
}

/** Banks a person still has to check, shortest key first, so each one is a quick read. */
export function banksToCheck<T extends Pick<AnswerKeyInstitution, "status" | "confirmed_by" | "fee_count" | "id">>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isPersonChecked(row)).sort((a, b) => a.fee_count - b.fee_count || a.id - b.id);
}

/** True once the answer-key migration is applied (the app runs fine before it). */
export async function answerKeySchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`
    SELECT to_regclass('public.answer_key_institutions') IS NOT NULL
       AND to_regclass('public.answer_key_fees') IS NOT NULL
       AND to_regclass('public.answer_key_score_runs') IS NOT NULL AS ready
  `;
  return row?.ready === true;
}

// ── Prefill parsing (pure) ───────────────────────────────────────────────────

const prefillFeeSchema = z.object({
  canonical_key: z.string().trim().min(1),
  amount: z.union([z.number(), z.string(), z.null()]).optional(),
  amount_kind: z.enum(ANSWER_KEY_AMOUNT_KINDS).optional(),
  frequency: z.string().trim().max(200).nullable().optional(),
  conditions: z.string().trim().max(2_000).nullable().optional(),
  source_line: z.string().trim().max(2_000).nullable().optional(),
  uncertain: z.boolean().optional(),
});

const prefillInstitutionSchema = z.object({
  institution_id: z.coerce.number().int().positive(),
  institution_name: z.string().optional(),
  document_url: z.string().trim().min(1).max(2_000),
  document_type: z.enum(ANSWER_KEY_DOCUMENT_TYPES),
  content_hash: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  fees: z.array(prefillFeeSchema).default([]),
}).passthrough();

const prefillFileSchema = z.object({
  version: z.literal(1),
  generated_at: z.string().optional(),
  institutions: z.array(prefillInstitutionSchema),
}).passthrough();

export interface PrefillFee {
  canonical_key: string;
  amount: number | null;
  amount_kind: AnswerKeyAmountKind;
  frequency: string | null;
  conditions: string | null;
  source_line: string | null;
  uncertain: boolean;
}

export interface PrefillInstitution {
  institution_id: number;
  document_url: string;
  document_type: AnswerKeyDocumentType;
  content_hash: string | null;
  notes: string | null;
  fees: PrefillFee[];
}

export interface ParsedPrefill {
  institutions: PrefillInstitution[];
  errors: string[];
}

function parseAmount(value: number | string | null | undefined): number | null | "invalid" {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return "invalid";
  return Math.round(parsed * 100) / 100;
}

/** Fills amount_kind from the amount when it is missing, and checks the pair. */
export function normalizeFeeAmount(
  amountInput: number | string | null | undefined,
  kindInput: AnswerKeyAmountKind | null | undefined,
): { amount: number | null; amount_kind: AnswerKeyAmountKind } | { error: string } {
  const amount = parseAmount(amountInput);
  if (amount === "invalid") return { error: "amount must be a non-negative number" };
  const kind: AnswerKeyAmountKind = kindInput ?? (amount == null ? "varies" : amount === 0 ? "free" : "fixed");
  if (kind === "fixed" && amount == null) return { error: "a fixed fee needs an amount" };
  if (kind === "free") return { amount: 0, amount_kind: "free" };
  if (kind === "varies") return { amount: null, amount_kind: "varies" };
  return { amount, amount_kind: kind };
}

/** Validates a prefill file. Bad institutions or fee rows are reported and left out. */
export function parseAnswerKeyPrefill(input: unknown): ParsedPrefill {
  const parsed = prefillFileSchema.safeParse(input);
  if (!parsed.success) {
    return { institutions: [], errors: [`Not a version 1 prefill file: ${parsed.error.issues[0]?.message ?? "invalid"}`] };
  }
  const errors: string[] = [];
  const seen = new Set<number>();
  const institutions: PrefillInstitution[] = [];
  for (const entry of parsed.data.institutions) {
    if (seen.has(entry.institution_id)) {
      errors.push(`Institution ${entry.institution_id} appears twice; kept the first.`);
      continue;
    }
    seen.add(entry.institution_id);
    const fees: PrefillFee[] = [];
    entry.fees.forEach((fee, index) => {
      const where = `Institution ${entry.institution_id} fee ${index + 1}`;
      if (!VALID_ANSWER_KEY_CANONICAL_KEYS.has(fee.canonical_key)) {
        errors.push(`${where}: unknown canonical key "${fee.canonical_key}".`);
        return;
      }
      const amount = normalizeFeeAmount(fee.amount, fee.amount_kind);
      if ("error" in amount) {
        errors.push(`${where}: ${amount.error}.`);
        return;
      }
      fees.push({
        canonical_key: fee.canonical_key,
        ...amount,
        frequency: fee.frequency?.trim() || null,
        conditions: fee.conditions?.trim() || null,
        source_line: fee.source_line?.trim() || null,
        uncertain: fee.uncertain ?? false,
      });
    });
    institutions.push({
      institution_id: entry.institution_id,
      document_url: entry.document_url,
      document_type: entry.document_type,
      content_hash: entry.content_hash?.trim() || null,
      notes: entry.notes?.trim() || null,
      fees,
    });
  }
  return { institutions, errors };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface AnswerKeyImportResult {
  inserted: number;
  updated: number;
  skippedConfirmed: number;
  skippedUnknownInstitution: number;
  fees: number;
  errors: string[];
}

/** Loads a parsed prefill. Confirmed institutions are never overwritten. */
export async function importAnswerKeyPrefill(
  prefill: ParsedPrefill,
  { actor, source }: { actor: string; source: string },
  db: SqlTag = sql,
): Promise<AnswerKeyImportResult> {
  const result: AnswerKeyImportResult = {
    inserted: 0,
    updated: 0,
    skippedConfirmed: 0,
    skippedUnknownInstitution: 0,
    fees: 0,
    errors: [...prefill.errors],
  };
  if (prefill.institutions.length === 0) return result;
  const ids = prefill.institutions.map((entry) => entry.institution_id);
  const known = new Set(
    (await db`SELECT id FROM institution_sources WHERE id = ANY(${ids}::bigint[])`).map((row) => Number(row.id)),
  );

  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as SqlTag;
    for (const entry of prefill.institutions) {
      if (!known.has(entry.institution_id)) {
        result.skippedUnknownInstitution += 1;
        result.errors.push(`Institution ${entry.institution_id} is not in institution_sources; skipped.`);
        continue;
      }
      const [existing] = await tx`
        SELECT id, status FROM answer_key_institutions WHERE institution_id = ${entry.institution_id}
      `;
      if (existing?.status === "confirmed") {
        result.skippedConfirmed += 1;
        continue;
      }
      const [row] = await tx`
        INSERT INTO answer_key_institutions
          (institution_id, document_url, document_type, content_hash, notes, status, prefill_source, prefilled_at)
        VALUES
          (${entry.institution_id}, ${entry.document_url}, ${entry.document_type}, ${entry.content_hash},
           ${entry.notes}, 'prefilled', ${`${source} by ${actor}`}, NOW())
        ON CONFLICT (institution_id) DO UPDATE
           SET document_url = EXCLUDED.document_url,
               document_type = EXCLUDED.document_type,
               content_hash = EXCLUDED.content_hash,
               notes = EXCLUDED.notes,
               prefill_source = EXCLUDED.prefill_source,
               prefilled_at = NOW(),
               updated_at = NOW()
        RETURNING id
      `;
      const answerKeyId = Number(row.id);
      if (existing) {
        result.updated += 1;
        await tx`DELETE FROM answer_key_fees WHERE answer_key_institution_id = ${answerKeyId}`;
      } else {
        result.inserted += 1;
      }
      for (const fee of entry.fees) {
        await tx`
          INSERT INTO answer_key_fees
            (answer_key_institution_id, canonical_key, amount, amount_kind, frequency, conditions, source_line, uncertain)
          VALUES
            (${answerKeyId}, ${fee.canonical_key}, ${fee.amount}, ${fee.amount_kind}, ${fee.frequency},
             ${fee.conditions}, ${fee.source_line}, ${fee.uncertain})
        `;
        result.fees += 1;
      }
    }
  });
  return result;
}

export interface AnswerKeyFeeInput {
  canonical_key: string;
  amount: number | string | null;
  amount_kind?: AnswerKeyAmountKind | null;
  frequency?: string | null;
  conditions?: string | null;
  source_line?: string | null;
}

function validateFeeInput(input: AnswerKeyFeeInput) {
  if (!VALID_ANSWER_KEY_CANONICAL_KEYS.has(input.canonical_key)) {
    return { error: `Unknown canonical key "${input.canonical_key}".` } as const;
  }
  const amount = normalizeFeeAmount(input.amount, input.amount_kind ?? null);
  if ("error" in amount) return { error: amount.error } as const;
  return {
    canonical_key: input.canonical_key,
    ...amount,
    frequency: input.frequency?.trim() || null,
    conditions: input.conditions?.trim() || null,
    source_line: input.source_line?.trim() || null,
  } as const;
}

/** Saves a person's correction to one fee row and marks it confirmed by them. */
export async function saveAnswerKeyFee(
  feeId: number,
  input: AnswerKeyFeeInput,
  actor: string,
  db: SqlTag = sql,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fee = validateFeeInput(input);
  if ("error" in fee) return { ok: false, error: fee.error ?? "invalid fee" };
  const updated = await db`
    UPDATE answer_key_fees
       SET canonical_key = ${fee.canonical_key},
           amount = ${fee.amount},
           amount_kind = ${fee.amount_kind},
           frequency = ${fee.frequency},
           conditions = ${fee.conditions},
           source_line = ${fee.source_line},
           uncertain = false,
           status = 'confirmed',
           confirmed_by = ${actor},
           confirmed_at = NOW(),
           updated_at = NOW()
     WHERE id = ${feeId}
    RETURNING id
  `;
  return updated.length > 0 ? { ok: true } : { ok: false, error: "Fee row not found." };
}

/** Adds a fee the prefill missed; a person typed it, so it is confirmed. */
export async function addAnswerKeyFee(
  answerKeyId: number,
  input: AnswerKeyFeeInput,
  actor: string,
  db: SqlTag = sql,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fee = validateFeeInput(input);
  if ("error" in fee) return { ok: false, error: fee.error ?? "invalid fee" };
  await db`
    INSERT INTO answer_key_fees
      (answer_key_institution_id, canonical_key, amount, amount_kind, frequency, conditions, source_line,
       status, confirmed_by, confirmed_at)
    VALUES
      (${answerKeyId}, ${fee.canonical_key}, ${fee.amount}, ${fee.amount_kind}, ${fee.frequency},
       ${fee.conditions}, ${fee.source_line}, 'confirmed', ${actor}, NOW())
  `;
  return { ok: true };
}

export async function deleteAnswerKeyFee(feeId: number, db: SqlTag = sql): Promise<void> {
  await db`DELETE FROM answer_key_fees WHERE id = ${feeId}`;
}

/** Corrects the document. A changed document means the bank needs confirming again. */
export async function saveAnswerKeyDocument(
  answerKeyId: number,
  input: { document_url: string; document_type: AnswerKeyDocumentType; content_hash: string | null; notes: string | null },
  actor: string,
  db: SqlTag = sql,
): Promise<void> {
  await db`
    UPDATE answer_key_institutions
       SET document_url = ${input.document_url},
           document_type = ${input.document_type},
           content_hash = ${input.content_hash},
           notes = ${input.notes},
           confirmed_by = ${actor},
           confirmed_at = NOW(),
           updated_at = NOW()
     WHERE id = ${answerKeyId}
  `;
}

/**
 * "Confirm all": the document and every fee row, by this person, now. A row a Claude thread
 * confirmed (`knox-hand-key`) is re-stamped to the person too, so feedback sync reads it as
 * human-checked; a row another person already confirmed keeps its confirmer.
 */
export async function confirmAnswerKeyInstitution(answerKeyId: number, actor: string, db: SqlTag = sql): Promise<void> {
  const machineKeyers = [...MACHINE_ANSWER_KEYERS];
  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as SqlTag;
    await tx`
      UPDATE answer_key_fees
         SET status = 'confirmed', uncertain = false, confirmed_by = ${actor},
             confirmed_at = NOW(), updated_at = NOW()
       WHERE answer_key_institution_id = ${answerKeyId}
         AND (status <> 'confirmed' OR confirmed_by IS NULL OR confirmed_by = ANY(${machineKeyers}::text[]))
    `;
    await tx`
      UPDATE answer_key_institutions
         SET status = 'confirmed', confirmed_by = ${actor}, confirmed_at = NOW(), updated_at = NOW()
       WHERE id = ${answerKeyId}
    `;
  });
}

/** Sends a bank back to 'prefilled' so it stops counting until it is checked again. */
export async function reopenAnswerKeyInstitution(answerKeyId: number, db: SqlTag = sql): Promise<void> {
  await db`
    UPDATE answer_key_institutions SET status = 'prefilled', updated_at = NOW() WHERE id = ${answerKeyId}
  `;
}

// ── Reads ────────────────────────────────────────────────────────────────────

function toIso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapInstitution(row: Record<string, unknown>): AnswerKeyInstitution {
  return {
    id: Number(row.id),
    institution_id: Number(row.institution_id),
    institution_name: String(row.institution_name ?? `Institution ${row.institution_id}`),
    state_code: (row.state_code as string | null)?.trim() || null,
    charter_type: (row.charter_type as string | null) ?? null,
    asset_size: row.asset_size == null ? null : Number(row.asset_size),
    document_url: String(row.document_url),
    document_type: row.document_type as AnswerKeyDocumentType,
    content_hash: (row.content_hash as string | null) ?? null,
    status: row.status as AnswerKeyStatus,
    notes: (row.notes as string | null) ?? null,
    prefill_source: (row.prefill_source as string | null) ?? null,
    confirmed_by: (row.confirmed_by as string | null) ?? null,
    confirmed_at: toIso(row.confirmed_at),
    fee_count: Number(row.fee_count ?? 0),
    confirmed_fee_count: Number(row.confirmed_fee_count ?? 0),
    uncertain_fee_count: Number(row.uncertain_fee_count ?? 0),
  };
}

const INSTITUTION_COLUMNS = `
  ak.id, ak.institution_id, inst.institution_name, inst.state_code, inst.charter_type, inst.asset_size,
  ak.document_url, ak.document_type, ak.content_hash, ak.status, ak.notes, ak.prefill_source,
  ak.confirmed_by, ak.confirmed_at,
  (SELECT COUNT(*) FROM answer_key_fees f WHERE f.answer_key_institution_id = ak.id)::int AS fee_count,
  (SELECT COUNT(*) FROM answer_key_fees f WHERE f.answer_key_institution_id = ak.id AND f.status = 'confirmed')::int AS confirmed_fee_count,
  (SELECT COUNT(*) FROM answer_key_fees f WHERE f.answer_key_institution_id = ak.id AND f.uncertain)::int AS uncertain_fee_count
`;

/** Per-institution scores from the newest score run, keyed by institution id. */
async function latestBankScores(db: SqlTag, eligibility: ReferenceEligibilitySnapshot): Promise<Map<number, AnswerKeyBankScore>> {
  const [run] = await db`
    SELECT by_bank, by_stage FROM answer_key_score_runs
     WHERE scorer_version = ${ANSWER_KEY_SCORER_VERSION}
     ORDER BY scored_at DESC, id DESC LIMIT 1
  `;
  if (!sameReferenceCohort(referenceScoreCohort(run?.by_stage?._reference), eligibility.cohort) || eligibility.readError) return new Map();
  const banks = Array.isArray(run?.by_bank) ? (run.by_bank as AnswerKeyBankScore[]) : [];
  return new Map(banks.map((bank) => [Number(bank.institution_id), bank]));
}

export async function listAnswerKeyInstitutions(db: SqlTag = sql, eligibility?: ReferenceEligibilitySnapshot): Promise<AnswerKeyListRow[]> {
  const snapshot = eligibility ?? await readReferenceEligibility(db);
  const rows = await db.unsafe(`
    SELECT ${INSTITUTION_COLUMNS}
      FROM answer_key_institutions ak
      JOIN institution_sources inst ON inst.id = ak.institution_id
     ORDER BY ak.status DESC, inst.institution_name
  `);
  const scores = await latestBankScores(db, snapshot);
  return rows.map((row) => {
    const institution = mapInstitution(row);
    const decision = snapshot.keys.find((key) => key.input.key.answerKeyId === institution.id);
    return { ...institution, score: decision?.status === "eligible" ? scores.get(institution.institution_id) ?? null : null,
      eligibility: { status: decision?.status ?? "unknown", reason: decision?.reason ?? "eligibility_missing",
        eventId: decision?.eventId ?? null, checkedAt: decision?.receipt?.checkedAt ?? null } };
  });
}

export async function getAnswerKeyInstitution(
  answerKeyId: number,
  db: SqlTag = sql,
  eligibility?: ReferenceEligibilitySnapshot,
): Promise<{ institution: AnswerKeyListRow; fees: AnswerKeyFee[] } | null> {
  const [row] = await db.unsafe(
    `SELECT ${INSTITUTION_COLUMNS}
       FROM answer_key_institutions ak
       JOIN institution_sources inst ON inst.id = ak.institution_id
      WHERE ak.id = $1`,
    [answerKeyId],
  );
  if (!row) return null;
  const fees = await db`
    SELECT id, canonical_key, amount, amount_kind, frequency, conditions, source_line, uncertain, status,
           confirmed_by, confirmed_at
      FROM answer_key_fees
     WHERE answer_key_institution_id = ${answerKeyId}
     ORDER BY canonical_key, id
  `;
  const institution = mapInstitution(row);
  const snapshot = eligibility ?? await readReferenceEligibility(db);
  const scores = await latestBankScores(db, snapshot);
  const decision = snapshot.keys.find((key) => key.input.key.answerKeyId === institution.id);
  return {
    institution: { ...institution, score: decision?.status === "eligible" ? scores.get(institution.institution_id) ?? null : null,
      eligibility: { status: decision?.status ?? "unknown", reason: decision?.reason ?? "eligibility_missing",
        eventId: decision?.eventId ?? null, checkedAt: decision?.receipt?.checkedAt ?? null } },
    fees: fees.map((fee) => ({
      id: Number(fee.id),
      canonical_key: String(fee.canonical_key),
      amount: fee.amount == null ? null : Number(fee.amount),
      amount_kind: fee.amount_kind as AnswerKeyAmountKind,
      frequency: (fee.frequency as string | null) ?? null,
      conditions: (fee.conditions as string | null) ?? null,
      source_line: (fee.source_line as string | null) ?? null,
      uncertain: fee.uncertain === true,
      status: fee.status as AnswerKeyStatus,
      confirmed_by: (fee.confirmed_by as string | null) ?? null,
      confirmed_at: toIso(fee.confirmed_at),
    })),
  };
}

/** A confirmed institution with its confirmed fee rows: what the scorer compares against. */
export interface ConfirmedAnswerKeyEntry {
  institutionId: number;
  documentUrl: string;
  documentType: AnswerKeyDocumentType;
  contentHash: string | null;
  /** `sourceLine` is the schedule line the key's reader confirmed; v5 reads its category through live splits. */
  fees: Array<{ canonicalKey: string; amount: number | null; amountKind: AnswerKeyAmountKind; sourceLine?: string | null }>;
}

export async function getConfirmedAnswerKey(db: SqlTag = sql, eligibility?: ReferenceEligibilitySnapshot): Promise<ConfirmedAnswerKeyEntry[]> {
  const snapshot = eligibility ?? await readReferenceEligibility(db);
  return eligibleReferences(snapshot).map(({ input: { key } }) => ({
    institutionId: key.institutionId, documentUrl: key.documentUrl,
    documentType: key.documentType as AnswerKeyDocumentType, contentHash: key.contentHash,
    fees: key.fees.filter((fee) => fee.canonicalKey !== "unmapped").map((fee) => ({
      canonicalKey: fee.canonicalKey, amount: fee.amount, amountKind: fee.amountKind as AnswerKeyAmountKind, sourceLine: fee.sourceLine,
    })),
  })).sort((a, b) => a.institutionId - b.institutionId);
}

export interface AnswerKeyScoreRunRow {
  id: number;
  agent_run_id: number | null;
  scorer_version: number;
  scored_at: string;
  banks_scored: number;
  fees_expected: number;
  precision: number | null;
  recall: number | null;
  by_stage: Record<string, unknown>;
  by_category: Record<string, unknown>;
  by_document_type: Record<string, unknown>;
  reference?: ReferenceScoreCohort | null;
  referenceState?: "measured" | "no_measurement" | "legacy_ungated" | "cohort_changed" | "unavailable";
}

export async function getLatestAnswerKeyScoreRun(
  db: SqlTag = sql,
  version: AnswerKeyScorerVersion = ANSWER_KEY_SCORER_VERSION,
  eligibility?: ReferenceEligibilitySnapshot,
): Promise<AnswerKeyScoreRunRow | null> {
  const [row] = await db`
    SELECT id, agent_run_id, scorer_version, scored_at, banks_scored, fees_expected, precision, recall,
           by_stage, by_category, by_document_type
      FROM answer_key_score_runs
     WHERE scorer_version = ${version}
     ORDER BY scored_at DESC, id DESC
     LIMIT 1
  `;
  if (!row) return null;
  const snapshot = eligibility ?? await readReferenceEligibility(db);
  const storedReference = referenceScoreCohort((row.by_stage as Record<string, unknown> | null)?._reference);
  const compatible = sameReferenceCohort(storedReference, snapshot.cohort) && !snapshot.readError;
  const referenceState = snapshot.readError ? "unavailable" : !storedReference ? "legacy_ungated" : !compatible ? "cohort_changed" : snapshot.cohort.state;
  const canMeasure = compatible && snapshot.cohort.state === "measured";
  const stages = Object.fromEntries(Object.entries((row.by_stage as Record<string, unknown> | null) ?? {})
    .filter(([name]) => ["magellan", "rosetta", "knox", "darwin", "hamilton"].includes(name)));
  return {
    id: Number(row.id),
    agent_run_id: row.agent_run_id == null ? null : Number(row.agent_run_id),
    scorer_version: Number(row.scorer_version),
    scored_at: toIso(row.scored_at) ?? "",
    banks_scored: Number(row.banks_scored),
    fees_expected: Number(row.fees_expected),
    precision: !compatible || snapshot.cohort.state !== "measured" || row.precision == null ? null : Number(row.precision),
    recall: !compatible || snapshot.cohort.state !== "measured" || row.recall == null ? null : Number(row.recall),
    by_stage: canMeasure ? stages : {},
    by_category: canMeasure ? (row.by_category as Record<string, unknown>) ?? {} : {},
    by_document_type: canMeasure ? (row.by_document_type as Record<string, unknown>) ?? {} : {},
    reference: snapshot.cohort, referenceState,
  };
}

// ── Scoreboard ───────────────────────────────────────────────────────────────

export interface ScoreboardSnapshotRow {
  snapshot_date: string;
  coverage_rate: number | null;
  coverage_numerator: number | null;
  coverage_denominator: number | null;
  right_document_rate: number | null;
  right_document_numerator: number | null;
  right_document_denominator: number | null;
  knox_yield: number | null;
  knox_yield_fees: number | null;
  knox_yield_priced_lines: number | null;
  knox_yield_sample_size: number | null;
  depth_median_categories: number | null;
  depth_live_institutions: number | null;
  accuracy_precision: number | null;
  accuracy_recall: number | null;
  accuracy_score_run_id: number | null;
  /**
   * The answer-key scorer version behind accuracy_precision/recall (#1354): `detail.accuracy_scorer_version`,
   * or for older snapshots the version of the score run they name. Null when no score run is named.
   */
  accuracy_scorer_version: number | null;
  accuracy_reference?: ReferenceScoreCohort | null;
  accuracy_reference_state?: string;
  accuracy_series?: string | null;
  legacy_accuracy_precision?: number | null;
  legacy_accuracy_recall?: number | null;
  freshness_median_days: number | null;
  freshness_live_fees: number | null;
  /** The goal scorecard stored that day (`detail.goal`, #1040); null on older snapshots. */
  goal: GoalScorecard | null;
  /** Darwin's undecided rows from that day's agent health check (`detail.agent_health`); null when not recorded. */
  darwin_backlog: number | null;
  /** The piles board stored that day (`detail.queues`, #1108); null on older snapshots. */
  queues: QueueBoard | null;
}

const SNAPSHOT_NUMBER_COLUMNS = [
  "coverage_rate", "coverage_numerator", "coverage_denominator",
  "right_document_rate", "right_document_numerator", "right_document_denominator",
  "knox_yield", "knox_yield_fees", "knox_yield_priced_lines", "knox_yield_sample_size",
  "depth_median_categories", "depth_live_institutions",
  "accuracy_precision", "accuracy_recall", "accuracy_score_run_id",
  "freshness_median_days", "freshness_live_fees",
] as const;

export async function scoreboardSchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`SELECT to_regclass('public.pipeline_scoreboard_snapshots') IS NOT NULL AS ready`;
  return row?.ready === true;
}

/**
 * Where each run of one series starts, for a trend that must not join two series (#1354).
 * A day with no known series belongs to no run: the same series on both sides of it is one run.
 */
export function seriesBreaks<T extends string | number>(keys: Array<T | null>): Array<{ start: number; key: T }> {
  const runs: Array<{ start: number; key: T }> = [];
  keys.forEach((key, index) => {
    if (key != null && key !== runs.at(-1)?.key) runs.push({ start: index, key });
  });
  return runs;
}

/** The newest snapshots, oldest first (for a trend line). */
export async function listScoreboardSnapshots(days = 30, db: SqlTag = sql): Promise<ScoreboardSnapshotRow[]> {
  const current = await readReferenceEligibility(db);
  const rows = await db`
    SELECT s.*, s.snapshot_date::text AS snapshot_day, r.scorer_version AS run_scorer_version, r.by_stage AS run_by_stage
      FROM pipeline_scoreboard_snapshots s
      LEFT JOIN answer_key_score_runs r ON r.id = s.accuracy_score_run_id
     WHERE s.snapshot_date >= CURRENT_DATE - ${days}::int
     ORDER BY s.snapshot_date ASC
  `;
  return rows.map((row, index) => {
    const snapshot: Record<string, unknown> = {
      snapshot_date: String(row.snapshot_day),
    };
    for (const column of SNAPSHOT_NUMBER_COLUMNS) {
      snapshot[column] = row[column] == null ? null : Number(row[column]);
    }
    const detail = (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail) as {
      goal?: GoalScorecard;
      accuracy_scorer_version?: number | null;
      accuracy_reference?: unknown;
      accuracy_reference_state?: string;
      agent_health?: { agents?: Array<{ agent?: string; numbers?: Record<string, unknown> }> };
    } | null;
    snapshot.goal = detail?.goal ?? null;
    const scorer = detail?.accuracy_scorer_version ?? row.run_scorer_version;
    snapshot.accuracy_scorer_version = scorer == null || !Number.isFinite(Number(scorer)) ? null : Number(scorer);
    const reference = referenceScoreCohort(detail?.accuracy_reference ?? (row.run_by_stage as Record<string, unknown> | null)?._reference);
    snapshot.accuracy_reference = reference;
    snapshot.accuracy_reference_state = !reference ? "legacy_ungated" : reference.readError ? "unavailable" : reference.state;
    snapshot.accuracy_series = reference?.state === "measured" ? `v${scorer}:reference${reference.protocol}:${reference.cohortFingerprint}:${reference.frameFingerprint}` : null;
    if (!reference || reference.state !== "measured" || (index === rows.length - 1 && (current.readError || !sameReferenceCohort(reference, current.cohort)))) {
      if (!reference) {
        snapshot.legacy_accuracy_precision = snapshot.accuracy_precision;
        snapshot.legacy_accuracy_recall = snapshot.accuracy_recall;
      } else if (reference.state === "measured") snapshot.accuracy_reference_state = current.readError ? "unavailable" : "cohort_changed";
      snapshot.accuracy_precision = null;
      snapshot.accuracy_recall = null;
      snapshot.accuracy_series = null;
    }
    const undecided = detail?.agent_health?.agents?.find((section) => section.agent === "darwin")?.numbers?.undecided;
    snapshot.darwin_backlog = undecided == null || !Number.isFinite(Number(undecided)) ? null : Number(undecided);
    snapshot.queues = queueBoardFromDetail((detail as { queues?: unknown } | null)?.queues);
    return snapshot as unknown as ScoreboardSnapshotRow;
  });
}
