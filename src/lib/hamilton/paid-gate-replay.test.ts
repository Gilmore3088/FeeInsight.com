import { describe, expect, it, vi } from "vitest";
import { buildAskResponse, parseAsk } from "./workspace/ask";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { LiveReader } from "./answer-correctness";
import type { MemoClient } from "./memo";
import type { WrittenAnswerWriter } from "./written-answer-read";
import type { PreparedReportAnswer, ReportAnswerWriter } from "./report-answer-read";

// Invented institutions, questions and figures for tests only; nothing here is live data. No provider is reached:
// every writer is a double, and the database is an in-memory ledger.
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
// The shadow store, for the default batchShadows read only: an earlier batch's replay_paid shadows sit beside this one's.
const storedShadows = vi.hoisted(() => ({ rows: [] as Array<{ record: unknown; key: string | null }> }));
vi.mock("./output-gate-shadow-store", () => ({
  gateShadowRecordsSince: vi.fn(async () => storedShadows.rows),
  recordGateShadow: vi.fn(async () => 1),
}));

const replay = await import("./paid-gate-replay");
const {
  PAID_REPLAY_BATCH_ID, PAID_REPLAY_CEILING_MICROUSD, PAID_REPLAY_DONE, PAID_REPLAY_MAX_COST_MICROUSD, PAID_REPLAY_MAX_IN_FLIGHT,
  PAID_REPLAY_MAX_SAMPLES, PAID_REPLAY_MIX, PAID_REPLAY_RESERVATION, PAID_REPLAY_SOURCE, PAID_REPLAY_STEP_KEY, PAID_REPLAY_SUBJECT_PREFIX,
  PAID_REPLAY_WORST_CASE, PAID_REPLAY_BATCH_START, activePaidReplayRun, baseCeilings, batchCharge, paidReplayBatchComplete, paidReplaySummaryLine,
  pathCeilings, reservePaidReplaySample, runPaidGateReplay, subjectKeyFor,
} = replay;
const { PAID_EVAL_RESERVATION, PAID_EVAL_WRITTEN_OPERATION, runPaidAnswerEval } = await import("./paid-answer-eval");
const { tallyGateShadow } = await import("./output-gate-shadow");
const { reportSectionGateShadow } = await import("./generate");
const { isProviderStep } = await import("@/lib/agents/types");
const { TICK_EXCLUDED_STEP_KEYS } = await import("@/lib/agents/run-store");
type GateShadowRecord = import("./output-gate-shadow").GateShadowRecord;
type PaidPath = import("./paid-answer-eval").PaidPath;
type SqlTag = Parameters<typeof reservePaidReplaySample>[0];

const NOW = new Date("2026-10-26T18:00:00Z");
/** The first batch, over before this one: nothing of it may count here. */
const OLD_BATCH = "2026-10-25";
const RUN = 501;

interface LedgerEvent { agent_run_id: number; event_type: string; detail: Record<string, unknown>; created_at: string }
/** One usage row; `status` defaults to completed, and a failed call with unknown usage records a NULL cost. */
interface Usage { subject_key: string | null; agent_run_id: number | null; microusd: number | null; status?: string }

/**
 * The run ledger and usage table in memory: the reads answer as the SQL does, the reservation's
 * conditional insert refuses as its WHERE does, and `begin` serializes like the advisory lock.
 */
function ledger(seed: { events?: LedgerEvent[]; usage?: Usage[]; finished?: Array<{ keys?: string[]; errored?: string[]; deferred?: string[]; complete?: boolean }> } = {}) {
  const state = { events: [...(seed.events ?? [])], usage: [...(seed.usage ?? [])], finished: [...(seed.finished ?? [])], locks: 0, staleReads: 0 };
  const reservations = () => state.events.filter((e) => e.event_type === PAID_REPLAY_RESERVATION && e.detail.batch_id === PAID_REPLAY_BATCH_ID);
  const tag = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    if (text.includes("pg_advisory_xact_lock")) { state.locks += 1; return []; }
    if (text.includes("ai_api_usage_events")) {
      const runs = new Set(reservations().map((e) => e.agent_run_id));
      const by = new Map<string, { microusd: number; rows: number; clean: number }>();
      for (const u of state.usage) {
        if (!(u.subject_key?.startsWith(PAID_REPLAY_SUBJECT_PREFIX) || (u.agent_run_id !== null && runs.has(u.agent_run_id)))) continue;
        const subject = u.subject_key ?? `run:${u.agent_run_id}`;
        const row = by.get(subject) ?? { microusd: 0, rows: 0, clean: 0 };
        row.microusd += u.microusd ?? 0;
        row.rows += 1;
        if ((u.status ?? "completed") === "completed" && u.microusd !== null) row.clean += 1;
        by.set(subject, row);
      }
      return [...by].map(([subject, row]) => ({ subject, ...row }));
    }
    if (text.includes("settledKeys")) return state.finished.map((f) => ({ keys: f.keys ?? [], errored: f.errored ?? [], deferred: f.deferred ?? [], complete: f.complete ? "true" : "false" }));
    if (text.includes("INSERT INTO agent_run_events")) {
      const detail = JSON.parse(String(values.find((v) => typeof v === "string" && v.startsWith("{")))) as Record<string, unknown>;
      if (values.includes(PAID_REPLAY_RESERVATION)) {
        const [quota, cap] = [Number(values.at(-4)), Number(values.at(-1))];
        const own = reservations();
        if (own.some((e) => e.detail.sample_key === detail.sample_key) || own.filter((e) => e.detail.path === detail.path).length >= quota || own.length >= cap) return [];
        state.events.push({ agent_run_id: Number(values[0]), event_type: PAID_REPLAY_RESERVATION, detail, created_at: NOW.toISOString() });
        return [{ id: state.events.length }];
      }
      state.events.push({ agent_run_id: Number(values[0]), event_type: PAID_REPLAY_DONE, detail, created_at: NOW.toISOString() });
      return [];
    }
    if (text.includes("event_type IN")) {
      // A stale read (another run's reservation not yet seen) answers with nothing.
      if (state.staleReads > 0) { state.staleReads -= 1; return []; }
      return state.events
        .filter((e) => (e.event_type === PAID_REPLAY_RESERVATION || e.event_type === PAID_REPLAY_DONE) && e.detail.batch_id === PAID_REPLAY_BATCH_ID)
        .map((e) => ({ event_type: e.event_type, sample_key: e.detail.sample_key, path: e.detail.path, created_at: e.created_at }));
    }
    throw new Error(`unexpected query: ${text}`);
  });
  let chain: Promise<unknown> = Promise.resolve();
  const begin = <T>(fn: (tx: SqlTag) => Promise<T>): Promise<T> => {
    const next = chain.then(() => fn(tag as unknown as SqlTag));
    chain = next.catch(() => undefined);
    return next;
  };
  const db = Object.assign(tag, { begin }) as unknown as SqlTag;
  return { db, state, reservations };
}

