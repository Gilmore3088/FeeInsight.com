import { beforeEach, describe, expect, it, vi } from "vitest";

// The provider is mocked: no test makes a provider call. `create` is the request seam.
const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

// Knox's free read is controlled per test, so the diff is exact.
const freeRead = vi.fn();
vi.mock("./specialists", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./specialists")>()),
  runFreeSpecialists: (...args: unknown[]) => freeRead(...args),
}));

const insertCandidate = vi.fn(async () => true);
vi.mock("./extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./extract")>()),
  insertCandidate: (...args: unknown[]) => insertCandidate(...(args as [])),
}));

const loadKnoxLessons = vi.fn();
vi.mock("./lessons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lessons")>()),
  loadKnoxLessons: (...args: unknown[]) => loadKnoxLessons(...args),
}));

const getAutomationControl = vi.fn(async () => ({ enabled: true }));
const startAgentRun = vi.fn(async () => ({ reused: false, run: { id: 77 } }));
vi.mock("@/lib/automation-control", () => ({ getAutomationControl: () => getAutomationControl() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: (...args: unknown[]) => startAgentRun(...(args as [])) }));

import { paidExtractInstructions, paidExtractPrompt } from "./paid-extract";
import {
  diffSecondRead,
  estimateSecondReaderCost,
  KNOX_SECOND_READER_STRATEGY,
  NEVER_READ_KIND,
  OBSERVED_INPUT_TOKENS_PER_CHAR,
  OBSERVED_OUTPUT_TOKENS,
  runKnoxSecondReader,
  SECOND_READER_BATCHES,
  SECOND_READER_STOP_STARTING_AFTER_MS,
  SECOND_READER_MAX_OUTPUT_TOKENS,
  secondReaderLive,
  secondReaderRequest,
  textCeilingMicrousd,
  traceSecondRead,
  traceSecondReadFind,
  type SecondReaderBatch,
} from "./second-reader";
import { scheduleKnoxSecondReaderRun, secondReaderScheduleLockKey } from "./second-reader-schedule";
import { neverReadLessonDrafts } from "./never-read-lessons";
import { FEEDBACK_KINDS } from "@/lib/agents/learning/feedback-kinds";
import { isProviderStep } from "@/lib/agents/types";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn>; begin: ReturnType<typeof vi.fn> };
const ON = { KNOX_SECOND_READER_LIVE: "true" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as unknown as NodeJS.ProcessEnv;
const BATCH = "2026-11-07-cohort8";

const text = [
  "Fee Schedule",
  "Stop payment order | $31.00 each",
  "Domestic wire transfer, outgoing | $27.50 per wire",
  "Statement copy | $5.00",
].join("\n");

/** What Knox's free team reads from the text: only the stop payment, under its own name. */
const knoxRead = {
  candidates: [
    { feeName: "KNOX-ONLY-READ Stop payment order", amount: 31, frequency: "per_item", canonicalHint: "stop_payment", confidence: 0.9, excerpt: "Stop payment order | $31.00 each", waivable: false },
  ],
  held: [],
};

function textRow(institutionId = 395, id = 2412) {
  return {
    document_text_id: id,
    source_document_id: 15392,
    institution_id: institutionId,
    source_url: "https://bank.example/fees.pdf",
    normalized_text: text,
    text_hash: `hash-${id}`,
    institution_name: "Example Bank",
    platform: null,
  };
}

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDb(rows: Array<Record<string, unknown>>, options: { spent?: number; feedback?: Array<Record<string, unknown>>; active?: boolean } = {}): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const sqlText = templateText(strings);
    if (sqlText.includes("FROM ai_api_usage_events")) return Promise.resolve([{ spent: options.spent ?? 0 }]);
    if (sqlText.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }]);
    if (sqlText.includes("FROM pipeline_feedback")) return Promise.resolve(options.feedback ?? []);
    if (sqlText.includes("FROM agent_runs")) return Promise.resolve(options.active ? [{ id: 55 }] : []);
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  db.begin = vi.fn(async (work: (tx: DbMock) => unknown) => work(db));
  return db;
}
const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof runKnoxSecondReader>[0]["db"]>;

/** The test model's cost of one `reply`: 2,000 input and 400 output tokens at $2 / $10 a million. */
const REPLY_COST = 2_000 * 2 + 400 * 10;
const reply = (fees: unknown[]) =>
  ({ content: [{ type: "text", text: JSON.stringify({ fees }) }], usage: { input_tokens: 2_000, output_tokens: 400 } }) as never;

