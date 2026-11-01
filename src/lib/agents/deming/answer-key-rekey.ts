/**
 * The answer-key re-key, dry run (James, 2026-11-01): the 62 confirmed answer-key banks get new
 * candidate keys from two independent model reads of each bank's current stored document.
 *
 * Why: of the 62 confirmed keys, only 4 were eligible to score on Nov 1 (the rest were keyed on
 * Oct 5-6 against documents that have since been superseded or changed, or whose lines no longer
 * appear). James chose "Claude only, two independent reads" as the truth rule: a fee counts only when
 * both reads give the same fee type, kind and amount, and each read's quoted line is in the document.
 * Everything else goes on a visible disagreement list. He then chose "Dry run only for now": the
 * reads run, nothing is written to `answer_key_institutions` or `answer_key_fees`. The result of
 * each bank is one `answer_key_rekey.bank_done` run event; a later PR, with his yes, writes keys.
 *
 * Independence: read A and read B use different models (REKEY_READS) and differently framed
 * instructions, and neither sees the other's answer or the old key.
 *
 * Caps: a provider step (`deming-answer-key-rekey`, in PROVIDER_STEP_KEYS), held by the provider
 * stop. Its calls book as agent `answer_key_rekey` (migration 20270110000082, $15 one-off line) and
 * bill to Knox's API key. The batch also caps itself at REKEY_MAX_COST_MICROUSD in the run ledger:
 * each bank is reserved (`answer_key_rekey.bank_reserved`, with its worst-case ceiling) before its
 * first call, and a bank is charged its recorded cost once done, or its ceiling while unfinished.
 * Server only.
 */

import { sql } from "@/lib/data-store/connection";
import { anthropicPriceFor } from "@/lib/ai-provider";
import { estimateAnthropicCostMicrousd } from "@/lib/ai-provider-usage";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { paidModelCall, paidResponseJson, type PaidMessageCreator } from "../paid-pass";

type Db = typeof sql;

/** The batch James approved as a dry run on 2026-11-01. A new batch needs a new id and his yes. */
export const REKEY_BATCH_ID = "2026-11-01";
export const REKEY_SOURCE = "deming.answer_key_rekey";
export const REKEY_STEP_KEY = "deming-answer-key-rekey";
/** The budget line's agent (`agent:answer_key_rekey`). */
export const REKEY_LEDGER_AGENT = "answer_key_rekey" as const;
export const REKEY_RESERVED = "answer_key_rekey.bank_reserved";
export const REKEY_DONE = "answer_key_rekey.bank_done";
/** Estimated spend of the whole batch, at most: $15 (James's dry-run approval). */
export const REKEY_MAX_COST_MICROUSD = 15_000_000;
/** Banks read at once in one step; both reads of a bank also run at once. */
export const REKEY_BANKS_PER_STEP = 2;
/** Output tokens per read, at most. The 62 keys average 37 fees a bank. */
export const REKEY_MAX_OUTPUT_TOKENS = 16_000;
/** Instruction tokens per read beyond the document (the fee type list and rules). */
const PROMPT_OVERHEAD_TOKENS = 4_000;

export interface RekeyRead {
  id: "a" | "b";
  model: () => string;
  framing: string;
}

export const REKEY_READS: readonly RekeyRead[] = [
  {
    id: "a",
    model: () => process.env.ANSWER_KEY_REKEY_MODEL_A?.trim() || "claude-opus-5-5",
    framing: "Read the whole document from top to bottom. Each time a price or charge appears, add it.",
  },
  {
    id: "b",
    model: () => process.env.ANSWER_KEY_REKEY_MODEL_B?.trim() || "claude-sonnet-5-5",
    framing: "Work section by section and table by table. For each table row or line that names a charge, add it. Then scan the footnotes and fine print for any charge you have not added.",
  },
];