/** `n` reservations already held on `path`, finished. */
function held(path: PaidPath, n: number, runId = 400): LedgerEvent[] {
  return Array.from({ length: n }, (_, i) => [
    { agent_run_id: runId, event_type: PAID_REPLAY_RESERVATION, detail: { batch_id: PAID_REPLAY_BATCH_ID, sample_key: `${path}|old-${i}`, path }, created_at: "2026-10-26T17:00:00.000Z" },
    { agent_run_id: runId, event_type: PAID_REPLAY_DONE, detail: { batch_id: PAID_REPLAY_BATCH_ID, sample_key: `${path}|old-${i}`, path }, created_at: "2026-10-26T17:01:00.000Z" },
  ]).flat();
}

const question = "How does our overdraft fee compare?";
function answered(institutionId: number) {
  const research = overdraftResearch({ institutionId });
  const response = buildAskResponse({ question, intent: parseAsk(question), research, memory: [] });
  return { response, research, schedule: null };
}

const live: LiveReader = async (_id, research) => {
  if (!research) return { rows: [] };
  const members = new Map<number, number>();
  for (const m of [...research.peers, ...(research.localCompetitors ?? []), ...research.layers.flatMap((l) => l.members)]) members.set(m.institutionId, m.amount);
  members.delete(research.institutionId);
  return {
    rows: [
      { institution_id: research.institutionId, amount: research.current, fee_category: research.feeCategory },
      ...[...members].map(([id, amount]) => ({ institution_id: id, amount, fee_category: research.feeCategory })),
    ],
  };
};

/** Writers that each charge `cost` micro-dollars per call to the usage table, as the provider's usage rows would. */
function writers(book: ReturnType<typeof ledger>, cost: Partial<Record<PaidPath, number>> = {}) {
  const calls = { memo: 0, simulate: 0, written_answer: 0, report: 0 } as Record<PaidPath, number>;
  const operations: string[] = [];
  /** The agent each tracked call books under: "own" when no ledger moves it off its path's line. */
  const ledgers: string[] = [];
  const client: MemoClient = {
    async create({ system, user }) {
      if (system.includes("THIS ANSWER: a short read of one price")) {
        calls.simulate += 1;
        book.state.usage.push({ subject_key: null, agent_run_id: RUN, microusd: cost.simulate ?? 0 });
        return "At the tested price the fee sits at the peer median. The question for management is notice.";
      }
      calls.memo += 1;
      book.state.usage.push({ subject_key: null, agent_run_id: RUN, microusd: cost.memo ?? 0 });
      const data = JSON.parse(user.slice(user.indexOf("DATA:\n") + 6).split("\n\n")[0]) as { fact_evidence?: { facts: Array<{ id: string }> } };
      return JSON.stringify({ summary: "Your overdraft fee is $32.", board: "The board weighs notice.", market: "Marketing compares the schedule.", questions: ["What notice applies?"], evidence_fact_ids: data.fact_evidence?.facts.slice(0, 1).map((f) => f.id) ?? [] });
    },
  };
  const written: WrittenAnswerWriter = async (input) => {
    calls.written_answer += 1;
    operations.push(input.tracking?.operation ?? "");
    ledgers.push(input.tracking?.ledger?.agent ?? "own");
    book.state.usage.push({ subject_key: input.tracking?.subjectKey ?? null, agent_run_id: RUN, microusd: cost.written_answer ?? 0 });
    const text = "Your overdraft fee is $32.";
    const toolResults = [{ toolName: "searchFees", output: { fee_category: "overdraft", amount: 32 } }];
    const { checkAnswerEvidence } = await import("./answer-gate");
    return { status: "written" as const, text, toolResults, check: checkAnswerEvidence(text, toolResults.map((r) => r.output)) };
  };
  const writeReport: ReportAnswerWriter = async (_prepared, tracking) => {
    calls.report += 1;
    operations.push(tracking.operation ?? "");
    ledgers.push(tracking.ledger?.agent ?? "own");
    book.state.usage.push({ subject_key: tracking.subjectKey ?? null, agent_run_id: RUN, microusd: cost.report ?? 0 });
    const narrative = "HEADLINE: the overdraft fee sits near peers.";
    return { status: "written", narrative, passed: true, problems: [], gateShadow: () => reportSectionGateShadow(narrative, {}, "shown", tracking.gateIdentity!) };
  };
  return { calls, operations, ledgers, client, written, writeReport };
}

