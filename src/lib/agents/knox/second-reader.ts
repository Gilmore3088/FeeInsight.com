import { sql } from "@/lib/data-store/connection";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { estimateAnthropicCostMicrousd } from "@/lib/ai-provider-usage";
import type { Anthropic } from "@/lib/ai-provider";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { PAID_PASS_MODELS, paidModelCall, paidResponseJson, type PaidMessageCreator } from "@/lib/agents/paid-pass";
import { confidenceFor } from "@/lib/agents/knox/rules";
import { insertCandidate, type KnoxTextRow } from "@/lib/agents/knox/extract";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { groundPaidRow, paidExtractInstructions, paidExtractPrompt, type AcceptedPaidFee, type PaidFeeRow, type PaidRowRejection } from "@/lib/agents/knox/paid-extract";
import { summarizePaidFindMisses, type FreeTeamRead, type PaidFindMiss, type PaidFindMissKind, type PaidFindMissSummary } from "@/lib/agents/knox/paid-find-misses";
import { loadNeverReadLessonDrafts, neverReadLessonsMessage, type NeverReadLessonDraft } from "@/lib/agents/knox/never-read-lessons";

type SqlTag = typeof sql;

/**
 * Knox's blind second reader (James, 2026-11-07: "Yeah let's build it into the pipeline").
 *
 * A model reads a bank's stored current text (`agent_source_texts`) without seeing anything Knox
 * read from it, and lists every fee with its exact source line. Knox is the deterministic rules
 * extractor (no model), so the model reader is independent of it by construction; the request
 * carries only the paid pass's fixed instructions and fee list (`paidExtractInstructions`) and the
 * text (`paidExtractPrompt`): no Knox row, no role or category lesson (lessons are Knox's own view
 * of a page, so they would make the read less blind), no answer key.
 *
 * Each returned row is grounded as the paid pass grounds it (`groundPaidRow`), then traced: its
 * quoted source line must be in the text and `checkFeeAgainstSource` must find the amount stated as
 * that fee (`traceSecondReadFind`). A find that does not trace is dropped and counted, never flagged.
 * Each traced find is then filed against today's free Knox team on the same text (`runFreeSpecialists`,
 * deterministic, no call) with the paid pass's classifier (`summarizePaidFindMisses`): read, read
 * under another category, held, or missed. A missed find is a never-read: the second reader found
 * a fee Knox does not read at all.
 *
 * Nothing goes live on the second reader's word. Each never-read is recorded:
 * - as one `never_read` row in `pipeline_feedback` (signal `missed`, check `knox.second_reader`, about
 *   Knox's free extract strategy), which `never-read-lessons.ts` reads back into Knox lesson drafts
 *   grouped by the line's shape and the text's layout. A builder turns a draft into a
 *   `role-lessons.ts` entry in the PR that fixes the rule; nothing edits source at runtime.
 * - in the step's `knox.second_reader` event and the text's attempt detail.
 * - and, only for a batch whose `writeCandidates` is true, as a raw candidate (`insertCandidate`,
 *   `needs_darwin_verification`, flags `knox_second_reader` and `knox_never_read`) that Darwin verifies
 *   against the document like any other read. The Nov 7 cohort batch writes none.
 *
 * Gates: `KNOX_SECOND_READER_LIVE` (off by default). Off, the step makes no call and the tick queues
 * no run. The step (`knox-second-reader`) is in PROVIDER_STEP_KEYS, so the global provider stop and
 * the tick's provider budget hold it, and every call goes through `paidModelCall` under Knox's budget
 * line (`agent:knox`). A run reads only its batch's institutions (`SECOND_READER_BATCHES`); the batch
 * also caps itself: before each call the batch's logged spend plus that text's worst case must stay
 * under `capMicrousd`. A new batch needs a new id and James's yes on its dollar amount.
 */

