import { sql } from "@/lib/data-store/connection";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import {
  emptyPaidPassResult,
  PAID_PASS_ITEMS_PER_RUN,
  PAID_PASS_MODELS,
  paidModelCall,
  paidResponseJson,
  type PaidMessageCreator,
  type PaidPassResult,
  type PaidStepOptions,
} from "@/lib/agents/paid-pass";
import {
  insertCandidate,
  insertHeldCandidate,
  KNOX_REEXTRACT_MAX_FEES,
  retireRowsFromOlderText,
  type KnoxTextRow,
} from "@/lib/agents/knox/extract";
import { amountsIn, confidenceFor, detectFrequency, MAX_REASONABLE_FEE_AMOUNT } from "@/lib/agents/knox/rules";
import { namesALimit } from "@/lib/agents/knox/layout";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { groundLineup, LINEUP_CATEGORY, type AccountLineup } from "@/lib/agents/knox/lineup";
import { CANONICAL_KEY_MAP, DISPLAY_NAMES, FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { closedInstitutionSql } from "@/lib/agents/hamilton/closed-institution";
import { DOCUMENT_OWNER_STRATEGY, documentOwnerFingerprintPrefix } from "@/lib/agents/darwin/document-owner";

type SqlTag = typeof sql;

/**
 * Pass 3 for Knox (`extract-paid`, a provider step): one model call per dense document
 * the free team (rules + specialists) read poorly. A text qualifies when it has at
 * least PAID_MIN_PRICED_LINES priced lines, the current free version found fewer than
 * KNOX_REEXTRACT_MAX_FEES fees in it, and no paid attempt exists for its text hash.
 *
 * The model gets the whole text and the canonical fee list and returns JSON rows. A row
 * is kept only when it is grounded: its source line appears in the text with its amount
 * on it (or its name and amount both appear), and its canonical key exists. Kept rows
 * are written exactly like the rule path's (`needs_darwin_verification`,
 * `canonical_hint:`), plus `knox_paid_extraction`, so Darwin verifies them like any
 * other raw row. Every call is budget-checked and cost-logged by paidModelCall; a
 * budget cap or the automation stop ends the step cleanly before any money is spent.
 *
 * No call is bought for a text whose fees could never go live (takedowns at the source,
 * 2026-10-17): a closed institution's (publish never selects it) or a document Darwin's latest
 * document-owner read judged another bank's (publish refuses its rows). Nor for a page whose
 * earlier paid read found no fee (`planPaidReads`); each skip is logged on the step
 * (`knox.paid_read_skipped`).
 */

/** Version 2: monthly maintenance rows carry the account's lineup fields (`lineup.ts`). */
export const KNOX_PAID_STRATEGY = { strategy: "extract.paid", version: 2 } as const;
export const PAID_MIN_PRICED_LINES = 15;
export const KNOX_PAID_FLAG = "knox_paid_extraction";
/** Long texts are cut to keep one call's cost bounded. */
const MAX_TEXT_CHARS = 60_000;
const MAX_OUTPUT_TOKENS = 8_000;
/** Outcomes a later run may retry: nothing about the text caused them. */
const TRANSIENT_OUTCOMES = ["timeout", "network_error", "http_429", "http_5xx", "budget_blocked"];
const STOP_ERRORS = new Set(["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"]);
const VALID_CANONICAL_KEYS = new Set(Object.values(CANONICAL_KEY_MAP));

interface PaidTextRow {
  document_text_id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  normalized_text: string;
  text_hash: string;
  free_yield: number | string | null;
  /** The latest paid read of this page's address that found no fee at all, when no paid read of it found one. */
  no_fee_read_id?: number | string | null;
}

/**
 * Why a selected text gets no paid call (zero-yield reads, 2026-10-17). Deterministic, decided
 * before the call from the attempt log alone:
 * - `same_text_this_run`: the run already holds this bank's same text under another document
 *   (a page stored twice). The attempt log reads a text once per bank, but two copies picked in
 *   one run were both bought: 149 calls ($4.08) in 14 days.
 * - `page_read_before_no_fees`: the paid reader read this page's address before, the model
 *   returned no fee at all, and no paid read of the address ever found one. A re-fetched copy
 *   with a changed text was bought again: 107 calls ($3.06) in 14 days, none with a live fee.
 */
export type PaidReadSkipReason = "same_text_this_run" | "page_read_before_no_fees";

export interface PaidReadSkip {
  documentTextId: number;
  sourceDocumentId: number;
  institutionId: number;
  textHash: string;
  reason: PaidReadSkipReason;
  /** `page_read_before_no_fees`: the earlier attempt that found no fee. */
  priorAttemptId: number | null;
}

export const PAID_READ_SKIP_LABEL: Record<PaidReadSkipReason, string> = {
  same_text_this_run: "the same bank's same text is already read in this run",
  page_read_before_no_fees: "a paid read of this page found no fee before",
};

type PlannedRow = Pick<PaidTextRow, "document_text_id" | "source_document_id" | "institution_id" | "text_hash" | "no_fee_read_id">;

/**
 * Pure: which selected texts get a paid call, in order and up to `limit`, and which are skipped
 * and why. Exported for tests.
 */
export function planPaidReads<T extends PlannedRow>(rows: T[], limit: number): { reads: T[]; skips: PaidReadSkip[] } {
  const reads: T[] = [];
  const skips: PaidReadSkip[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (reads.length >= limit) break;
    const skip = (reason: PaidReadSkipReason, priorAttemptId: number | null = null) =>
      skips.push({
        documentTextId: Number(row.document_text_id),
        sourceDocumentId: Number(row.source_document_id),
        institutionId: Number(row.institution_id),
        textHash: row.text_hash,
        reason,
        priorAttemptId,
      });
    const key = `${row.institution_id}:${row.text_hash}`;
    if (seen.has(key)) {
      skip("same_text_this_run");
      continue;
    }
    seen.add(key);
    if (row.no_fee_read_id != null) {
      skip("page_read_before_no_fees", Number(row.no_fee_read_id));
      continue;
    }
    reads.push(row);
  }
  return { reads, skips };
}

/** One row as the model returns it. */
export interface PaidFeeRow {
  fee_name?: unknown;
  canonical_key?: unknown;
  amount?: unknown;
  frequency?: unknown;
  conditions?: unknown;
  source_line?: unknown;
  /** monthly_maintenance only. */
  product_name?: unknown;
  min_balance_to_avoid?: unknown;
  min_opening_deposit?: unknown;
  waiver_text?: unknown;
}

export interface AcceptedPaidFee {
  feeName: string;
  canonicalKey: string;
  amount: number;
  frequency: string | null;
  conditions: string | null;
  sourceLine: string;
  /** monthly_maintenance only; each value grounded in the text or null. */
  lineup: AccountLineup | null;
}

export type PaidRowRejection = "missing_fields" | "unknown_canonical" | "invalid_amount" | "not_in_text" | "limit_not_fee";

/** A price in cents ("75¢", "25 cents"), which `amountsIn` leaves out. */
const CENTS_PRICE = /(?<![\d.,$])\d{1,2}\s*(?:¢|cents?\b)/gi;

/** Lines with a dollar amount; a flattened line counts once per amount. */
export function pricedLineCount(text: string): number {
  let total = 0;
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    const amounts = amountsIn(line).length + (line.match(CENTS_PRICE) ?? []).length;
    if (amounts === 0) continue;
    total += line.length <= 280 ? 1 : amounts;
  }
  return total;
}