export const REKEY_FEE_KEYS: readonly string[] = Object.values(FEE_FAMILIES).flat();
const AMOUNT_KINDS = ["fixed", "free", "varies", "rate"] as const;
type AmountKind = (typeof AMOUNT_KINDS)[number];

export interface ReadFee {
  canonical_key: string;
  fee_name: string;
  amount: number | null;
  amount_kind: AmountKind;
  frequency: string | null;
  audience: "consumer" | "business" | "both" | "unknown";
  source_line: string;
  /** The quoted line appears in the document text (whitespace and case aside). */
  line_found: boolean;
}

export interface KeyFee {
  canonical_key: string;
  amount: number | null;
  amount_kind: string;
}

export interface BankReconciliation {
  agreed: Array<ReadFee & { line_b: string }>;
  onlyA: ReadFee[];
  onlyB: ReadFee[];
  /** A fee with a type outside the taxonomy, or a quoted line that is not in the document. */
  unproven: Array<ReadFee & { read: "a" | "b"; reason: "unknown_fee_type" | "line_not_in_document" }>;
  /** Against the old (Oct 5-6) key: rows the agreed list matches, and rows on one side only. */
  oldKey: { matched: number; oldOnly: KeyFee[]; newOnly: number };
}

/** Lower-case, with every run of whitespace one space and typographic quotes and dashes plain. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function money(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** One read's fees, cleaned; `text` is the document's normalized text, for the line check. */
export function parseReadFees(raw: unknown, text: string): ReadFee[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { fees?: unknown })?.fees) ? (raw as { fees: unknown[] }).fees : [];
  const haystack = normalizeForMatch(text);
  const out: ReadFee[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = String(row.canonical_key ?? "").trim();
    const line = String(row.source_line ?? "").trim();
    if (!key || !line) continue;
    const kind = AMOUNT_KINDS.includes(row.amount_kind as AmountKind) ? (row.amount_kind as AmountKind) : "varies";
    const audience = ["consumer", "business", "both"].includes(String(row.audience)) ? (row.audience as ReadFee["audience"]) : "unknown";
    const needle = normalizeForMatch(line);
    out.push({
      canonical_key: key,
      fee_name: String(row.fee_name ?? "").slice(0, 200),
      amount: kind === "free" ? 0 : money(row.amount),
      amount_kind: kind,
      frequency: row.frequency == null ? null : String(row.frequency).slice(0, 60),
      audience,
      source_line: line.slice(0, 500),
      line_found: needle.length > 0 && haystack.includes(needle),
    });
  }
  return out;
}

/** The fee's identity for agreement: type, kind and amount to the cent. */
export function feeMatchKey(fee: { canonical_key: string; amount: number | null; amount_kind: string }): string {
  const amount = fee.amount == null ? "" : fee.amount.toFixed(2);
  return `${fee.canonical_key}|${fee.amount_kind}|${amount}`;
}

/**
 * Two reads into agreed, one-read-only and unproven fees (deterministic; no model call). A fee is
 * agreed only when both reads give it, both quoted lines are in the document and its type is in
 * the taxonomy. Repeats are matched as a multiset: two $5 fees of one type in one read match at
 * most two in the other.
 */
