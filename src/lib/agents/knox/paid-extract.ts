import { sql } from "@/lib/data-store/connection";
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
  KNOX_EXTRACT_STRATEGY,
  KNOX_REEXTRACT_MAX_FEES,
  retireRowsFromOlderText,
  type KnoxTextRow,
} from "@/lib/agents/knox/extract";
import { amountsIn, confidenceFor, detectFrequency, MAX_REASONABLE_FEE_AMOUNT } from "@/lib/agents/knox/rules";
import { CANONICAL_KEY_MAP, DISPLAY_NAMES, FEE_FAMILIES } from "@/lib/fee-taxonomy";

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
 */

export const KNOX_PAID_STRATEGY = { strategy: "extract.paid", version: 1 } as const;
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
}

/** One row as the model returns it. */
export interface PaidFeeRow {
  fee_name?: unknown;
  canonical_key?: unknown;
  amount?: unknown;
  frequency?: unknown;
  conditions?: unknown;
  source_line?: unknown;
}

export interface AcceptedPaidFee {
  feeName: string;
  canonicalKey: string;
  amount: number;
  frequency: string | null;
  conditions: string | null;
  sourceLine: string;
}

export type PaidRowRejection = "missing_fields" | "unknown_canonical" | "invalid_amount" | "not_in_text";

/** Lines with a dollar amount; a flattened line counts once per amount. */
export function pricedLineCount(text: string): number {
  let total = 0;
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    const amounts = amountsIn(line).length;
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
export function groundPaidRow(row: PaidFeeRow, text: string): AcceptedPaidFee | PaidRowRejection {
  const feeName = typeof row.fee_name === "string" ? row.fee_name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const canonicalKey = typeof row.canonical_key === "string" ? row.canonical_key.trim() : "";
  const sourceLine = typeof row.source_line === "string" ? row.source_line.replace(/\s+/g, " ").trim() : "";
  const amount = typeof row.amount === "number" ? row.amount : Number(String(row.amount ?? "").replace(/[$,\s]/g, ""));
  if (!feeName || !canonicalKey || row.amount == null || row.amount === "") return "missing_fields";
  const mapped = CANONICAL_KEY_MAP[canonicalKey] ?? (VALID_CANONICAL_KEYS.has(canonicalKey) ? canonicalKey : null);
  if (!mapped) return "unknown_canonical";
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_REASONABLE_FEE_AMOUNT) return "invalid_amount";
  const rounded = Math.round(amount * 100) / 100;

  const haystack = comparable(text);
  const lineGrounded = sourceLine.length >= 4 && haystack.includes(comparable(sourceLine)) && lineHasAmount(sourceLine, rounded);
  const nameGrounded = haystack.includes(comparable(feeName)) && (rounded === 0 ? lineHasAmount(text, 0) : lineHasAmount(text, rounded));
  if (!lineGrounded && !nameGrounded) return "not_in_text";
  const frequency = typeof row.frequency === "string" && row.frequency.trim() ? row.frequency.trim().toLowerCase() : null;
  return {
    feeName,
    canonicalKey: mapped,
    amount: rounded,
    frequency: frequency && /^(monthly|annual|per_item|per_transaction|daily|one_time)$/.test(frequency) ? frequency : detectFrequency(sourceLine),
    conditions: typeof row.conditions === "string" && row.conditions.trim() ? row.conditions.trim().slice(0, 240) : null,
    sourceLine: sourceLine || feeName,
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
    "Return only JSON: {\"fees\": [{\"fee_name\", \"canonical_key\", \"amount\", \"frequency\", \"conditions\", \"source_line\"}]}.",
    "- fee_name: the fee's name as written.",
    "- canonical_key: one key from the list below; skip fees that fit none.",
    "- amount: the dollar price as a number (0 for a fee stated as free). Skip percentages, ranges, balance requirements, interest rates, limits and caps.",
    "- frequency: monthly, annual, per_item, per_transaction, daily, one_time or null.",
    "- conditions: waivers, caps or tiers stated with the fee, or null.",
    "- source_line: the exact text from the document that states the fee and its amount, copied verbatim.",
    "Do not guess. Use only what the text says.",
    "",
    "Canonical keys:",
    canonicalFeeList(),
    "",
    "Document text:",
    text.slice(0, MAX_TEXT_CHARS),
  ].join("\n");
}

async function selectPaidTexts(db: SqlTag, limit: number, stateCode?: string): Promise<PaidTextRow[]> {
  const params: Array<string | number> = [];
  const strategy = `$${params.push(KNOX_EXTRACT_STRATEGY.strategy)}`;
  const version = `$${params.push(KNOX_EXTRACT_STRATEGY.version)}`;
  const maxFees = `$${params.push(KNOX_REEXTRACT_MAX_FEES)}`;
  const paidStrategy = `$${params.push(KNOX_PAID_STRATEGY.strategy)}`;
  const minDollars = `$${params.push(PAID_MIN_PRICED_LINES)}`;
  // Scan a few more than needed: the priced-line count is checked in code.
  const scan = `$${params.push(limit * 4)}`;
  const normalizedState = normalizeStateCode(stateCode);
  const stateFilter = normalizedState ? `AND upper(btrim(inst.state_code)) = $${params.push(normalizedState)}` : "";
  return db.unsafe<PaidTextRow[]>(
    `
      SELECT adt.id AS document_text_id,
             adt.source_document_id,
             adt.institution_id,
             adt.source_url,
             adt.normalized_text,
             adt.text_hash,
             free.yield_count AS free_yield
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id
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
         AND (SELECT COUNT(*) FROM regexp_matches(adt.normalized_text, '\\$\\s*\\d', 'g')) >= ${minDollars}
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

export async function runKnoxPaidExtract(
  options: PaidStepOptions & { create?: PaidMessageCreator },
): Promise<PaidPassResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result = emptyPaidPassResult(dryRun);
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || PAID_PASS_ITEMS_PER_RUN), 1), PAID_PASS_ITEMS_PER_RUN);
  // Selection reads the attempt log; without it there is no free result to compare.
  if (!(await learningSchemaReady(db))) return result;

  const rows = (await selectPaidTexts(db, limit, options.stateCode))
    .filter((row) => pricedLineCount(row.normalized_text) >= PAID_MIN_PRICED_LINES)
    .slice(0, limit);
  result.selected = rows.length;
  if (dryRun) {
    result.results = rows.map((row) => ({ document_text_id: Number(row.document_text_id), free_yield: Number(row.free_yield ?? 0) }));
    return result;
  }

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