function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[|•*·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function amountText(amount: number): string[] {
  const fixed = amount.toFixed(2);
  const whole = Number.isInteger(amount) ? String(amount) : fixed;
  const comma = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/, ",");
  return Array.from(new Set([fixed, whole, comma(fixed), comma(whole)]));
}

function lineHasAmount(line: string, amount: number): boolean {
  if (amount === 0) return /\b(free|none|no charge|no fee|n\/c|\$\s*0(?:\.00)?)\b/i.test(line);
  if (amountsIn(line).some((found) => found.value === amount)) return true;
  // PDFs often drop the dollar sign after a dot leader: "Stop payment ...... 30.00".
  return amountText(amount).some((text) => new RegExp(`(^|[^\\d.,])${text.replace(".", "\\.")}(?![\\d])`).test(line));
}

/**
 * Pure: a model row checked against the document. Exported for tests.
 * Grounded means the source line is in the text and carries the amount, or the fee
 * name and the amount both appear in the text.
 */
function statedInSource(text: string, name: string, amount: number): boolean {
  const result = checkFeeAgainstSource(text, name, amount, ".");
  return result.ok || result.reason === "tiered_fee";
}

export function groundPaidRow(row: PaidFeeRow, text: string): AcceptedPaidFee | PaidRowRejection {
  const feeName = typeof row.fee_name === "string" ? row.fee_name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const canonicalKey = typeof row.canonical_key === "string" ? row.canonical_key.trim() : "";
  const sourceLine = typeof row.source_line === "string" ? row.source_line.replace(/\s+/g, " ").trim() : "";
  const amount = typeof row.amount === "number" ? row.amount : Number(String(row.amount ?? "").replace(/[$,\s]/g, ""));
  if (!feeName || !canonicalKey || row.amount == null || row.amount === "") return "missing_fields";
  const mapped = CANONICAL_KEY_MAP[canonicalKey] ?? (VALID_CANONICAL_KEYS.has(canonicalKey) ? canonicalKey : null);
  if (!mapped) return "unknown_canonical";
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_REASONABLE_FEE_AMOUNT) return "invalid_amount";
  if (namesALimit(feeName, mapped) || namesALimit(sourceLine.replace(/\$?\s*\d[\d,]*(?:\.\d+)?\s*$/, "").trim(), mapped)) return "limit_not_fee";
  const rounded = Math.round(amount * 100) / 100;

  const haystack = comparable(text);
  const lineGrounded = sourceLine.length >= 4 && haystack.includes(comparable(sourceLine)) && lineHasAmount(sourceLine, rounded);
  const nameGrounded = haystack.includes(comparable(feeName)) && (rounded === 0 ? lineHasAmount(text, 0) : lineHasAmount(text, rounded));
  if (!lineGrounded && !nameGrounded) return "not_in_text";
  // The amount must be the fee on a row that names it, not a figure elsewhere in the text
  // ("Negative from $50.01 and more | $35" never grounds $50.01): the same rule the
  // live-fee source check and the report gate use.
  if (!statedInSource(text, feeName, rounded) && !statedInSource(text, sourceLine.replace(/\$?\s*\d[\d,]*(?:\.\d+)?/g, " "), rounded)) {
    return "not_in_text";
  }
  const frequency = typeof row.frequency === "string" && row.frequency.trim() ? row.frequency.trim().toLowerCase() : null;
  const conditions = typeof row.conditions === "string" && row.conditions.trim() ? row.conditions.trim().slice(0, 240) : null;
  // The waiver may come back in `conditions` instead of `waiver_text`; either is kept only
  // when the text states it.
  const lineup = mapped === LINEUP_CATEGORY
    ? groundLineup(
        {
          productName: row.product_name,
          minBalanceToAvoid: row.min_balance_to_avoid,
          minOpeningDeposit: row.min_opening_deposit,
          waiverText: typeof row.waiver_text === "string" && row.waiver_text.trim() ? row.waiver_text : conditions,
        },
        text,
      )
    : null;
  return {
    feeName,
    canonicalKey: mapped,
    amount: rounded,
    frequency: frequency && /^(monthly|annual|per_item|per_transaction|daily|one_time)$/.test(frequency) ? frequency : detectFrequency(sourceLine),
    conditions,
    sourceLine: sourceLine || feeName,
    lineup,
  };
}