const prepared: PreparedReportAnswer = {
  institutionId: 1001, institutionName: "Bank 1001", input: { type: "executive_summary", title: "The Answer", data: {} },
  deltas: [], competitorNames: [], selectedInstitution: null, evidencePolicy: "provisional-first",
};

function deps(book: ReturnType<typeof ledger>, w: ReturnType<typeof writers>, extra: Partial<Parameters<typeof runPaidGateReplay>[0]["deps"]> = {}) {
  const shadows: Array<{ record: GateShadowRecord; context: unknown }> = [];
  const answer = vi.fn(async (id: number) => answered(id));
  const pickProQuestions = vi.fn(async () => [{ institutionId: 1001, question: "Is our overdraft fee high for our size?", askedAt: "2026-10-20T12:00:00.000Z" }]);
  return {
    shadows, answer, pickProQuestions,
    deps: {
      pickProQuestions,
      pickInstitutions: async () => [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008].map((id) => ({ id, name: `Bank ${id}`, stateCode: "TN", charterType: "bank", assetTier: "a" })),
      answer,
      prepareReport: async () => prepared,
      client: w.client, written: w.written, writeReport: w.writeReport, live,
      filings: async () => null, comparison: async () => [],
      recordShadow: async (record: GateShadowRecord, context: unknown) => { shadows.push({ record, context }); return 1; },
      batchShadows: async () => shadows.map((s) => s.record),
      preflight: async () => null,
      ceilings: () => ({ ...PAID_REPLAY_CEILING_MICROUSD }),
      ...extra,
    },
  };
}