export function reconcileReads(a: ReadFee[], b: ReadFee[], oldKey: KeyFee[], keys: readonly string[] = REKEY_FEE_KEYS): BankReconciliation {
  const known = new Set(keys);
  const unproven: BankReconciliation["unproven"] = [];
  const usable = (fees: ReadFee[], read: "a" | "b") => fees.filter((fee) => {
    if (!known.has(fee.canonical_key)) { unproven.push({ ...fee, read, reason: "unknown_fee_type" }); return false; }
    if (!fee.line_found) { unproven.push({ ...fee, read, reason: "line_not_in_document" }); return false; }
    return true;
  });
  const left = usable(a, "a");
  const right = usable(b, "b");
  const pool = new Map<string, ReadFee[]>();
  for (const fee of right) {
    const key = feeMatchKey(fee);
    pool.set(key, [...(pool.get(key) ?? []), fee]);
  }
  const agreed: BankReconciliation["agreed"] = [];
  const onlyA: ReadFee[] = [];
  for (const fee of left) {
    const match = pool.get(feeMatchKey(fee))?.shift();
    if (match) agreed.push({ ...fee, line_b: match.source_line });
    else onlyA.push(fee);
  }
  const onlyB = [...pool.values()].flat();

  const agreedPool = new Map<string, number>();
  for (const fee of agreed) agreedPool.set(feeMatchKey(fee), (agreedPool.get(feeMatchKey(fee)) ?? 0) + 1);
  let matched = 0;
  const oldOnly: KeyFee[] = [];
  for (const fee of oldKey) {
    const key = feeMatchKey({ ...fee, amount: fee.amount_kind === "free" ? 0 : money(fee.amount) });
    const left = agreedPool.get(key) ?? 0;
    if (left > 0) { matched += 1; agreedPool.set(key, left - 1); }
    else oldOnly.push(fee);
  }
  return { agreed, onlyA, onlyB, unproven, oldKey: { matched, oldOnly, newOnly: agreed.length - matched } };
}

export function rekeyPrompt(read: RekeyRead, documentText: string): string {
  return [
    "You are listing every fee in one bank or credit union fee schedule, exactly as the document states it.",
    read.framing,
    "",
    "Rules:",
    "- List every charge the document states, for consumer and business accounts alike; mark each one's audience.",
    "- canonical_key must be one of the fee types below. A charge that fits none of them: use \"other\".",
    "- amount_kind: \"fixed\" for one stated dollar amount, \"free\" for a stated $0 or no charge, \"rate\" for a percentage, \"varies\" for anything else (a range, a tier table, \"varies\").",
    "- amount: the dollar amount as a number for fixed, 0 for free, the percentage number for rate, null for varies. Never compute or infer an amount.",
    "- One entry per stated price: a fee with two prices (two account types, two tiers) is two entries.",
    "- source_line: copy the document's own words for that price exactly, character for character, a single line or table row, at most 300 characters. Do not paraphrase or join lines.",
    "- Do not add fees the document does not state. Do not skip fees because they look minor.",
    "",
    `Fee types: ${REKEY_FEE_KEYS.join(", ")}`,
    "",
    "Answer with JSON only: {\"fees\": [{\"canonical_key\": \"...\", \"fee_name\": \"...\", \"amount\": 0, \"amount_kind\": \"fixed\", \"frequency\": \"per item\", \"audience\": \"consumer\", \"source_line\": \"...\"}]}",
    "",
    "<document>",
    documentText,
    "</document>",
  ].join("\n");
}

/** The worst case of one bank's two reads: the whole document in, every output token used, no cache. */
export function bankCeilingMicrousd(charCount: number, reads: readonly RekeyRead[] = REKEY_READS): number {
  const inputTokens = Math.ceil(charCount / 3) + PROMPT_OVERHEAD_TOKENS;
  // A model with no list price is priced at the dearest list price ($10 in, $50 out), never at $0.
  return reads.reduce((sum, read) => sum + (estimateAnthropicCostMicrousd(read.model(), {
    inputTokens, outputTokens: REKEY_MAX_OUTPUT_TOKENS, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0,
  }) ?? inputTokens * 10 + REKEY_MAX_OUTPUT_TOKENS * 50), 0);
}

export interface RekeyBank {
  institution_id: number;
  answer_key_institution_id: number;
  text_id: number;
  source_document_id: number | null;
  source_url: string | null;
  char_count: number;
}

/**
 * Confirmed keys whose bank has a stored current text and no finished re-key in this batch. A bank
 * whose step was stopped (budget cap, provider stop) is read again; a read or a failed read is not,
 * and neither is a bank whose step was killed twice mid-read.
 */