function canonicalFeeList(): string {
  return Object.entries(FEE_FAMILIES)
    .map(([family, keys]) => `${family}: ${keys.map((key) => `${key} (${DISPLAY_NAMES[key] ?? key})`).join(", ")}`)
    .join("\n");
}

export function paidExtractPrompt(text: string): string {
  return [
    "Below is the text of a bank or credit union fee schedule. List every fee it states.",
    "Return only JSON: {\"fees\": [{\"fee_name\", \"canonical_key\", \"amount\", \"frequency\", \"conditions\", \"source_line\", \"product_name\", \"min_balance_to_avoid\", \"min_opening_deposit\", \"waiver_text\"}]}.",
    "- fee_name: the fee's name as written.",
    "- canonical_key: one key from the list below; skip fees that fit none.",
    "- amount: the dollar price as a number (0 for a fee stated as free). Skip percentages, ranges, balance requirements, interest rates, limits and caps as fees.",
    "- frequency: monthly, annual, per_item, per_transaction, daily, one_time or null.",
    "- conditions: waivers, caps or tiers stated with the fee, or null.",
    "- source_line: the exact text from the document that states the fee and its amount, copied verbatim.",
    "For a monthly_maintenance fee only, also return these four (null when the text does not state one):",
    "- product_name: the account's name as written, e.g. \"Premier Checking\".",
    "- min_balance_to_avoid: the balance that avoids the monthly fee, as a number.",
    "- min_opening_deposit: the deposit needed to open the account, as a number.",
    "- waiver_text: the text that says how the fee is waived or avoided, copied verbatim.",
    "Do not guess. Use only what the text says.",
    "",
    "Canonical keys:",
    canonicalFeeList(),
    "",
    "Document text:",
    text.slice(0, MAX_TEXT_CHARS),
  ].join("\n");
}