const modelFees = [
  { fee_name: "Stop payment", canonical_key: "stop_payment", amount: 31, source_line: "Stop payment order | $31.00 each" },
  { fee_name: "Outgoing domestic wire", canonical_key: "wire_domestic_outgoing", amount: 27.5, source_line: "Domestic wire transfer, outgoing | $27.50 per wire" },
  // Untraceable: the quoted line is not in the document.
  { fee_name: "Overdraft fee", canonical_key: "overdraft", amount: 35, source_line: "Overdraft fee | $35.00 per item" },
];

describe("Knox's blind second reader", () => {
  beforeEach(() => {
    trackAnthropicRequest.mockClear();
    freeRead.mockReset();
    freeRead.mockReturnValue(knoxRead);
    insertCandidate.mockClear();
    loadKnoxLessons.mockClear();
    startAgentRun.mockClear();
    getAutomationControl.mockClear();
  });

  it("is a provider step behind a switch that is off by default", () => {
    expect(isProviderStep("knox-second-reader")).toBe(true);
    expect(secondReaderLive(OFF)).toBe(false);
    expect(secondReaderLive({ KNOX_SECOND_READER_LIVE: " 'TRUE' " } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(secondReaderLive({ KNOX_SECOND_READER_LIVE: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("sends only the fixed instructions and the text: Knox's output never enters the prompt", async () => {
    const request = secondReaderRequest("model-x", text);
    expect(request.system).toEqual([{ type: "text", text: paidExtractInstructions(), cache_control: { type: "ephemeral" } }]);
    expect(request.messages).toEqual([{ role: "user", content: paidExtractPrompt(text) }]);

    const create = vi.fn(async () => reply(modelFees));
    await runKnoxSecondReader({ runId: 1, stepId: 2, db: asDb(createDb([textRow()])), create, env: ON, batchId: BATCH });
    expect(create).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify((create.mock.calls[0] as unknown[])[0]);
    expect(sent).not.toContain("KNOX-ONLY-READ");
    expect(sent).not.toMatch(/lesson/i);
    // Knox's free read is run only after the call, and no lesson is loaded for the request.
    expect(freeRead.mock.invocationCallOrder[0]).toBeGreaterThan(create.mock.invocationCallOrder[0]);
    expect(loadKnoxLessons).not.toHaveBeenCalled();
  });

  it("drops a find whose source line does not trace, and never flags it", () => {
    // groundPaidRow would keep this one on its name alone; the second reader wants the line itself.
    expect(traceSecondReadFind(text, { feeName: "Statement copy", amount: 5, sourceLine: "Copy of a statement, $5.00" })).toBe(false);
    expect(traceSecondReadFind(text, { feeName: "Statement copy", amount: 5, sourceLine: "Statement copy | $5.00" })).toBe(true);
    // The line is in the text but the amount is not stated as that fee.
    expect(traceSecondReadFind(text, { feeName: "Statement copy", amount: 6, sourceLine: "Statement copy | $5.00" })).toBe(false);

    const { finds, rejected } = traceSecondRead(
      [...modelFees, { fee_name: "Statement copy", canonical_key: "paper_statement", amount: 5, source_line: "Copy of a statement, $5.00" }],
      text,
    );
    expect(finds.map((find) => find.canonicalKey)).toEqual(["stop_payment", "wire_domestic_outgoing"]);
    expect((rejected.not_in_text ?? 0) + (rejected.untraced ?? 0)).toBe(2);
  });

  it("flags as never-read only the traced finds Knox's free read misses", () => {
    const { finds } = traceSecondRead(modelFees, text);
    const diff = diffSecondRead({ text, sourceUrl: null, platform: null, finds, free: knoxRead as never });
    expect(diff.summary.by_kind).toMatchObject({ free_read: 1, free_missed: 1 });
    expect(diff.neverRead).toEqual([expect.objectContaining({ canonicalKey: "wire_domestic_outgoing", amount: 27.5, sourceLine: "Domestic wire transfer, outgoing | $27.50 per wire" })]);
  });

  it("records each never-read as a lesson row and an event; the dry-run batch writes no fee row", async () => {
    const db = createDb([textRow()]);
    const result = await runKnoxSecondReader({ runId: 1, stepId: 2, db: asDb(db), create: vi.fn(async () => reply(modelFees)), env: ON, batchId: BATCH });
    expect(result).toMatchObject({ processed: 1, traced: 2, neverRead: 1, feedbackWritten: 1, candidatesWritten: 0 });
    expect(insertCandidate).not.toHaveBeenCalled();
    const feedback = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_feedback"));
    const rows = JSON.parse(String(feedback?.[1])) as Array<Record<string, unknown>>;
    expect(rows).toEqual([expect.objectContaining({ kind: NEVER_READ_KIND, signal: "missed", reported_by: "knox", check_name: "knox.second_reader", about_stage: "extract", canonical_fee_key: "wire_domestic_outgoing" })]);
    expect((rows[0].evidence as Record<string, unknown>).source_line).toBe("Domestic wire transfer, outgoing | $27.50 per wire");
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toContain(KNOX_SECOND_READER_STRATEGY.strategy);
    expect(db.mock.calls.some((call) => call.includes("knox.second_reader"))).toBe(true);
  });

  it("refuses a batch that would write candidates, with no read and no call", async () => {
    const batch: SecondReaderBatch = { ...SECOND_READER_BATCHES[BATCH], id: "test-writes", writeCandidates: true };
    (SECOND_READER_BATCHES as Record<string, SecondReaderBatch>)["test-writes"] = batch;
    try {
      const db = createDb([textRow()]);
      const create = vi.fn(async () => reply(modelFees));
      const result = await runKnoxSecondReader({ runId: 1, db: asDb(db), create, env: ON, batchId: "test-writes" });
      expect(result.skipped).toBe("write_candidates_unsupported");
      expect(create).not.toHaveBeenCalled();
      expect(db.unsafe).not.toHaveBeenCalled();
      expect(insertCandidate).not.toHaveBeenCalled();
      // Even a dry-run run of such a batch is refused.
      expect((await runKnoxSecondReader({ runId: 1, db: asDb(db), create, env: ON, dryRun: true, batchId: "test-writes" })).skipped).toBe("write_candidates_unsupported");
    } finally {
      delete (SECOND_READER_BATCHES as Record<string, SecondReaderBatch>)["test-writes"];
    }
  });

  it("refuses a model with no list price, so no call's cost is unknown", async () => {
    const env = { ...ON, PIPELINE_SECOND_READ_MODEL: "unlisted-model-1" } as unknown as NodeJS.ProcessEnv;
    const db = createDb([textRow()]);
    const create = vi.fn(async () => reply(modelFees));
    expect((await runKnoxSecondReader({ runId: 1, db: asDb(db), create, env, batchId: BATCH })).skipped).toBe("unpriced_model");
    expect(create).not.toHaveBeenCalled();
    expect(await scheduleKnoxSecondReaderRun(asDb(db), new Date(0), env)).toEqual({ scheduled: false, runId: null, reason: "unpriced_model" });
    expect(db).not.toHaveBeenCalled();
  });

  it("stops mid-loop once the next text's worst case no longer fits under the cap", async () => {
    const cap = SECOND_READER_BATCHES[BATCH].capMicrousd;
    const ceiling = textCeilingMicrousd(text, "claude-sonnet-5-5");
    // The first text fits exactly; after its cost is added, the second does not.
    const create = vi.fn(async () => reply(modelFees));
    const result = await runKnoxSecondReader({ runId: 1, db: asDb(createDb([textRow(395, 1), textRow(395, 2)], { spent: cap - ceiling })), create, env: ON, batchId: BATCH });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
    expect(result.costMicrousd).toBe(REPLY_COST);
    expect(result.spentMicrousd).toBe(cap - ceiling + REPLY_COST);
    expect(result.stopped).toMatch(/Batch cap/);
  });

  it("starts no read once the time budget has passed, so at most one is in flight past it", async () => {
    let clock = 0;
    const create = vi.fn(async () => {
      clock += SECOND_READER_STOP_STARTING_AFTER_MS + 1;
      return reply(modelFees);
    });
    const result = await runKnoxSecondReader({ runId: 1, db: asDb(createDb([textRow(395, 1), textRow(395, 2), textRow(395, 3)])), create, env: ON, batchId: BATCH, now: () => clock });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.stopped).toMatch(/Time budget/);
  });

  it("leaves a text unread when the provider stop or a budget cap refuses the call", async () => {
    const db = createDb([textRow(395, 1), textRow(395, 2)]);
    const create = vi.fn(async () => {
      throw Object.assign(new Error("Provider budget blocked"), { name: "ProviderBudgetBlockedError" });
    });
    const result = await runKnoxSecondReader({ runId: 1, db: asDb(db), create, env: ON, batchId: BATCH });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ processed: 0, failed: 0, stopped: "Provider budget blocked" });
    // No attempt row: the text stays selectable for the next run.
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))).toBe(false);
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO pipeline_feedback"))).toBe(false);
  });

  it("re-selects a text only when its earlier read ended for a transient reason", async () => {
    const db = createDb([]);
    await runKnoxSecondReader({ runId: 1, db: asDb(db), env: OFF, dryRun: true, batchId: BATCH });
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("done.outcome NOT IN ('timeout', 'network_error', 'http_429', 'http_5xx', 'budget_blocked')");
    expect(query).toContain("done.detail->>'batch_id' = $3");
    expect(params.slice(1, 3)).toEqual([KNOX_SECOND_READER_STRATEGY.strategy, BATCH]);
  });

  it("makes no call and reads nothing with the switch off", async () => {
    const db = createDb([textRow()]);
    const create = vi.fn(async () => reply(modelFees));
    const result = await runKnoxSecondReader({ runId: 1, db: asDb(db), create, env: OFF, batchId: BATCH });
    expect(result.skipped).toBe("switch_off");
    expect(create).not.toHaveBeenCalled();
    expect(trackAnthropicRequest).not.toHaveBeenCalled();
    expect(db).not.toHaveBeenCalled();
    expect(db.unsafe).not.toHaveBeenCalled();

    expect(await scheduleKnoxSecondReaderRun(asDb(db), new Date(), OFF)).toEqual({ scheduled: false, runId: null, reason: "switch_off" });
    expect(db).not.toHaveBeenCalled();
    expect(startAgentRun).not.toHaveBeenCalled();
  });

  it("reads only the batch's institutions, and nothing for an unapproved batch", async () => {
    const db = createDb([textRow(395, 1), textRow(9999, 2)]);
    const create = vi.fn(async () => reply(modelFees));
    const result = await runKnoxSecondReader({ runId: 1, db: asDb(db), create, env: ON, batchId: BATCH });
    const [, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe("395,2267,4888,5410,6109,7229,7723,7815");
    expect(String(db.unsafe.mock.calls[0][0])).toContain("superseded_by_id IS NULL");
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.texts.map((entry) => entry.institution_id)).toEqual([395]);

    const other = vi.fn(async () => reply(modelFees));
    expect((await runKnoxSecondReader({ runId: 1, db: asDb(createDb([textRow()])), create: other, env: ON, batchId: "made-up" })).skipped).toBe("unknown_batch");
    expect(other).not.toHaveBeenCalled();
  });

  it("stops before a call that could take the batch over its cap", async () => {
    const create = vi.fn(async () => reply(modelFees));
    const cap = SECOND_READER_BATCHES[BATCH].capMicrousd;
    const result = await runKnoxSecondReader({ runId: 1, db: asDb(createDb([textRow()], { spent: cap - 1 })), create, env: ON, batchId: BATCH });
    expect(create).not.toHaveBeenCalled();
    expect(result.stopped).toMatch(/Batch cap/);
  });

  it("lists the texts without a call in a dry-run run", async () => {
    const create = vi.fn(async () => reply(modelFees));
    const result = await runKnoxSecondReader({ runId: 1, db: asDb(createDb([textRow()])), create, env: OFF, dryRun: true, batchId: BATCH });
    expect(result).toMatchObject({ dryRun: true, selected: 1, skipped: null });
    expect(create).not.toHaveBeenCalled();
  });

  it("queues one run of the approved batch only with the switch on, under an advisory lock", async () => {
    const db = createDb([textRow()]);
    expect(await scheduleKnoxSecondReaderRun(asDb(db), new Date(0), ON)).toEqual({ scheduled: true, runId: 77 });
    expect(db.begin).toHaveBeenCalledTimes(1);
    const lock = db.mock.calls.findIndex((call) => templateText(call[0]).includes("pg_advisory_xact_lock"));
    const activeCheck = db.mock.calls.findIndex((call) => templateText(call[0]).includes("FROM agent_runs"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(db.mock.calls[lock]).toContain(secondReaderScheduleLockKey(BATCH));
    expect(lock).toBeLessThan(activeCheck);
    expect(startAgentRun).toHaveBeenCalledWith(expect.objectContaining({ params: { source: "knox.second_reader", batch_id: BATCH }, steps: [expect.objectContaining({ key: "knox-second-reader" })] }));
  });

  it("queues nothing while a run is active, when no text is left, at the cap or under the provider stop", async () => {
    expect(await scheduleKnoxSecondReaderRun(asDb(createDb([textRow()], { active: true })), new Date(0), ON)).toEqual({ scheduled: false, runId: 55, reason: "active" });
    expect(await scheduleKnoxSecondReaderRun(asDb(createDb([])), new Date(0), ON)).toEqual({ scheduled: false, runId: null, reason: "done" });
    // Under the cap by less than any left text's worst case: the step could not read one, so none is queued.
    const cap = SECOND_READER_BATCHES[BATCH].capMicrousd;
    const ceiling = textCeilingMicrousd(text, "claude-sonnet-5-5");
    expect(await scheduleKnoxSecondReaderRun(asDb(createDb([textRow()], { spent: cap - ceiling + 1 })), new Date(0), ON)).toEqual({ scheduled: false, runId: null, reason: "capped" });
    getAutomationControl.mockResolvedValueOnce({ enabled: false });
    expect(await scheduleKnoxSecondReaderRun(asDb(createDb([textRow()])), new Date(0), ON)).toEqual({ scheduled: false, runId: null, reason: "provider_stop" });
    expect(startAgentRun).not.toHaveBeenCalled();
  });
});

describe("the never-read lesson pathway", () => {
  it("registers never_read with its reader", () => {
    expect(FEEDBACK_KINDS[NEVER_READ_KIND]).toMatchObject({ readers: ["src/lib/agents/knox/never-read-lessons.ts"] });
  });

  it("groups confirmed misses into lesson drafts by layout and line shape, repeats at two banks", () => {
    const drafts = neverReadLessonDrafts([
      { institutionId: 1, layout: "table/short", lineShape: "table", canonicalKey: "wire_domestic_outgoing", sourceLine: "Wire | $25" },
      { institutionId: 2, layout: "table/short", lineShape: "table", canonicalKey: "wire_domestic_outgoing", sourceLine: "Wire out | $30" },
      { institutionId: 2, layout: "plain/short", lineShape: "sentences", canonicalKey: "stop_payment", sourceLine: "A stop payment costs $31." },
    ]);
    expect(drafts.map((draft) => [draft.lineShape, draft.banks, draft.misses, draft.repeats])).toEqual([
      ["table", 2, 2, true],
      ["sentences", 1, 1, false],
    ]);
    expect(drafts[0].draft).toContain("never read");
  });
});

/**
 * The Nov 7 cohort's 15 current texts (completed, `superseded_by_id IS NULL`), character counts read
 * from prod on 2026-11-07 (read-only SELECT; finding 2026-11-07-blind-second-reader.md).
 */
const COHORT_TEXT_CHARS = [8061, 8751, 7702, 8077, 4035, 3115, 11939, 16116, 5654, 4002, 5068, 7638, 4578, 4663, 2351];

describe("the 8-bank dry run's cost estimate", () => {
  const model = "claude-sonnet-5-5";
  const texts = COHORT_TEXT_CHARS.map((chars) => ({ chars }));

  it("prices the batch at the observed and worst-case token counts, and its cap covers the worst case", () => {
    expect(COHORT_TEXT_CHARS.reduce((a, b) => a + b, 0)).toBe(101_750);
    const expected = estimateSecondReaderCost(texts, model, { tokensPerChar: OBSERVED_INPUT_TOKENS_PER_CHAR, outputTokensPerText: OBSERVED_OUTPUT_TOKENS.mean });
    const p95 = estimateSecondReaderCost(texts, model, { tokensPerChar: OBSERVED_INPUT_TOKENS_PER_CHAR, outputTokensPerText: OBSERVED_OUTPUT_TOKENS.p95 });
    const worst = estimateSecondReaderCost(texts, model, { tokensPerChar: 1 / 3, outputTokensPerText: SECOND_READER_MAX_OUTPUT_TOKENS });
    // The trusted source-data boundary adds 632 instruction characters to each of the 15 reads.
    // Fixed expectations independently price 162,860 total request characters at $2 / $10 per
    // million input / output tokens. Historical output scenarios remain projections, not new usage.
    expect(paidExtractInstructions().length).toBe(4_059);
    expect([expected.inputTokens, expected.outputTokens, expected.microusd]).toEqual([52_995, 16_590, 271_890]);
    expect([p95.inputTokens, p95.outputTokens, p95.microusd]).toEqual([52_995, 41_340, 519_390]);
    expect([worst.inputTokens, worst.outputTokens, worst.microusd]).toEqual([54_287, 120_000, 1_308_574]);
    expect(SECOND_READER_BATCHES[BATCH].capMicrousd).toBe(1_500_000);
    expect(worst.microusd as number).toBeLessThanOrEqual(SECOND_READER_BATCHES[BATCH].capMicrousd);
    const ceilings = COHORT_TEXT_CHARS.reduce((sum, chars) => sum + textCeilingMicrousd("x".repeat(chars), model), 0);
    // The actual admission guard rounds every request up, independently of the aggregate estimate.
    expect(ceilings).toBe(1_308_582);
    expect(ceilings).toBeLessThanOrEqual(SECOND_READER_BATCHES[BATCH].capMicrousd);
  });
});