export async function selectRekeyBanks(db: Db, limit: number): Promise<RekeyBank[]> {
  const rows = await db`
    SELECT k.institution_id, k.id AS answer_key_institution_id, t.id AS text_id, t.source_document_id,
           t.source_url, GREATEST(COALESCE(t.char_count, 0), length(t.normalized_text))::int AS char_count
      FROM answer_key_institutions k
      JOIN institution_source_profiles p ON p.institution_id = k.institution_id
      JOIN agent_source_texts t ON t.id = p.last_successful_text_id AND t.status = 'completed'
     WHERE k.status = 'confirmed'
       AND NOT EXISTS (
         SELECT 1 FROM agent_run_events e
          WHERE e.event_type = ${REKEY_DONE}
            AND e.detail->>'batchId' = ${REKEY_BATCH_ID}
            AND e.detail->>'institutionId' = k.institution_id::text
            AND e.detail->>'state' <> 'stopped')
       -- A bank reserved twice with no result (a step killed mid-read) is not tried a third time.
       AND (SELECT COUNT(*) FROM agent_run_events r
             WHERE r.event_type = ${REKEY_RESERVED}
               AND r.detail->>'batchId' = ${REKEY_BATCH_ID}
               AND r.detail->>'institutionId' = k.institution_id::text
               AND NOT EXISTS (SELECT 1 FROM agent_run_events d
                                WHERE d.event_type = ${REKEY_DONE} AND d.detail->>'reservationId' = r.id::text)) < 2
     ORDER BY k.institution_id
     LIMIT ${limit}
  `;
  return rows.map((row) => ({
    institution_id: Number(row.institution_id),
    answer_key_institution_id: Number(row.answer_key_institution_id),
    text_id: Number(row.text_id),
    source_document_id: row.source_document_id == null ? null : Number(row.source_document_id),
    source_url: row.source_url == null ? null : String(row.source_url),
    char_count: Number(row.char_count),
  }));
}

/** Banks of the batch still to read. */
export async function rekeyBanksLeft(db: Db): Promise<number> {
  return (await selectRekeyBanks(db, 1000)).length;
}

/**
 * The batch's charge against its cap: each reserved bank at its recorded cost once done with every
 * call's cost known, else at its ceiling (running, killed, or a call whose cost is unknown).
 */
export async function rekeyBatchCharge(db: Db): Promise<number> {
  const [row] = await db`
    SELECT COALESCE(SUM(CASE
             WHEN d.detail->>'costKnown' = 'true' THEN (d.detail->>'costMicrousd')::bigint
             ELSE (r.detail->>'ceilingMicrousd')::bigint END), 0)::bigint AS charge
      FROM agent_run_events r
      LEFT JOIN LATERAL (
        SELECT detail FROM agent_run_events d
         WHERE d.event_type = ${REKEY_DONE} AND d.detail->>'reservationId' = r.id::text
         ORDER BY d.id DESC LIMIT 1) d ON TRUE
     WHERE r.event_type = ${REKEY_RESERVED} AND r.detail->>'batchId' = ${REKEY_BATCH_ID}
  `;
  return Number(row?.charge ?? 0);
}