/** SQL: a page's address without its query or fragment, lowercased, so a re-fetched copy matches. */
function pageAddressSql(column: string): string {
  return `lower(regexp_replace(${column}, '[?#].*$', ''))`;
}

async function selectPaidTexts(db: SqlTag, limit: number, stateCode?: string): Promise<PaidTextRow[]> {
  const params: Array<string | number> = [];
  const strategy = `$${params.push(KNOX_RULES_STRATEGY.strategy)}`;
  const version = `$${params.push(KNOX_RULES_STRATEGY.version)}`;
  const maxFees = `$${params.push(KNOX_REEXTRACT_MAX_FEES)}`;
  const paidStrategy = `$${params.push(KNOX_PAID_STRATEGY.strategy)}`;
  const minDollars = `$${params.push(PAID_MIN_PRICED_LINES)}`;
  // Scan a few more than needed: the priced-line count is checked in code.
  const scan = `$${params.push(limit * 4)}`;
  const normalizedState = normalizeStateCode(stateCode);
  const stateFilter = normalizedState ? `AND upper(btrim(inst.state_code)) = $${params.push(normalizedState)}` : "";
  const ownerFingerprints = [true, false]
    .map((live) => `'${documentOwnerFingerprintPrefix(live)}' || adt.institution_id::text || ':' || adt.source_document_id::text || ':' || adt.text_hash`)
    .join(", ");
  return db.unsafe<PaidTextRow[]>(
    `
      SELECT adt.id AS document_text_id,
             adt.source_document_id,
             adt.institution_id,
             adt.source_url,
             adt.normalized_text,
             adt.text_hash,
             free.yield_count AS free_yield,
             -- The paid reader read this page's address before and the model returned no fee at
             -- all, and no paid read of the address found one (zero-yield reads, 2026-10-17). The
             -- text is still selected so the step logs the skip (planPaidReads). Looked up only
             -- for the rows returned.
             (
               SELECT prior.id
                 FROM pipeline_attempts prior
                 JOIN source_documents prior_page ON prior_page.id = prior.source_document_id
                WHERE prior.stage = 'extract'
                  AND prior.strategy = ${paidStrategy}
                  AND prior.institution_id = adt.institution_id
                  AND prior.outcome = 'no_candidates'
                  AND ${pageAddressSql("prior_page.document_url")} = ${pageAddressSql("COALESCE(page.document_url, adt.source_url)")}
                  AND NOT EXISTS (
                    SELECT 1
                      FROM pipeline_attempts found
                      JOIN source_documents found_page ON found_page.id = found.source_document_id
                     WHERE found.stage = 'extract'
                       AND found.strategy = ${paidStrategy}
                       AND found.institution_id = adt.institution_id
                       AND found.yield_count > 0
                       AND ${pageAddressSql("found_page.document_url")} = ${pageAddressSql("COALESCE(page.document_url, adt.source_url)")}
                  )
                ORDER BY prior.created_at DESC, prior.id DESC
                LIMIT 1
             ) AS no_fee_read_id
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id
        LEFT JOIN source_documents page ON page.id = adt.source_document_id
        JOIN LATERAL (
          -- The current free version already read this exact text and found few fees.
          SELECT pa.yield_count
            FROM pipeline_attempts pa
           WHERE pa.stage = 'extract'
             AND pa.institution_id = adt.institution_id
             AND pa.input_fingerprint = adt.text_hash
             AND pa.strategy = ${strategy}
             AND pa.strategy_version = ${version}
           ORDER BY pa.created_at DESC
           LIMIT 1
        ) free ON free.yield_count < ${maxFees}
       WHERE adt.status = 'completed'
         AND adt.normalized_text IS NOT NULL
         AND adt.text_hash IS NOT NULL
         ${stateFilter}
         AND NOT EXISTS (
           SELECT 1
             FROM pipeline_attempts paid
            WHERE paid.stage = 'extract'
              AND paid.institution_id = adt.institution_id
              AND paid.input_fingerprint = adt.text_hash
              AND paid.strategy = ${paidStrategy}
              AND paid.outcome NOT IN (${TRANSIENT_OUTCOMES.map((outcome) => `'${outcome}'`).join(", ")})
         )
         -- An older copy of a page whose current copy has a text is history: the paid reader
         -- reads the current copy, as the free reader does.
         AND NOT EXISTS (
           SELECT 1
             FROM source_documents old_copy
             JOIN agent_source_texts current_text
               ON current_text.source_document_id = old_copy.superseded_by_id
              AND current_text.status = 'completed'
              AND current_text.char_count > 0
            WHERE old_copy.id = adt.source_document_id
              AND old_copy.superseded_by_id IS NOT NULL
         )
         -- No paid read for a bank that no longer operates: publish never selects its rows
         -- (closed-institution.ts), so the call could only buy fees that are never shown.
         AND NOT ${closedInstitutionSql("inst")}
         -- No paid read of another bank's schedule: Darwin's latest document-owner read of this
         -- text judged the pair other_bank, and publish refuses its rows (publish-sweep-rules.ts).
         AND NOT EXISTS (
           SELECT 1
             FROM (
               SELECT owner.outcome
                 FROM pipeline_attempts owner
                WHERE owner.input_fingerprint IN (${ownerFingerprints})
                  AND owner.strategy = '${DOCUMENT_OWNER_STRATEGY.strategy}'
                  AND owner.strategy_version = ${DOCUMENT_OWNER_STRATEGY.version}
                ORDER BY owner.created_at DESC, owner.id DESC
                LIMIT 1
             ) latest
            WHERE latest.outcome = 'evidence_mismatch'
         )
         AND (SELECT COUNT(*) FROM regexp_matches(adt.normalized_text, '\\$\\s*\\.?\\d|\\d\\s*(?:¢|cents?\\M)', 'gi')) >= ${minDollars}
       ORDER BY adt.updated_at DESC, adt.id DESC
       LIMIT ${scan}
    `,
    params,
  );
}