export const KNOX_SECOND_READER_SWITCH = "KNOX_SECOND_READER_LIVE";
export const SECOND_READER_STEP_KEY = "knox-second-reader";
export const SECOND_READER_SOURCE = "knox.second_reader";
export const SECOND_READER_OPERATION = "knox_second_read";
export const SECOND_READER_CHECK = "knox.second_reader";
export const NEVER_READ_KIND = "never_read" as const;
export const SECOND_READER_FLAG = "knox_second_reader";
export const NEVER_READ_FLAG = "knox_never_read";
export const KNOX_SECOND_READER_STRATEGY = { strategy: "extract.second_reader", version: 1 } as const;
export const SECOND_READER_EVENT = "knox.second_reader";
/** Output tokens per read, at most; the paid pass's own cap (19 of 4,110 paid reads reached it, Oct 5 - Nov 7). */
export const SECOND_READER_MAX_OUTPUT_TOKENS = 8_000;
/** Texts read per step, one after another (the cohort's 15 texts take three runs). */
export const SECOND_READER_TEXTS_PER_STEP = 5;
/** Outcomes a later run may retry: nothing about the text caused them. */
const TRANSIENT_OUTCOMES = ["timeout", "network_error", "http_429", "http_5xx", "budget_blocked"] as const;
const STOP_ERRORS = new Set(["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"]);

/** The switch reads on for "1" or "true", allowing for stray spaces, quotes and capitals. */
export function secondReaderLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[KNOX_SECOND_READER_SWITCH];
  if (raw == null) return false;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "1" || value === "true";
}

/** The model the second reader uses: its own override, else the paid extract model. */
export function secondReaderModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIPELINE_SECOND_READ_MODEL?.trim() || PAID_PASS_MODELS.extract();
}

export interface SecondReaderBatch {
  id: string;
  /** The only institutions a run of this batch reads. */
  institutionIds: readonly number[];
  /** The batch's spend, at most, across all its runs (logged provider cost, microdollars). */
  capMicrousd: number;
  /** True writes each never-read as a raw candidate for Darwin; false records flags and lessons only. */
  writeCandidates: boolean;
  note: string;
}

/**
 * The batches a run may read. Nov 7 cohort: James's 8 banks, whose 45 never-read answer-key fees are
 * in `answer_key_score_runs` id 117 (`by_bank[].knox_missed`: 395 17, 2267 3, 4888 6, 5410 3,
 * 6109 8, 7229 6, 7815 2; 7723 none). Its cap is the worst case of its 15 current texts (every
 * output token used, 3 characters a token, no cache), rounded up (finding 2026-11-07-blind-second-reader.md).
 */
export const SECOND_READER_BATCHES: Readonly<Record<string, SecondReaderBatch>> = {
  "2026-11-07-cohort8": {
    id: "2026-11-07-cohort8",
    institutionIds: [395, 2267, 4888, 5410, 6109, 7229, 7723, 7815],
    capMicrousd: 1_500_000,
    writeCandidates: false,
    note: "Dry run on James's 8-bank cohort: never-read flags and lesson rows only, no fee rows.",
  },
};
/** The batch the tick queues while the switch is on. */
export const SECOND_READER_ACTIVE_BATCH = "2026-11-07-cohort8";

/**
 * The whole request one blind read sends. Pure. Only the fixed instructions and the text: no Knox
 * row, lesson or key ever enters it.
 */
export function secondReaderRequest(model: string, text: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: SECOND_READER_MAX_OUTPUT_TOKENS,
    system: [{ type: "text", text: paidExtractInstructions(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: paidExtractPrompt(text) }],
  };
}