async function writeEvent(db: Db, runId: number, stepId: number | null, eventType: string, message: string, detail: Record<string, unknown>): Promise<number> {
  const [row] = await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${runId}, ${stepId}, ${eventType}, 'completed', ${message}, ${JSON.stringify(detail)}::jsonb)
    RETURNING id
  `;
  return Number(row.id);
}

const STOP_ERRORS = new Set(["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"]);
const isStop = (error: unknown) => error instanceof Error && STOP_ERRORS.has(error.name);

export interface RekeyResult {
  batchId: string;
  dryRun: boolean;
  selected: number;
  read: number;
  failed: number;
  stopped: string | null;
  agreed: number;
  disagreed: number;
  chargedMicrousd: number;
  capMicrousd: number;
  banksLeft: number;
  banks: Array<{ institutionId: number; agreed: number; onlyA: number; onlyB: number; unproven: number; oldMatched: number; oldOnly: number; error?: string }>;
}

export async function runAnswerKeyRekey(options: {
  runId: number;
  stepId?: number | null;
  dryRun?: boolean;
  db?: Db;
  create?: PaidMessageCreator;
  limit?: number;
}): Promise<RekeyResult> {
  const db = options.db ?? sql;
  const banks = await selectRekeyBanks(db, Math.min(options.limit ?? REKEY_BANKS_PER_STEP, REKEY_BANKS_PER_STEP));
  const result: RekeyResult = {
    batchId: REKEY_BATCH_ID, dryRun: Boolean(options.dryRun), selected: banks.length, read: 0, failed: 0, stopped: null,
    agreed: 0, disagreed: 0, chargedMicrousd: 0, capMicrousd: REKEY_MAX_COST_MICROUSD, banksLeft: 0, banks: [],
  };
  if (options.dryRun || banks.length === 0) {
    result.chargedMicrousd = await rekeyBatchCharge(db);
    result.banksLeft = await rekeyBanksLeft(db);
    return result;
  }

  // Reserve every bank this step reads before any call, so the cap holds for the whole step.
  let charge = await rekeyBatchCharge(db);
  const reserved: Array<{ bank: RekeyBank; reservationId: number }> = [];
  for (const bank of banks) {
    const ceiling = bankCeilingMicrousd(bank.char_count);
    if (charge + ceiling > REKEY_MAX_COST_MICROUSD) {
      result.stopped = `Batch cap: $${(charge / 1e6).toFixed(2)} charged of $${(REKEY_MAX_COST_MICROUSD / 1e6).toFixed(2)}; the next bank's ceiling is $${(ceiling / 1e6).toFixed(2)}.`;
      break;
    }
    charge += ceiling;
    const reservationId = await writeEvent(db, options.runId, options.stepId ?? null, REKEY_RESERVED,
      `Reserved the re-key of institution ${bank.institution_id}`,
      { batchId: REKEY_BATCH_ID, institutionId: bank.institution_id, textId: bank.text_id, ceilingMicrousd: ceiling });
    reserved.push({ bank, reservationId });
  }

  await Promise.all(reserved.map(async ({ bank, reservationId }) => {
    const [textRow] = await db`SELECT normalized_text FROM agent_source_texts WHERE id = ${bank.text_id}`;
    const text = String(textRow?.normalized_text ?? "");
    const oldKey = (await db`
      SELECT canonical_key, amount, amount_kind FROM answer_key_fees
       WHERE answer_key_institution_id = ${bank.answer_key_institution_id}
    `).map((row) => ({ canonical_key: String(row.canonical_key), amount: row.amount == null ? null : Number(row.amount), amount_kind: String(row.amount_kind) }));
    let cost = 0;
    let costKnown = true;
    const outcome = await Promise.allSettled(REKEY_READS.map(async (read) => {
      const call = await paidModelCall({
        agent: REKEY_LEDGER_AGENT,
        keyAgent: "knox",
        operation: `answer_key_rekey_${read.id}`,
        runId: options.runId,
        create: options.create,
        metadata: { batch_id: REKEY_BATCH_ID, institution_id: bank.institution_id, read: read.id },
        params: {
          model: read.model(),
          max_tokens: REKEY_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: rekeyPrompt(read, text) }],
        },
      });
      cost += call.costMicrousd;
      // A model with no list price books $0, which would let both caps fail open: charge the ceiling.
      if (anthropicPriceFor(read.model()) == null) costKnown = false;
      // A cut-off or unparseable reply is a failed read, never a read with no fees (review of 968ef11).
      if (call.message.stop_reason === "max_tokens") throw new Error(`Read ${read.id} was cut off at ${REKEY_MAX_OUTPUT_TOKENS} output tokens`);
      const json = paidResponseJson(call.message);
      if (json == null) throw new Error(`Read ${read.id} did not answer with JSON`);
      return parseReadFees(json, text);
    }));
    const failure = outcome.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
    if (failure) {
      // A failed call's usage is unknown, so the bank stays charged at its ceiling.
      costKnown = false;
      const message = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
      if (outcome.every((entry) => entry.status === "fulfilled" || isStop(entry.reason))) {
        // A cap or the provider stop refuses a call before it is sent, so nothing was spent on it:
        // the bank is charged only its completed read, and a later step reads it again.
        result.stopped = message.slice(0, 300);
        await writeEvent(db, options.runId, options.stepId ?? null, REKEY_DONE, `Re-key of institution ${bank.institution_id} stopped`, {
          batchId: REKEY_BATCH_ID, reservationId: String(reservationId), institutionId: bank.institution_id, state: "stopped",
          error: message.slice(0, 500), costMicrousd: cost, costKnown: true,
        });
        return;
      }
      result.failed += 1;
      result.banks.push({ institutionId: bank.institution_id, agreed: 0, onlyA: 0, onlyB: 0, unproven: 0, oldMatched: 0, oldOnly: 0, error: message.slice(0, 300) });
      await writeEvent(db, options.runId, options.stepId ?? null, REKEY_DONE, `Re-key of institution ${bank.institution_id} failed`, {
        batchId: REKEY_BATCH_ID, reservationId: String(reservationId), institutionId: bank.institution_id, state: "read_failed",
        error: message.slice(0, 500), costMicrousd: cost, costKnown,
      });
      return;
    }
    const [a, b] = outcome.map((entry) => (entry as PromiseFulfilledResult<ReadFee[]>).value);
    const reconciled = reconcileReads(a, b, oldKey);
    result.read += 1;
    result.agreed += reconciled.agreed.length;
    result.disagreed += reconciled.onlyA.length + reconciled.onlyB.length;
    result.banks.push({
      institutionId: bank.institution_id, agreed: reconciled.agreed.length, onlyA: reconciled.onlyA.length,
      onlyB: reconciled.onlyB.length, unproven: reconciled.unproven.length, oldMatched: reconciled.oldKey.matched, oldOnly: reconciled.oldKey.oldOnly.length,
    });
    await writeEvent(db, options.runId, options.stepId ?? null, REKEY_DONE,
      `Re-keyed institution ${bank.institution_id}: ${reconciled.agreed.length} fees agreed, ${reconciled.onlyA.length + reconciled.onlyB.length} on one read only`, {
        batchId: REKEY_BATCH_ID, reservationId: String(reservationId), institutionId: bank.institution_id, state: "read",
        textId: bank.text_id, sourceDocumentId: bank.source_document_id, sourceUrl: bank.source_url,
        models: Object.fromEntries(REKEY_READS.map((read) => [read.id, read.model()])),
        readCounts: { a: a.length, b: b.length },
        costMicrousd: cost, costKnown,
        ...reconciled,
      });
  }));

  result.chargedMicrousd = await rekeyBatchCharge(db);
  result.banksLeft = await rekeyBanksLeft(db);
  return result;
}

export function rekeySummaryLine(result: RekeyResult): string {
  if (result.dryRun) return `Answer-key re-key (dry run of the step): ${result.selected} banks would be read; ${result.banksLeft} left in batch ${result.batchId}.`;
  const usd = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;
  return `Answer-key re-key batch ${result.batchId}: read ${result.read} banks (${result.agreed} fees agreed by both reads, ${result.disagreed} on one read only), ${result.failed} failed; ${usd(result.chargedMicrousd)} of ${usd(result.capMicrousd)} charged; ${result.banksLeft} banks left${result.stopped ? `. Stopped: ${result.stopped}` : ""}.`;
}