function failureOutcome(error: unknown): AttemptOutcome {
  const status = Number((error as { status?: unknown })?.status);
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  if (Number.isFinite(status) && status > 0) return "http_other";
  return /abort|timed? ?out|timeout/i.test(error instanceof Error ? error.message : String(error)) ? "timeout" : "network_error";
}

function isStopError(error: unknown): boolean {
  return error instanceof Error && STOP_ERRORS.has(error.name);
}

/**
 * Every skip is visible: one `knox.paid_read_skipped` event on the step lists each text and its
 * reason. A page whose earlier paid read found no fee also gets a `rejected` attempt for this
 * text (cost 0), so later runs do not select it again. A same-text skip writes no attempt: the
 * copy that is read records one for the bank and text, and if that call fails for a temporary
 * reason both copies stay eligible.
 */
async function logPaidReadSkips(db: SqlTag, options: PaidStepOptions, skips: PaidReadSkip[]): Promise<void> {
  if (skips.length === 0) return;
  for (const skip of skips) {
    if (skip.reason !== "page_read_before_no_fees") continue;
    await recordAttempt(db, {
      institutionId: skip.institutionId,
      sourceDocumentId: skip.sourceDocumentId,
      stage: "extract",
      strategy: KNOX_PAID_STRATEGY.strategy,
      version: KNOX_PAID_STRATEGY.version,
      fingerprint: skip.textHash,
      outcome: "rejected",
      yieldCount: 0,
      costMicrousd: 0,
      durationMs: 0,
      runId: options.runId,
      stepId: options.stepId ?? null,
      foldIntoPlaybook: false,
      detail: { document_text_id: skip.documentTextId, skipped: skip.reason, prior_attempt_id: skip.priorAttemptId },
    });
  }
  const counts: Partial<Record<PaidReadSkipReason, number>> = {};
  for (const skip of skips) counts[skip.reason] = (counts[skip.reason] ?? 0) + 1;
  const reasons = Object.entries(counts)
    .map(([reason, count]) => `${count} because ${PAID_READ_SKIP_LABEL[reason as PaidReadSkipReason]}`)
    .join("; ");
  const message = `Knox skipped ${skips.length} paid read${skips.length === 1 ? "" : "s"} that would yield nothing, $0 spent: ${reasons}.`;
  const detail = {
    by_reason: counts,
    skips: skips.map((skip) => ({
      document_text_id: skip.documentTextId,
      source_document_id: skip.sourceDocumentId,
      institution_id: skip.institutionId,
      reason: skip.reason,
      prior_attempt_id: skip.priorAttemptId,
    })),
  };
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${options.runId}, ${options.stepId ?? null}, 'knox.paid_read_skipped', 'completed', ${message}, ${JSON.stringify(detail)}::jsonb)
  `;
}

export async function runKnoxPaidExtract(
  options: PaidStepOptions & { create?: PaidMessageCreator },
): Promise<PaidPassResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result = emptyPaidPassResult(dryRun);
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || PAID_PASS_ITEMS_PER_RUN), 1), PAID_PASS_ITEMS_PER_RUN);
  // Selection reads the attempt log; without it there is no free result to compare.
  if (!(await learningSchemaReady(db))) return result;

  const { reads: rows, skips } = planPaidReads(
    (await selectPaidTexts(db, limit, options.stateCode)).filter((row) => pricedLineCount(row.normalized_text) >= PAID_MIN_PRICED_LINES),
    limit,
  );
  result.selected = rows.length;
  const skipResults = skips.map((skip) => ({
    document_text_id: skip.documentTextId,
    skip_reason: skip.reason,
    ...(skip.priorAttemptId != null ? { prior_attempt_id: skip.priorAttemptId } : {}),
  }));
  if (dryRun) {
    result.results = [
      ...rows.map((row) => ({ document_text_id: Number(row.document_text_id), free_yield: Number(row.free_yield ?? 0) })),
      ...skipResults,
    ];
    return result;
  }
  await logPaidReadSkips(db, options, skips);
  result.results.push(...skipResults);

  const model = PAID_PASS_MODELS.extract();
  for (const row of rows) {
    const startedAt = Date.now();
    const base = {
      institutionId: Number(row.institution_id),
      sourceDocumentId: Number(row.source_document_id),
      stage: "extract" as const,
      strategy: KNOX_PAID_STRATEGY.strategy,
      version: KNOX_PAID_STRATEGY.version,
      fingerprint: row.text_hash,
      runId: options.runId,
      stepId: options.stepId ?? null,
    };
    let call: Awaited<ReturnType<typeof paidModelCall>>;
    try {
      call = await paidModelCall({
        agent: "knox",
        operation: "paid_extract",
        runId: options.runId,
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: paidExtractPrompt(row.normalized_text) }],
        },
        create: options.create,
        metadata: { document_text_id: Number(row.document_text_id), text_hash: row.text_hash },
      });
    } catch (error) {
      if (isStopError(error)) {
        // Nothing was spent and nothing was tried: no attempt row, so the text stays eligible.
        result.budgetStopped = true;
        result.budgetReason = error instanceof Error ? error.message : String(error);
        break;
      }
      const outcome = failureOutcome(error);
      result.processed += 1;
      result.failed += 1;
      result.results.push({ document_text_id: Number(row.document_text_id), outcome, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      await recordAttempt(db, {
        ...base,
        outcome,
        yieldCount: 0,
        costMicrousd: 0,
        durationMs: Date.now() - startedAt,
        detail: { document_text_id: Number(row.document_text_id), model, error: error instanceof Error ? error.message.slice(0, 200) : String(error) },
      });
      continue;
    }

    result.processed += 1;
    result.costMicrousd += call.costMicrousd;
    const parsed = paidResponseJson<{ fees?: PaidFeeRow[] } | PaidFeeRow[]>(call.message);
    const returned = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.fees) ? parsed.fees : null;
    const rejections: Partial<Record<PaidRowRejection, number>> = {};
    const accepted: AcceptedPaidFee[] = [];
    const seen = new Set<string>();
    for (const fee of returned ?? []) {
      const grounded = groundPaidRow(fee, row.normalized_text);
      if (typeof grounded === "string") {
        rejections[grounded] = (rejections[grounded] ?? 0) + 1;
        continue;
      }
      const key = `${grounded.canonicalKey}:${grounded.amount}:${grounded.feeName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      accepted.push(grounded);
    }

    const textRow: KnoxTextRow = row;
    let inserted = 0;
    if (accepted.length > 0) await retireRowsFromOlderText(db, textRow);
    for (const fee of accepted) {
      const excerpt = fee.sourceLine.slice(0, 280);
      const ok = fee.amount === 0
        ? await insertHeldCandidate(db, {
            runId: options.runId,
            row: textRow,
            held: { shape: "zero", feeName: fee.feeName, amount: 0, amountMax: null, percent: null, frequency: fee.frequency, canonicalHint: fee.canonicalKey, excerpt },
            extraFlags: [KNOX_PAID_FLAG],
          })
        : await insertCandidate(db, {
            runId: options.runId,
            row: textRow,
            candidate: {
              feeName: fee.feeName,
              amount: fee.amount,
              frequency: fee.frequency,
              canonicalHint: fee.canonicalKey,
              confidence: confidenceFor(excerpt),
              excerpt,
              waivable: /\bwaiv/i.test(`${fee.conditions ?? ""} ${fee.sourceLine}`),
              lineup: fee.lineup,
            },
            extraFlags: [KNOX_PAID_FLAG],
            method: `paid extraction (${model})`,
          });
      if (ok) inserted += 1;
    }

    const outcome: AttemptOutcome = returned == null
      ? "parse_error"
      : accepted.length > 0
        ? "ok"
        : returned.length > 0
          ? "evidence_mismatch"
          : "no_candidates";
    if (outcome === "ok") result.succeeded += 1;
    else result.failed += 1;
    const detail = {
      document_text_id: Number(row.document_text_id),
      model,
      free_yield: Number(row.free_yield ?? 0),
      returned: returned?.length ?? 0,
      accepted: accepted.length,
      inserted,
      rejected: rejections,
    };
    result.results.push({ ...detail, outcome, cost_microusd: call.costMicrousd });
    await recordAttempt(db, {
      ...base,
      outcome,
      yieldCount: accepted.length,
      costMicrousd: call.costMicrousd,
      durationMs: Date.now() - startedAt,
      detail,
    });
  }
  return result;
}