/** The characters one read sends: the instructions plus the (cut) document prompt. */
export function secondReaderRequestChars(text: string): number {
  return paidExtractInstructions().length + paidExtractPrompt(text).length;
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

function statedAsFee(text: string, name: string, amount: number): boolean {
  const result = checkFeeAgainstSource(text, name, amount, ".");
  return result.ok || result.reason === "tiered_fee";
}

/**
 * A grounded find traces when its quoted source line is in the text itself (the paid pass also
 * accepts a name found elsewhere; the second reader does not) and the shared source check finds its
 * amount stated as that fee, by the model's name or by the line's own words. Pure.
 */
export function traceSecondReadFind(text: string, fee: Pick<AcceptedPaidFee, "feeName" | "amount" | "sourceLine">): boolean {
  const line = comparable(fee.sourceLine);
  if (line.length < 4 || !comparable(text).includes(line)) return false;
  return statedAsFee(text, fee.feeName, fee.amount) || statedAsFee(text, fee.sourceLine.replace(/\$?\s*\d[\d,]*(?:\.\d+)?/g, " "), fee.amount);
}

export type SecondReadRejection = PaidRowRejection | "untraced";

/** The model's rows, grounded, traced and deduplicated; every dropped row counted by reason. Pure. */
export function traceSecondRead(rows: readonly PaidFeeRow[], text: string): { finds: AcceptedPaidFee[]; rejected: Partial<Record<SecondReadRejection, number>> } {
  const finds: AcceptedPaidFee[] = [];
  const rejected: Partial<Record<SecondReadRejection, number>> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const grounded = groundPaidRow(row, text);
    if (typeof grounded === "string") {
      rejected[grounded] = (rejected[grounded] ?? 0) + 1;
      continue;
    }
    if (!traceSecondReadFind(text, grounded)) {
      rejected.untraced = (rejected.untraced ?? 0) + 1;
      continue;
    }
    const key = `${grounded.canonicalKey}:${grounded.amount}:${grounded.feeName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    finds.push(grounded);
  }
  return { finds, rejected };
}

export interface NeverReadFind {
  feeName: string;
  canonicalKey: string;
  amount: number;
  frequency: string | null;
  sourceLine: string;
  lineShape: string;
}

export interface SecondReadDiff {
  summary: PaidFindMissSummary;
  misses: PaidFindMiss[];
  neverRead: NeverReadFind[];
}

/** The traced finds diffed with Knox's free read of the same text: a `free_missed` find is a never-read. Pure. */
export function diffSecondRead(input: {
  text: string;
  sourceUrl: string | null;
  platform: string | null;
  finds: readonly AcceptedPaidFee[];
  free: FreeTeamRead;
}): SecondReadDiff {
  const { summary, misses } = summarizePaidFindMisses(input);
  const neverRead = input.finds.flatMap((fee, index) =>
    misses[index].kind === "free_missed"
      ? [{ feeName: fee.feeName, canonicalKey: fee.canonicalKey, amount: fee.amount, frequency: fee.frequency, sourceLine: fee.sourceLine, lineShape: misses[index].lineShape }]
      : [],
  );
  return { summary, misses, neverRead };
}

function feedbackNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
}

/**
 * The lesson pathway's record: one `never_read` row per never-read find, about Knox's free extract
 * (the reader that missed it), keyed on the text, category, price in cents and name, so a later
 * batch that finds the same miss on the same text re-judges the same row. Pure.
 */
export function neverReadFeedback(input: {
  runId: number;
  batchId: string;
  model: string;
  institutionId: number;
  sourceDocumentId: number;
  documentTextId: number;
  textHash: string;
  sourceUrl: string | null;
  summary: PaidFindMissSummary;
  neverRead: readonly NeverReadFind[];
}): FeedbackRow[] {
  return input.neverRead.map((find) => ({
    aboutStage: "extract",
    aboutStrategy: KNOX_RULES_STRATEGY.strategy,
    aboutVersion: KNOX_RULES_STRATEGY.version,
    signal: "missed",
    kind: NEVER_READ_KIND,
    reportedBy: "knox",
    checkName: SECOND_READER_CHECK,
    institutionId: input.institutionId,
    sourceDocumentId: input.sourceDocumentId,
    sourceUrl: input.sourceUrl,
    canonicalFeeKey: find.canonicalKey,
    amount: find.amount,
    evidence: {
      batch_id: input.batchId,
      model: input.model,
      document_text_id: input.documentTextId,
      text_hash: input.textHash,
      fee_name: find.feeName,
      source_line: find.sourceLine.slice(0, 400),
      line_shape: find.lineShape,
      layout: input.summary.layout,
      host: input.summary.host,
      platform: input.summary.platform,
      traced_by: "checkFeeAgainstSource",
    },
    runId: input.runId,
    dedupeKey: `${SECOND_READER_CHECK}:text:${input.documentTextId}:${input.textHash.slice(0, 16)}:${find.canonicalKey}:${Math.round(find.amount * 100)}:${feedbackNameKey(find.feeName)}`,
  }));
}

/** Observed paid extract reads (`paid_extract`, 4,110 calls Oct 5 - Nov 7): input tokens = 2,269 + 0.3254 per character sent. */
export const OBSERVED_INPUT_TOKENS_PER_CHAR = 0.3254;
/** Observed output tokens per paid extract read on the same calls: mean 1,106, p95 2,756, cap 8,000. */
export const OBSERVED_OUTPUT_TOKENS = { mean: 1_106, p95: 2_756 } as const;

export interface SecondReaderCostEstimate {
  model: string;
  texts: number;
  documentChars: number;
  inputTokens: number;
  outputTokens: number;
  microusd: number | null;
}

/**
 * The cost of one read of each text, at `tokensPerChar` input tokens per character sent (document
 * and instructions) and `outputTokensPerText` output tokens a read, billed in full (no cache). Pure.
 */
export function estimateSecondReaderCost(
  texts: ReadonlyArray<{ chars: number }>,
  model: string,
  scenario: { tokensPerChar: number; outputTokensPerText: number },
): SecondReaderCostEstimate {
  const instructions = paidExtractInstructions().length + "Document text:\n".length;
  const documentChars = texts.reduce((sum, text) => sum + Math.min(text.chars, 60_000), 0);
  const inputTokens = Math.ceil((documentChars + instructions * texts.length) * scenario.tokensPerChar);
  const outputTokens = scenario.outputTokensPerText * texts.length;
  const microusd = estimateAnthropicCostMicrousd(model, { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0 });
  return { model, texts: texts.length, documentChars, inputTokens, outputTokens, microusd };
}

/** One text's worst case: every output token used, 3 characters a token, no cache. */
export function textCeilingMicrousd(text: string, model: string): number {
  const inputTokens = Math.ceil(secondReaderRequestChars(text) / 3);
  return (
    estimateAnthropicCostMicrousd(model, { inputTokens, outputTokens: SECOND_READER_MAX_OUTPUT_TOKENS, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0 }) ??
    inputTokens * 15 + SECOND_READER_MAX_OUTPUT_TOKENS * 75
  );
}

export interface SecondReaderTextRow {
  document_text_id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  normalized_text: string;
  text_hash: string;
  institution_name: string | null;
  platform: string | null;
}

/**
 * The batch's texts still to read: every completed text of a current document (no newer copy,
 * `superseded_by_id IS NULL`) of the batch's institutions, with no lasting second read of the same
 * text hash in this batch. Read-only.
 */
export async function selectSecondReaderTexts(db: SqlTag, batch: SecondReaderBatch, limit: number): Promise<SecondReaderTextRow[]> {
  if (batch.institutionIds.length === 0) return [];
  const rows = await db.unsafe<SecondReaderTextRow[]>(
    `
      SELECT adt.id AS document_text_id, adt.source_document_id, adt.institution_id, adt.source_url,
             adt.normalized_text, adt.text_hash, inst.institution_name,
             COALESCE(NULLIF(btrim(profile.platform), ''), NULLIF(btrim(inst.cms_platform), '')) AS platform
        FROM agent_source_texts adt
        JOIN source_documents doc ON doc.id = adt.source_document_id
        JOIN institution_sources inst ON inst.id = adt.institution_id
        LEFT JOIN institution_source_profiles profile ON profile.institution_id = adt.institution_id
       WHERE adt.institution_id = ANY(string_to_array($1, ',')::bigint[])
         AND adt.status = 'completed'
         AND adt.normalized_text IS NOT NULL
         AND adt.text_hash IS NOT NULL
         AND doc.superseded_by_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts done
            WHERE done.stage = 'extract'
              AND done.strategy = $2
              AND done.institution_id = adt.institution_id
              AND done.input_fingerprint = adt.text_hash
              AND done.detail->>'batch_id' = $3
              AND done.outcome NOT IN (${TRANSIENT_OUTCOMES.map((outcome) => `'${outcome}'`).join(", ")})
         )
       ORDER BY adt.institution_id, adt.id
       LIMIT $4
    `,
    [batch.institutionIds.join(","), KNOX_SECOND_READER_STRATEGY.strategy, batch.id, limit],
  );
  // The scope holds in code too: a row of any other institution is never read.
  const scope = new Set(batch.institutionIds);
  return rows.filter((row) => scope.has(Number(row.institution_id)));
}

/** The batch's logged provider spend so far: every second-reader call tagged with its batch id. */
export async function secondReaderBatchSpend(db: SqlTag, batchId: string): Promise<number> {
  const [row] = await db`
    SELECT COALESCE(SUM(estimated_cost_microusd), 0)::bigint AS spent
      FROM ai_api_usage_events
     WHERE operation = ${SECOND_READER_OPERATION}
       AND metadata->>'batch_id' = ${batchId}
  `;
  return Number(row?.spent ?? 0);
}

export interface SecondReaderTextResult {
  institution_id: number;
  document_text_id: number;
  outcome?: AttemptOutcome;
  returned?: number;
  traced?: number;
  rejected?: Partial<Record<SecondReadRejection, number>>;
  by_kind?: Record<PaidFindMissKind, number>;
  never_read?: NeverReadFind[];
  candidates_written?: number;
  cost_microusd?: number;
  error?: string;
}

export interface SecondReaderResult {
  batchId: string;
  dryRun: boolean;
  /** Why the step read nothing: the switch is off, or the batch id is unknown. */
  skipped: "switch_off" | "unknown_batch" | null;
  selected: number;
  processed: number;
  failed: number;
  stopped: string | null;
  traced: number;
  neverRead: number;
  feedbackWritten: number;
  candidatesWritten: number;
  costMicrousd: number;
  spentMicrousd: number;
  capMicrousd: number;
  lessonDrafts: NeverReadLessonDraft[];
  texts: SecondReaderTextResult[];
}

function failureOutcome(error: unknown): AttemptOutcome {
  const status = Number((error as { status?: unknown })?.status);
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  if (Number.isFinite(status) && status > 0) return "http_other";
  return /abort|timed? ?out|timeout/i.test(error instanceof Error ? error.message : String(error)) ? "timeout" : "network_error";
}

const isStopError = (error: unknown) => error instanceof Error && STOP_ERRORS.has(error.name);
const usd = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

/**
 * The `knox-second-reader` step. With the switch off, or for a batch id not in
 * `SECOND_READER_BATCHES`, it reads nothing and makes no call. A dry-run run lists the texts it
 * would read. Otherwise each text gets one blind call, its finds are traced and diffed with Knox's
 * free read, and each never-read is recorded (feedback row, event, and a candidate only when the
 * batch writes them).
 */
export async function runKnoxSecondReader(options: {
  runId: number;
  stepId?: number | null;
  dryRun?: boolean;
  batchId?: string | null;
  db?: SqlTag;
  create?: PaidMessageCreator;
  env?: NodeJS.ProcessEnv;
  limit?: number;
}): Promise<SecondReaderResult> {
  const db = options.db ?? sql;
  const env = options.env ?? process.env;
  const batchId = options.batchId?.trim() || SECOND_READER_ACTIVE_BATCH;
  const batch = SECOND_READER_BATCHES[batchId];
  const result: SecondReaderResult = {
    batchId, dryRun: Boolean(options.dryRun), skipped: null, selected: 0, processed: 0, failed: 0, stopped: null,
    traced: 0, neverRead: 0, feedbackWritten: 0, candidatesWritten: 0, costMicrousd: 0, spentMicrousd: 0,
    capMicrousd: batch?.capMicrousd ?? 0, lessonDrafts: [], texts: [],
  };
  if (!batch) return { ...result, skipped: "unknown_batch" };
  // A dry-run run only lists; a live run needs the switch, checked before any read or call.
  if (!result.dryRun && !secondReaderLive(env)) return { ...result, skipped: "switch_off" };

  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || SECOND_READER_TEXTS_PER_STEP), 1), SECOND_READER_TEXTS_PER_STEP);
  const rows = await selectSecondReaderTexts(db, batch, limit);
  result.selected = rows.length;
  if (result.dryRun) {
    result.texts = rows.map((row) => ({ institution_id: Number(row.institution_id), document_text_id: Number(row.document_text_id) }));
    return result;
  }

  const model = secondReaderModel(env);
  let spent = await secondReaderBatchSpend(db, batch.id);
  for (const row of rows) {
    const institutionId = Number(row.institution_id);
    const documentTextId = Number(row.document_text_id);
    const ceiling = textCeilingMicrousd(row.normalized_text, model);
    if (spent + ceiling > batch.capMicrousd) {
      result.stopped = `Batch cap: ${usd(spent)} spent of ${usd(batch.capMicrousd)}; the next text's worst case is ${usd(ceiling)}.`;
      break;
    }
    const startedAt = Date.now();
    const base = {
      institutionId,
      sourceDocumentId: Number(row.source_document_id),
      stage: "extract" as const,
      strategy: KNOX_SECOND_READER_STRATEGY.strategy,
      version: KNOX_SECOND_READER_STRATEGY.version,
      fingerprint: row.text_hash,
      runId: options.runId,
      stepId: options.stepId ?? null,
      foldIntoPlaybook: false,
    };
    let call: Awaited<ReturnType<typeof paidModelCall>>;
    try {
      call = await paidModelCall({
        agent: "knox",
        operation: SECOND_READER_OPERATION,
        runId: options.runId,
        params: secondReaderRequest(model, row.normalized_text),
        create: options.create,
        metadata: { batch_id: batch.id, institution_id: institutionId, document_text_id: documentTextId, text_hash: row.text_hash },
      });
    } catch (error) {
      if (isStopError(error)) {
        // Nothing spent, nothing tried: no attempt, so the text stays to read.
        result.stopped = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        break;
      }
      const outcome = failureOutcome(error);
      const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
      result.processed += 1;
      result.failed += 1;
      result.texts.push({ institution_id: institutionId, document_text_id: documentTextId, outcome, error: message });
      await recordAttempt(db, { ...base, outcome, yieldCount: 0, costMicrousd: 0, durationMs: Date.now() - startedAt, detail: { batch_id: batch.id, document_text_id: documentTextId, model, error: message } });
      continue;
    }
    const cost = call.costMicrousd ?? ceiling;
    spent += cost;
    result.processed += 1;
    result.costMicrousd += cost;

    const parsed = paidResponseJson<{ fees?: PaidFeeRow[] } | PaidFeeRow[]>(call.message);
    const returned = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.fees) ? parsed.fees : null;
    const { finds, rejected } = traceSecondRead(returned ?? [], row.normalized_text);
    const diff = diffSecondRead({
      text: row.normalized_text,
      sourceUrl: row.source_url,
      platform: row.platform ?? null,
      finds,
      free: runFreeSpecialists(row.normalized_text, { institutionName: row.institution_name ?? null }),
    });
    result.traced += finds.length;
    result.neverRead += diff.neverRead.length;

    result.feedbackWritten += await recordFeedback(db, neverReadFeedback({
      runId: options.runId, batchId: batch.id, model, institutionId, sourceDocumentId: Number(row.source_document_id),
      documentTextId, textHash: row.text_hash, sourceUrl: row.source_url, summary: diff.summary, neverRead: diff.neverRead,
    }));

    let candidatesWritten = 0;
    if (batch.writeCandidates) {
      const textRow: KnoxTextRow = row;
      for (const find of diff.neverRead) {
        // A $0 find is reported only: a free line is a held read on every other path.
        if (find.amount <= 0) continue;
        const excerpt = find.sourceLine.slice(0, 280);
        const ok = await insertCandidate(db, {
          runId: options.runId,
          row: textRow,
          candidate: {
            feeName: find.feeName,
            amount: find.amount,
            frequency: find.frequency,
            canonicalHint: find.canonicalKey,
            confidence: confidenceFor(excerpt),
            excerpt,
            waivable: /\bwaiv/i.test(find.sourceLine),
          },
          extraFlags: [SECOND_READER_FLAG, NEVER_READ_FLAG],
          method: `second reader (${model})`,
        });
        if (ok) candidatesWritten += 1;
      }
    }
    result.candidatesWritten += candidatesWritten;

    const outcome: AttemptOutcome = returned == null ? "parse_error" : finds.length > 0 ? "ok" : returned.length > 0 ? "evidence_mismatch" : "no_candidates";
    if (outcome === "parse_error") result.failed += 1;
    const detail = {
      batch_id: batch.id,
      document_text_id: documentTextId,
      model,
      returned: returned?.length ?? 0,
      traced: finds.length,
      rejected,
      by_kind: diff.summary.by_kind,
      never_read: diff.neverRead,
      layout: diff.summary.layout,
      candidates_written: candidatesWritten,
    };
    result.texts.push({ institution_id: institutionId, ...detail, outcome, cost_microusd: cost });
    await recordAttempt(db, { ...base, outcome, yieldCount: diff.neverRead.length, costMicrousd: cost, durationMs: Date.now() - startedAt, detail });
  }
  result.spentMicrousd = spent;

  // The lesson pathway reads back every never-read row of the batch, this run's and earlier runs'.
  if (result.processed > 0) result.lessonDrafts = await loadNeverReadLessonDrafts(db, { batchId: batch.id });
  if (result.processed > 0) {
    const detail = {
      batch_id: batch.id,
      model,
      selected: result.selected,
      processed: result.processed,
      failed: result.failed,
      traced: result.traced,
      never_read: result.neverRead,
      feedback_written: result.feedbackWritten,
      candidates_written: result.candidatesWritten,
      cost_microusd: result.costMicrousd,
      spent_microusd: result.spentMicrousd,
      cap_microusd: batch.capMicrousd,
      stopped: result.stopped,
      lesson_drafts: result.lessonDrafts,
      texts: result.texts,
    };
    await db`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (${options.runId}, ${options.stepId ?? null}, ${SECOND_READER_EVENT}, 'completed', ${secondReaderSummaryLine(result)}, ${JSON.stringify(detail)}::jsonb)
    `;
    if (result.lessonDrafts.length > 0) {
      await db`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (${options.runId}, ${options.stepId ?? null}, 'knox.never_read_lessons', 'completed', ${neverReadLessonsMessage(result.lessonDrafts)}, ${JSON.stringify({ batch_id: batch.id, drafts: result.lessonDrafts })}::jsonb)
      `;
    }
  }
  return result;
}

export function secondReaderSummaryLine(result: SecondReaderResult): string {
  if (result.skipped === "switch_off") return `Knox's second reader is off (${KNOX_SECOND_READER_SWITCH}); no call made.`;
  if (result.skipped === "unknown_batch") return `Knox's second reader: batch ${result.batchId} is not an approved batch; no call made.`;
  if (result.dryRun) return `Knox's second reader (dry run of the step): would read ${result.selected} texts of batch ${result.batchId}.`;
  return (
    `Knox's second reader, batch ${result.batchId}: read ${result.processed} texts blind (${result.failed} failed), ` +
    `${result.traced} fees traced to their source line, ${result.neverRead} never read by Knox ` +
    `(${result.feedbackWritten} lesson rows, ${result.candidatesWritten} candidates for Darwin); ` +
    `${usd(result.costMicrousd)} this step, ${usd(result.spentMicrousd)} of ${usd(result.capMicrousd)} for the batch` +
    `${result.stopped ? `. Stopped: ${result.stopped}` : ""}.`
  );
}