describe("the one-off paid gate replay batch (#1077)", () => {
  it("is a provider step the tick never starts", () => {
    expect(isProviderStep(PAID_REPLAY_STEP_KEY)).toBe(true);
    expect(TICK_EXCLUDED_STEP_KEYS).toContain(PAID_REPLAY_STEP_KEY);
    expect(PAID_REPLAY_RESERVATION).not.toBe(PAID_EVAL_RESERVATION);
    expect(Object.values(PAID_REPLAY_MIX).reduce((a, b) => a + b, 0)).toBe(PAID_REPLAY_MAX_SAMPLES);
  });

  it("is batch 2026-10-26: 50 written answers and nothing else, from 2026-10-26", () => {
    expect(PAID_REPLAY_BATCH_ID).toBe("2026-10-26");
    expect(PAID_REPLAY_BATCH_START).toBe("2026-10-26T00:00:00.000Z");
    expect(PAID_REPLAY_MAX_SAMPLES).toBe(50);
    expect(PAID_REPLAY_MIX).toEqual({ written_answer: 50, memo: 0, simulate: 0, report: 0 });
    expect(PAID_REPLAY_SUBJECT_PREFIX).toBe("hamilton-replay-paid:2026-10-26:");
  });

  it("caps the batch at $25, and says so in the ledger", async () => {
    expect(PAID_REPLAY_MAX_COST_MICROUSD).toBe(25_000_000);
    const book = ledger();
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, deps: deps(book, writers(book, { written_answer: 50_000 })).deps });
    expect(summary.caps.costMicrousd).toBe(25_000_000);
    expect(paidReplaySummaryLine(summary)).toContain("of $25.00 charged against the cap");
    // $24.00 charged already: a written answer's $2.88 ceiling no longer fits under $25.
    const full = ledger({ usage: [{ subject_key: `${PAID_REPLAY_SUBJECT_PREFIX}written_answer|old`, agent_run_id: 400, microusd: 24_000_000 }] });
    expect(await reservePaidReplaySample(full.db, { runId: RUN, path: "written_answer", sampleKey: "written_answer|x", now: NOW, base: { ...PAID_REPLAY_CEILING_MICROUSD } }))
      .toEqual({ reserved: false, reason: "spend_cap" });
    // $22.00: it fits ($24.88).
    const room = ledger({ usage: [{ subject_key: `${PAID_REPLAY_SUBJECT_PREFIX}written_answer|old`, agent_run_id: 400, microusd: 22_000_000 }] });
    expect(await reservePaidReplaySample(room.db, { runId: RUN, path: "written_answer", sampleKey: "written_answer|x", now: NOW, base: { ...PAID_REPLAY_CEILING_MICROUSD } }))
      .toEqual({ reserved: true });
  });

  it("never reserves a memo, Simulate or report sample, and never reads or writes one", async () => {
    const book = ledger();
    for (const path of ["memo", "simulate", "report"] as const) {
      expect(await reservePaidReplaySample(book.db, { runId: RUN, path, sampleKey: `${path}|x`, now: NOW, base: { ...PAID_REPLAY_CEILING_MICROUSD } }))
        .toEqual({ reserved: false, reason: "path_full" });
    }
    const w = writers(book, { written_answer: 50_000 });
    const prepareReport = vi.fn(async () => prepared);
    // Every run until the batch is over.
    for (let i = 0; i < 20 && !(await paidReplayBatchComplete(book.db)); i += 1) {
      await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN + i, deps: deps(book, w, { prepareReport }).deps });
    }
    expect(book.reservations().length).toBe(PAID_REPLAY_MAX_SAMPLES);
    expect(book.reservations().every((e) => e.detail.path === "written_answer")).toBe(true);
    expect(w.calls).toEqual({ written_answer: 50, memo: 0, simulate: 0, report: 0 });
    expect(prepareReport).not.toHaveBeenCalled();
    expect(w.operations.every((op) => op === "written_answer_replay")).toBe(true);
  });

  it("is complete (\"samples\") once 50 written answers are in, though every other path has none", async () => {
    const book = ledger();
    const w = writers(book, { written_answer: 50_000 });
    const summaries = [];
    for (let i = 0; i < 20; i += 1) {
      const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN + i, deps: deps(book, w).deps });
      summaries.push(summary);
      if (summary.complete) break;
    }
    const last = summaries.at(-1)!;
    expect(last).toMatchObject({ complete: true, completeReason: "samples", reserved: { total: 50, byPath: { written_answer: 50, memo: 0, simulate: 0, report: 0 } } });
    expect(w.calls.written_answer).toBe(50);
    expect(await paidReplayBatchComplete(book.db)).toBe(true);
    expect(paidReplaySummaryLine(last)).toContain("50/50 written answers");
    expect(paidReplaySummaryLine(last)).not.toContain("memos");
    // The next run starts nothing.
    const again = writers(book);
    const next = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN + 99, deps: deps(book, again).deps });
    expect(next).toMatchObject({ complete: true, completeReason: "already", results: [] });
    expect(Object.values(again.calls).every((n) => n === 0)).toBe(true);
  });

  it("counts nothing of the 2026-10-25 batch: its reservations, its $39.47 and its shadows", async () => {
    const oldSubject = `hamilton-replay-paid:${OLD_BATCH}:written_answer|old`;
    const book = ledger({
      events: [{ agent_run_id: 300, event_type: PAID_REPLAY_RESERVATION, detail: { batch_id: OLD_BATCH, sample_key: "written_answer|old", path: "written_answer" }, created_at: "2026-10-26T01:00:00.000Z" }],
      usage: [{ subject_key: oldSubject, agent_run_id: 300, microusd: 39_470_000 }],
    });
    const oldShadow = { version: 1 as const, origin: "replay_paid" as const, surface: "written_answer" as const, path: "written_streaming" as const, mode: "analyze", today: "shown" as const,
      unified: "held" as const, agrees: false, disagreement: "unified_holds" as const, codes: [], critical: [], cause: false, corrections: 0 };
    storedShadows.rows = [
      { record: oldShadow, key: oldSubject },
      { record: { ...oldShadow, unified: "validated", agrees: true, disagreement: null }, key: subjectKeyFor("written_answer|new") },
    ];
    const w = writers(book, { written_answer: 50_000 });
    const d = deps(book, w);
    const { batchShadows: _own, ...rest } = d.deps;
    void _own;
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, deps: rest });
    storedShadows.rows = [];
    expect(summary.reservedBefore).toBe(0);
    expect(summary.results.length).toBeGreaterThan(0);
    expect(summary.spentMicrousd).toBe(50_000 * summary.results.length);
    expect(summary.chargedMicrousd).toBeLessThan(PAID_REPLAY_MAX_COST_MICROUSD);
    // The default shadow read keeps this batch's sample keys only.
    expect(summary.shadows?.total).toBe(1);
    expect(summary.shadows?.bySurface.written_answer?.validated).toBe(1);
  });

  it("starts nothing for a run of the 2026-10-25 batch left queued, and never picks one up as this batch's", async () => {
    const book = ledger();
    const w = writers(book);
    const d = deps(book, w);
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, runBatchId: OLD_BATCH, deps: d.deps });
    expect(d.pickProQuestions).not.toHaveBeenCalled();
    expect(Object.values(w.calls).every((n) => n === 0)).toBe(true);
    expect(book.reservations()).toHaveLength(0);
    expect(summary).toMatchObject({ complete: false, completeReason: null, results: [] });
    expect(summary.stopped).toContain(OLD_BATCH);
    // A run of this batch runs as before.
    const own = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN + 1, runBatchId: PAID_REPLAY_BATCH_ID, deps: deps(book, writers(book)).deps });
    expect(own.results.length).toBeGreaterThan(0);
    // The active-run read is scoped to this batch's runs.
    const seen: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => { seen.push({ text: parts.join("?"), values }); return []; }) as unknown as SqlTag;
    expect(await activePaidReplayRun(db)).toBeNull();
    expect(seen[0].text).toContain("params_json->>'batch_id' = ?");
    expect(seen[0].values).toContain(PAID_REPLAY_BATCH_ID);
  });

  it("writes only written answers, reserves each sample before its call, and records every shadow as replay_paid", async () => {
    const book = ledger();
    const w = writers(book, { written_answer: 50_000, memo: 20_000, simulate: 5_000, report: 30_000 });
    const d = deps(book, w);
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, deps: d.deps });
    expect(summary.results.length).toBeGreaterThan(0);
    // Every call made had its reservation; none twice.
    const keys = book.reservations().map((e) => e.detail.sample_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(summary.results.length).toBe(keys.length);
    // Every reservation, granted or refused, took the batch's lock.
    expect(book.state.locks).toBeGreaterThanOrEqual(keys.length);
    // Written answers only: every other path's share is 0.
    expect(w.calls.written_answer).toBeGreaterThan(0);
    expect({ memo: w.calls.memo, simulate: w.calls.simulate, report: w.calls.report }).toEqual({ memo: 0, simulate: 0, report: 0 });
    // Shadows: the batch's origin only, each naming its sample.
    expect(d.shadows.length).toBeGreaterThan(0);
    expect(d.shadows.every((s) => s.record.origin === "replay_paid")).toBe(true);
    expect(d.shadows.every((s) => String((s.context as { replayKey?: string }).replayKey).startsWith(PAID_REPLAY_SUBJECT_PREFIX))).toBe(true);
    // The batch's own operations, never the daily eval's.
    expect(w.operations).toContain("written_answer_replay");
    expect(w.operations).not.toContain(PAID_EVAL_WRITTEN_OPERATION);
    // Every batch call books as hamilton_replay, off the live readers' lines.
    expect(w.ledgers.length).toBeGreaterThan(0);
    expect(w.ledgers.every((agent) => agent === "hamilton_replay")).toBe(true);
    expect(summary.shadows?.bySurface.written_answer?.total).toBe(w.calls.written_answer);
    const line = paidReplaySummaryLine(summary);
    expect(line).toContain(`of ${PAID_REPLAY_MAX_SAMPLES} samples reserved`);
    expect(line).toContain("of $25.00 charged against the cap");
    expect(line).toContain("Shadow gate by surface (validated/partial/held): ");
  });

  it("stops at 50 samples: with 49 held it writes one, and the batch is complete", async () => {
    const events = held("written_answer", 49);
    // Each held sample finished clean at $0.10, so the batch's charge is $4.90 and the last sample fits.
    const usage = events.filter((e) => e.event_type === PAID_REPLAY_RESERVATION)
      .map((e) => ({ subject_key: subjectKeyFor(String(e.detail.sample_key)), agent_run_id: 400, microusd: 100_000 }));
    const book = ledger({ events, usage });
    const w = writers(book);
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, deps: deps(book, w).deps });
    expect(w.calls).toEqual({ written_answer: 1, memo: 0, simulate: 0, report: 0 });
    expect(book.reservations()).toHaveLength(PAID_REPLAY_MAX_SAMPLES);
    expect(summary).toMatchObject({ complete: true, completeReason: "samples", reserved: { total: 50 } });
    expect(await paidReplayBatchComplete(book.db)).toBe(true);
  });

  it("never passes $25: it refuses the sample whose ceiling would, and calls it complete once none fits", async () => {
    // $19 spent already; each sample costs its full ceiling, so two fit ($24.76) and a third does not.
    const book = ledger({ usage: [{ subject_key: `${PAID_REPLAY_SUBJECT_PREFIX}written_answer|old`, agent_run_id: 400, microusd: 19_000_000 }] });
    const w = writers(book, { ...PAID_REPLAY_CEILING_MICROUSD });
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, deps: deps(book, w).deps });
    const spent = book.state.usage.reduce((sum, u) => sum + (u.microusd ?? 0), 0);
    expect(spent).toBeLessThanOrEqual(PAID_REPLAY_MAX_COST_MICROUSD);
    expect(summary.spentMicrousd).toBe(spent);
    expect(summary.results.length).toBeGreaterThan(0);
    expect(summary).toMatchObject({ complete: true, completeReason: "cost" });
    // A second run starts nothing.
    const again = writers(book);
    const second = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN + 1, deps: deps(book, again).deps });
    expect(Object.values(again.calls).every((n) => n === 0)).toBe(true);
    expect(second.results).toEqual([]);
  });

  it("starts nothing once $24.95 is spent", async () => {
    const book = ledger({ usage: [{ subject_key: `${PAID_REPLAY_SUBJECT_PREFIX}written_answer|old`, agent_run_id: 400, microusd: 24_950_000 }] });
    const w = writers(book);
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, deps: deps(book, w).deps });
    expect(Object.values(w.calls).every((n) => n === 0)).toBe(true);
    expect(book.reservations()).toHaveLength(0);
    expect(summary).toMatchObject({ complete: true, completeReason: "cost" });
  });

  it("charges a sample still in flight, or killed, its full ceiling, so a concurrent run cannot spend it twice", async () => {
    // $20.00 recorded and one written answer reserved two minutes ago with no done mark: it is charged its $2.88.
    const flying = { agent_run_id: 400, event_type: PAID_REPLAY_RESERVATION, detail: { batch_id: PAID_REPLAY_BATCH_ID, sample_key: "written_answer|flying", path: "written_answer" }, created_at: "2026-10-26T17:58:00.000Z" };
    const usage = [{ subject_key: `${PAID_REPLAY_SUBJECT_PREFIX}written_answer|old`, agent_run_id: 400, microusd: 20_000_000 }];
    const book = ledger({ usage, events: [flying] });
    const base = { ...PAID_REPLAY_CEILING_MICROUSD };
    // $20.00 + $2.88 held + $2.88 for another written answer passes $25; without the flying sample it fits.
    expect(await reservePaidReplaySample(book.db, { runId: RUN, path: "written_answer", sampleKey: "written_answer|x", now: NOW, base })).toEqual({ reserved: false, reason: "spend_cap" });
    expect(await reservePaidReplaySample(ledger({ usage }).db, { runId: RUN, path: "written_answer", sampleKey: "written_answer|x", now: NOW, base })).toEqual({ reserved: true });
    // Fifteen minutes on the flying sample is taken as killed: it no longer counts in flight, but it keeps its ceiling.
    const later = new Date("2026-10-26T18:20:00Z");
    expect(await reservePaidReplaySample(book.db, { runId: RUN, path: "written_answer", sampleKey: "written_answer|x", now: later, base })).toEqual({ reserved: false, reason: "spend_cap" });
  });

  it("keeps a failed, NULL-cost or unrecorded sample at its full ceiling; only a clean finished sample counts as recorded", () => {
    const base = { ...PAID_REPLAY_CEILING_MICROUSD };
    const done = (key: string, path: PaidPath = "written_answer") => ({ path, sampleKey: key, createdAt: NOW.toISOString(), done: true });
    const usage = (entries: Array<[string, { microusd: number; rows: number; clean: number }]>) => {
      const bySubject = new Map(entries.map(([k, v]) => [subjectKeyFor(k), v]));
      return { total: [...bySubject.values()].reduce((a, b) => a + b.microusd, 0), bySubject };
    };
    const state = { reservations: [done("clean"), done("failed"), done("null_cost"), done("no_rows")] };
    const spend = usage([
      ["clean", { microusd: 200_000, rows: 3, clean: 3 }],
      // A 429 after two tool steps: two completed rows and one failed row with unknown usage.
      ["failed", { microusd: 150_000, rows: 3, clean: 2 }],
      // An aborted call recorded with a NULL cost: counts $0 in the sum, never in the charge.
      ["null_cost", { microusd: 0, rows: 1, clean: 0 }],
      // "no_rows": the usage insert failed, so the sample has no row at all.
    ]);
    const ceilings = pathCeilings(state, spend, base);
    expect(batchCharge(state, spend, ceilings)).toBe(200_000 + 3 * base.written_answer);
    // A sample that recorded more than its ceiling is charged what it recorded.
    const over = usage([["failed", { microusd: 3_000_000, rows: 2, clean: 1 }]]);
    expect(batchCharge({ reservations: [done("failed")] }, over, pathCeilings({ reservations: [done("failed")] }, over, base))).toBe(3_000_000);
    // A clean sample costlier than the ceiling raises its path's ceiling.
    const dear = usage([["clean", { microusd: 3_200_000, rows: 4, clean: 4 }]]);
    expect(pathCeilings({ reservations: [done("clean")] }, dear, base).written_answer).toBe(3_200_000);
  });

  it("charges a sample whose written answer failed after spending, end to end", async () => {
    // $20.00 recorded; the writer's call fails with unknown usage (a NULL-cost failed row) and returns unavailable.
    const book = ledger({ usage: [{ subject_key: `${PAID_REPLAY_SUBJECT_PREFIX}written_answer|old`, agent_run_id: 400, microusd: 20_000_000 }] });
    const w = writers(book);
    let calls = 0;
    const failing: WrittenAnswerWriter = async (input) => {
      calls += 1;
      book.state.usage.push({ subject_key: input.tracking?.subjectKey ?? null, agent_run_id: RUN, microusd: null, status: "failed" });
      return { status: "unavailable", reason: "the call was aborted at 180 s" };
    };
    const summary = await runPaidGateReplay({
      db: book.db, now: () => NOW, agentRunId: RUN,
      deps: deps(book, w, { written: failing, preflight: async (path) => (path === "written_answer" ? null : "only written answers in this test") }).deps,
    });
    // $20.00 + $2.88 fits once; after that failed sample is charged its $2.88, a second does not fit.
    expect(calls).toBe(1);
    expect(summary.spentMicrousd).toBe(20_000_000);
    expect(summary.chargedMicrousd).toBe(20_000_000 + PAID_REPLAY_CEILING_MICROUSD.written_answer);
  });

  it("holds the batch-wide in-flight cap across runs", async () => {
    const flying = Array.from({ length: PAID_REPLAY_MAX_IN_FLIGHT }, (_, i) => ({
      agent_run_id: 400 + i, event_type: PAID_REPLAY_RESERVATION,
      detail: { batch_id: PAID_REPLAY_BATCH_ID, sample_key: `written_answer|flying-${i}`, path: "written_answer" }, created_at: "2026-10-26T17:59:00.000Z",
    }));
    const book = ledger({ events: flying });
    const base = { ...PAID_REPLAY_CEILING_MICROUSD };
    expect(await reservePaidReplaySample(book.db, { runId: RUN, path: "written_answer", sampleKey: "written_answer|x", now: NOW, base })).toEqual({ reserved: false, reason: "in_flight" });
    const w = writers(book);
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, deps: deps(book, w).deps });
    expect(Object.values(w.calls).every((n) => n === 0)).toBe(true);
    expect(summary.stopped).toContain("in flight");
    expect(summary.complete).toBe(false);
  });

  it("returns the real reason when the guarded insert refuses on a stale read", async () => {
    const book = ledger({ events: held("written_answer", PAID_REPLAY_MIX.written_answer) });
    // The decision's read misses the other runs' reservations; the insert still refuses, and says why.
    book.state.staleReads = 1;
    expect(await reservePaidReplaySample(book.db, { runId: RUN, path: "written_answer", sampleKey: "written_answer|new", now: NOW, base: { ...PAID_REPLAY_CEILING_MICROUSD } }))
      .toEqual({ reserved: false, reason: "count_cap" });
  });

  it("prices each path's worst case from its own limits, never below the floor", () => {
    expect(PAID_REPLAY_WORST_CASE.written_answer).toMatchObject({ calls: 4, outputTokens: 16_000 });
    const opus55 = baseCeilings({ hamilton: "claude-opus-5-5", pro: "claude-opus-5-5" });
    // 4 x 16,000 output at $20/M is $1.28 alone; with 4 x 80,000 input written to the cache at $5/M, $2.88.
    expect(opus55.written_answer).toBe(2_880_000);
    expect(opus55).toEqual(PAID_REPLAY_CEILING_MICROUSD);
    // A pricier configured model raises the ceiling.
    expect(baseCeilings({ hamilton: "claude-opus-4-6", pro: "claude-opus-4-6" }).written_answer).toBeGreaterThan(2_880_000);
  });

  it("reserves a sample key once, however often it is retried", async () => {
    const book = ledger();
    const input = { runId: RUN, path: "written_answer" as const, sampleKey: "written_answer|2026-10-26:2001:q01", now: NOW };
    expect(await reservePaidReplaySample(book.db, input)).toEqual({ reserved: true });
    expect(await reservePaidReplaySample(book.db, input)).toEqual({ reserved: false, reason: "duplicate" });
    expect(await reservePaidReplaySample(book.db, { ...input, runId: RUN + 1 })).toEqual({ reserved: false, reason: "duplicate" });
    expect(book.reservations()).toHaveLength(1);
  });

  it("refuses a path whose share is 0 from the start", async () => {
    const book = ledger();
    expect(await reservePaidReplaySample(book.db, { runId: RUN, path: "simulate", sampleKey: "simulate|new", now: NOW })).toEqual({ reserved: false, reason: "path_full" });
    expect(book.reservations()).toHaveLength(0);
  });

  it("a second run picks up where the first stopped and never writes a sample twice", async () => {
    const book = ledger();
    const first = writers(book);
    // The first run's budget lines refuse after a few samples, so it stops part way.
    let allowed = 3;
    const first_ = await runPaidGateReplay({
      db: book.db, now: () => NOW, agentRunId: RUN,
      deps: deps(book, first, { preflight: async () => (allowed-- > 0 ? null : "daily cap spent") }).deps,
    });
    const afterFirst = book.reservations().length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterFirst).toBeLessThan(PAID_REPLAY_MAX_SAMPLES);
    expect(first_.complete).toBe(false);
    const second = writers(book);
    await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN + 1, deps: deps(book, second).deps });
    const keys = book.reservations().map((e) => e.detail.sample_key);
    expect(keys.length).toBeGreaterThan(afterFirst);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never runs once the batch is complete: no question is read and no writer is called", async () => {
    for (const book of [ledger({ finished: [{ complete: true }] }), ledger({ events: held("written_answer", 50) })]) {
      const w = writers(book);
      const d = deps(book, w);
      const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN, deps: d.deps });
      expect(d.pickProQuestions).not.toHaveBeenCalled();
      expect(d.answer).not.toHaveBeenCalled();
      expect(Object.values(w.calls).every((n) => n === 0)).toBe(true);
      expect(summary).toMatchObject({ complete: true, completeReason: "already", results: [] });
      expect(await paidReplayBatchComplete(book.db)).toBe(true);
    }
  });

  it("does not use up reservations on a path whose budget line refuses", async () => {
    const book = ledger();
    const w = writers(book);
    const summary = await runPaidGateReplay({
      db: book.db, now: () => NOW, agentRunId: RUN,
      deps: deps(book, w, { preflight: async (path) => (path === "written_answer" ? "api.research.hamilton daily cap spent" : null) }).deps,
    });
    expect(w.calls.written_answer).toBe(0);
    expect(book.reservations().filter((e) => e.detail.path === "written_answer")).toHaveLength(0);
    expect(summary.blocked.written_answer).toContain("daily cap");
    expect(summary.complete).toBe(false);
  });

  it("keeps questions the free engine failed on, and never ends the batch over a fault", async () => {
    const book = ledger();
    const w = writers(book);
    const summary = await runPaidGateReplay({
      db: book.db, now: () => NOW, agentRunId: RUN,
      deps: deps(book, w, { answer: async () => { throw new Error("db down"); } }).deps,
    });
    expect(summary.settledKeys).toEqual([]);
    expect(summary.erroredKeys.length).toBeGreaterThan(0);
    expect(book.reservations()).toHaveLength(0);
    expect(summary.complete).toBe(false);
    expect(summary.stopped).toMatch(/free-read errors|free reads failed/);
  });

  it("leaves a free read still running at the start window for a later run, without counting it a failure", async () => {
    const book = ledger();
    const w = writers(book);
    const summary = await runPaidGateReplay({
      db: book.db, now: () => NOW, agentRunId: RUN, startWindowMs: 300,
      deps: deps(book, w, { answer: () => new Promise<never>(() => {}) }).deps,
    });
    expect(summary.deferredKeys.length).toBeGreaterThan(0);
    expect(summary.erroredKeys).toEqual([]);
    expect(book.reservations()).toHaveLength(0);
    expect(summary.complete).toBe(false);
  });

  it("defers a sample read after the start window closed, so the next run moves on (2026-10-26 stall)", async () => {
    const book = ledger();
    const w = writers(book);
    const d = deps(book, w);
    // The read itself is quick; the window closes while the budget check runs, after the sample is read.
    const slowCheck = async () => { await new Promise((r) => setTimeout(r, 600)); return null; };
    const summary = await runPaidGateReplay({
      db: book.db, now: () => NOW, agentRunId: RUN, startWindowMs: 300,
      deps: { ...d.deps, preflight: slowCheck },
    });
    expect(book.reservations()).toHaveLength(0);
    expect(summary.deferredKeys.length).toBeGreaterThan(0);
    expect(summary.erroredKeys).toEqual([]);
    expect(summary.stopped).toMatch(/start window/);
    // The next run puts those keys last, so the samples it reserves are questions it has not tried.
    const later = ledger({ finished: [{ deferred: summary.deferredKeys }] });
    await runPaidGateReplay({ db: later.db, now: () => NOW, agentRunId: RUN + 1, deps: deps(later, writers(later)).deps });
    expect(later.reservations().length).toBeGreaterThan(0);
    const keys = new Set(summary.deferredKeys);
    expect(later.reservations().every((e) => !keys.has(String(e.detail.sample_key)))).toBe(true);
  });

  it("never passes a question over, or calls the batch complete, because windows keep closing", async () => {
    const book = ledger();
    const w = writers(book);
    const slowCheck = async () => { await new Promise((r) => setTimeout(r, 5)); return null; };
    let last: Awaited<ReturnType<typeof runPaidGateReplay>> | null = null;
    for (let run = 0; run < 12; run += 1) {
      last = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN + run, startWindowMs: 1, deps: { ...deps(book, w).deps, preflight: slowCheck } });
      book.state.finished.push({ keys: last.settledKeys, errored: last.erroredKeys, deferred: last.deferredKeys, complete: last.complete });
    }
    expect(book.reservations()).toHaveLength(0);
    expect(book.state.finished.every((f) => (f.errored ?? []).length === 0)).toBe(true);
    expect(last!.complete).toBe(false);
    expect(last!.completeReason).toBeNull();
    // Once windows stop closing early, every deferred question can still be written up.
    const summary = await runPaidGateReplay({ db: book.db, now: () => NOW, agentRunId: RUN + 99, deps: deps(book, w).deps });
    expect(book.reservations().length).toBeGreaterThan(0);
    expect(summary.results.length).toBeGreaterThan(0);
  });

  it("keeps a question whose free reads fail for a later run, and passes it over only after three failed runs", async () => {
    const book = ledger({ finished: [] });
    const w = writers(book);
    const summary = await runPaidGateReplay({
      db: book.db, now: () => NOW, agentRunId: RUN,
      deps: deps(book, w, { answer: async () => { throw new Error("statement timeout"); } }).deps,
    });
    expect(w.calls.written_answer).toBe(0);
    expect(summary.settledKeys).toEqual([]);
    expect(summary.erroredKeys.every((k) => k.startsWith("written_answer|"))).toBe(true);
    expect(summary.blocked.written_answer).toContain("free reads failed");
    expect(summary.complete).toBe(false);
    // The same key failing in three runs is passed over for good.
    const key = summary.erroredKeys[0];
    const later = ledger({ finished: [{ errored: [key] }, { errored: [key] }, { errored: [key] }] });
    const lw = writers(later);
    await runPaidGateReplay({ db: later.db, now: () => NOW, agentRunId: RUN + 1, deps: deps(later, lw).deps });
    expect(lw.calls.written_answer).toBeGreaterThan(0);
    expect(later.reservations().map((e) => e.detail.sample_key)).not.toContain(key);
  });

  it("passes over questions a path cannot write up and keeps them for later runs", async () => {
    const book = ledger();
    const w = writers(book);
    const summary = await runPaidGateReplay({
      db: book.db, now: () => NOW, agentRunId: RUN,
      deps: deps(book, w, { answer: vi.fn(async (id: number) => ({ ...answered(id), research: null })) }).deps,
    });
    expect(w.calls.written_answer).toBe(0);
    expect(summary.settledKeys.length).toBeGreaterThan(0);
    expect(summary.settledKeys.every((k) => k.startsWith("written_answer|"))).toBe(true);
    expect(PAID_REPLAY_SOURCE).toBe("hamilton.paid_gate_replay");
  });
});

describe("the batch stays apart from the daily eval and the free replay", () => {
  it("counts replay_paid shadows on their own", () => {
    const base = { version: 1 as const, surface: "written_answer" as const, path: "written_streaming" as const, mode: "analyze", today: "shown" as const,
      unified: "held" as const, agrees: false, disagreement: "unified_holds" as const, codes: [], critical: [], cause: false, corrections: 0 };
    const tally = tallyGateShadow([{ ...base, origin: "replay_paid" }, { ...base, origin: "replay_paid" }, { ...base, origin: "paid_eval" }, { ...base, origin: "replay" }]);
    expect(tally.byOrigin.replay_paid.total).toBe(2);
    expect(tally.byOrigin.paid_eval.total).toBe(1);
    expect(tally.byOrigin.replay.total).toBe(1);
    expect(tally.byOrigin.reader.total).toBe(0);
  });

  it("leaves the daily eval as it was: its origin, its operations and its own reservations", async () => {
    // The daily eval's ledger double: it counts only its own event type, so the batch's reservations never use up its five.
    const queries: string[] = [];
    const daily = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      queries.push(text);
      expect(values).not.toContain(PAID_REPLAY_RESERVATION);
      if (text.includes("INSERT INTO agent_run_events")) return [{ id: 1 }];
      return text.includes("COUNT(*)") ? [{ n: 0 }] : [];
    }) as unknown as SqlTag;
    const book = ledger();
    const w = writers(book);
    const records: GateShadowRecord[] = [];
    const answerEval = await import("./answer-eval");
    const answerSpy = vi.spyOn(answerEval, "answer").mockImplementation(async (id: number) => answered(id) as never);
    const proSpy = vi.spyOn(answerEval, "pickProQuestions").mockResolvedValue([]);
    const instSpy = vi.spyOn(answerEval, "pickEvalInstitutions").mockResolvedValue([1001, 1002, 1003].map((id) => ({ id, name: `Bank ${id}`, stateCode: "TN", charterType: "bank", assetTier: "a" })));
    try {
      await runPaidAnswerEval({
        db: daily, now: NOW, client: w.client, live, agentRunId: 77, written: w.written,
        prepareReport: async () => prepared, writeReport: w.writeReport, comparison: async () => [],
        recordShadow: async (record) => { records.push(record); },
        countShadows: async () => tallyGateShadow(records),
      });
    } finally {
      answerSpy.mockRestore(); proSpy.mockRestore(); instSpy.mockRestore();
    }
    expect(queries.some((q) => q.includes("INSERT INTO agent_run_events"))).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.origin === "paid_eval")).toBe(true);
    expect(w.operations).toContain(PAID_EVAL_WRITTEN_OPERATION);
    expect(w.operations.some((op) => op.endsWith("_replay"))).toBe(false);
    // The daily eval keeps its paths' own budget lines.
    expect(w.ledgers.every((agent) => agent === "own")).toBe(true);
  });
});
