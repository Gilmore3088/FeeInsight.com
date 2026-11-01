import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAskResponse, parseAsk } from "./workspace/ask";
import { overdraftResearch } from "./workspace/test-fixtures";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import type { FilingReader, LiveReader } from "./answer-correctness";
import type { MemoClient } from "./memo";
import type { WrittenAnswerWriter } from "./written-answer-read";
import type { PreparedReportAnswer, ReportAnswerWriter } from "./report-answer-read";

// Invented institutions, questions and figures for tests only; nothing here is live data.
const evalMocks = vi.hoisted(() => ({
  answer: vi.fn(),
  pickProQuestions: vi.fn(),
  pickEvalInstitutions: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("./answer-eval", async (importOriginal) => ({ ...(await importOriginal<typeof import("./answer-eval")>()), ...evalMocks }));
// No report unless a test hands one in: the real preparation reads the database.
vi.mock("./report-answer-read", async (importOriginal) => ({ ...(await importOriginal<typeof import("./report-answer-read")>()), prepareReportAnswer: async () => null }));

const { orderCandidates, paidSamplesToday, reserveSample, runPaidAnswerEval, shadowCountsLine, simulateInputFor, toolMoneyFigures, PAID_EVAL_RESERVATION } = await import("./paid-answer-eval");
const { tallyGateShadow } = await import("./output-gate-shadow");
const { reportSectionGateShadow } = await import("./generate");
type GateShadowRecord = import("./output-gate-shadow").GateShadowRecord;

const now = new Date("2026-10-16T15:17:00Z");
const question = "How does our overdraft fee compare?";

function answered(institutionId: number) {
  const research = overdraftResearch({ institutionId });
  const response = buildAskResponse({ question, intent: parseAsk(question), research, memory: [] });
  return { response, research, schedule: null };
}

/** The bank's own live row and one per member it is compared with, matching the research. */
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

function memoClient(summary: string, simulateText = "At the tested price the fee sits at the peer median. The question for management is notice."): MemoClient & { calls: number; simulateCalls: number } {
  const client = {
    calls: 0,
    simulateCalls: 0,
    async create({ system, user }: { system: string; user: string; model: string }) {
      if (system.includes("THIS ANSWER: a short read of one price")) {
        client.simulateCalls += 1;
        return simulateText;
      }
      client.calls += 1;
      // Cite the first evidence record the memo was given, as a well-formed memo does.
      const data = JSON.parse(user.slice(user.indexOf("DATA:\n") + 6).split("\n\n")[0]) as { fact_evidence?: { facts: Array<{ id: string }> } };
      const ids = data.fact_evidence?.facts.slice(0, 1).map((f) => f.id) ?? [];
      return JSON.stringify({ summary, board: "The board weighs notice and complaints.", market: "Marketing compares the schedule.", questions: ["What notice applies?"], evidence_fact_ids: ids });
    },
  };
  return client;
}

/** A written answer writer that returns `text` written from `toolResults`, counting its calls. */
function writtenWriter(
  text = "Your overdraft fee is $32.",
  toolResults: Array<{ toolName: string; output: unknown }> = [{ toolName: "searchFees", output: { fee_category: "overdraft", amount: 32 } }],
): WrittenAnswerWriter & { calls: number } {
  const writer = Object.assign(
    async () => {
      writer.calls += 1;
      const { checkAnswerEvidence } = await import("./answer-gate");
      return { status: "written" as const, text, toolResults, check: checkAnswerEvidence(text, toolResults.map((r) => r.output)) };
    },
    { calls: 0 },
  );
  return writer;
}

/**
 * A db holding today's reservations: the count reads them and the conditional insert adds one
 * only while fewer than the cap in the query are held, as the SQL does.
 */
function db(used: number, usedPaths: string[] = Array(used).fill("memo")) {
  const queries: string[] = [];
  const state = { reserved: used, paths: [...usedPaths] };
  const tag = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    queries.push(text);
    if (text.includes("INSERT INTO agent_run_events")) {
      const cap = Number(values.at(-1));
      // The values end: ..., path, pathLimit, event type, day start, cap.
      const [path, pathLimit] = [String(values.at(-5)), Number(values.at(-4))];
      if (state.reserved >= cap || state.paths.filter((p) => p === path).length >= pathLimit) return [];
      state.reserved += 1;
      state.paths.push(String((JSON.parse(String(values.find((v) => typeof v === "string" && v.startsWith("{")))) as { path: string }).path));
      return [{ id: state.reserved }];
    }
    if (text.includes("detail ->> 'path'")) return [{ n: state.paths.filter((p) => p === values.at(-1)).length }];
    return text.includes("COUNT(*)") ? [{ n: state.reserved }] : [];
  });
  return { db: tag as unknown as Parameters<typeof paidSamplesToday>[0], queries, state };
}

beforeEach(() => {
  evalMocks.answer.mockReset();
  evalMocks.pickProQuestions.mockResolvedValue([]);
  // The fixture numbers its peers from 1, so the sampled banks get ids of their own.
  evalMocks.pickEvalInstitutions.mockResolvedValue([1001, 1002, 1003, 1004, 1005, 1006, 1007].map((id) => ({ id, name: `Bank ${id}`, stateCode: "TN", charterType: "bank", assetTier: "a" })));
});

describe("Hamilton's paid answer eval (#1079)", () => {
  it("counts today's reservations from the run ledger", async () => {
    const { db: tag, queries } = db(3);
    expect(await paidSamplesToday(tag, now)).toBe(3);
    expect(queries[0]).toContain("FROM agent_run_events");
    expect(queries[0]).toContain("event_type =");
  });

  it("writes nothing once the day's five are used", async () => {
    const client = memoClient("Unused.");
    const result = await runPaidAnswerEval({ db: db(5).db, now, client, live, agentRunId: 77 });
    expect(client.calls).toBe(0);
    expect(evalMocks.answer).not.toHaveBeenCalled();
    expect(result.note).toBe("Today's 5 paid samples are already used.");
  });

  it("writes only the day's remaining samples and scores form and correctness", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const client = memoClient("Your overdraft fee is $32.");
    // Today's Simulate read is already used, so both remaining samples are memos.
    const result = await runPaidAnswerEval({ db: db(3, ["memo", "simulate", "written_answer"]).db, now, client, live, agentRunId: 77 });
    expect(client.calls).toBe(2);
    expect(client.simulateCalls).toBe(0);
    expect(result.paths[0]).toMatchObject({ path: "memo", sampled: 2, answers: 2, passed: 2, correctness: { checked: 2, correct: 2, rate: 1 } });
    expect(result.notSampled).toEqual([]);
  });

  it("fails form when the memo is withheld for a figure the storyline does not hold", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const result = await runPaidAnswerEval({ db: db(4, ["memo", "memo", "simulate", "written_answer"]).db, now, client: memoClient("Your overdraft fee is $32; peers charge $91.37."), live, agentRunId: 77 });
    expect(result.paths[0]).toMatchObject({ answers: 1, passed: 0, correctness: { checked: 0 } });
    expect(result.results[0].status).toBe("withheld");
  });

  it("fails correctness when the memo matches its storyline but the live catalog has moved", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    // The live row now says $29 for the bank's own fee; the storyline and memo still say $32.
    const moved: LiveReader = async (id, research) => {
      const values = await live(id, research);
      return values && { rows: values.rows.map((r, i) => (i === 0 ? { ...r, amount: 29 } : r)) };
    };
    const result = await runPaidAnswerEval({ db: db(4, ["memo", "memo", "simulate", "written_answer"]).db, now, client: memoClient("Your overdraft fee is $32."), live: moved, agentRunId: 77 });
    expect(result.paths[0]).toMatchObject({ passed: 1, correctness: { checked: 1, correct: 0 } });
    expect(result.results[0].correctness).toContain("your fee: the answer uses $32, the catalog has $29");
  });

  it("skips answers with no storyline before spending anything", async () => {
    evalMocks.answer.mockResolvedValue({ response: { answer: null }, research: null, schedule: null });
    const client = memoClient("Unused.");
    const result = await runPaidAnswerEval({ db: db(0).db, now, client, live, agentRunId: 77 });
    expect(client.calls).toBe(0);
    expect(result.note).toBe("No sampled question produced an answer to write up.");
  });

  it("puts Pro readers' questions first and rotates both lists by the day", () => {
    const pro = [{ institutionId: 9, question: "a" }, { institutionId: 8, question: "b" }];
    const today = orderCandidates(pro, [1, 2], now);
    const tomorrow = orderCandidates(pro, [1, 2], new Date("2026-10-17T15:17:00Z"));
    expect(today.slice(0, 2).map((c) => c.from)).toEqual(["pro", "pro"]);
    expect(today[0].question).not.toBe(tomorrow[0].question);
    expect(today[2].from).not.toBe(tomorrow[2].from);
  });

  it("refuses a second Simulate, written answer or report on the same day, and takes the day's lock first (#1414, #1418)", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const day = db(1, ["simulate"]);
    expect(await reserveSample(day.db, { runId: 1, subjectKey: "a", cap: 5, now, path: "simulate" })).toBe(false);
    expect(await reserveSample(day.db, { runId: 1, subjectKey: "b", cap: 5, now, path: "written_answer" })).toBe(true);
    expect(await reserveSample(day.db, { runId: 1, subjectKey: "c", cap: 5, now, path: "written_answer" })).toBe(false);
    expect(await reserveSample(day.db, { runId: 1, subjectKey: "d", cap: 5, now })).toBe(true);
    expect(day.state.paths).toEqual(["simulate", "written_answer", "memo"]);

    // With a real client, the reservation runs in a transaction that takes the day's advisory lock first.
    const order: string[] = [];
    const tx = vi.fn(async (parts: TemplateStringsArray) => {
      order.push(parts.join("?").includes("pg_advisory_xact_lock") ? "lock" : "insert");
      return [{ id: 1 }];
    });
    const begin = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    const real = Object.assign(vi.fn(), { begin }) as unknown as Parameters<typeof reserveSample>[0];
    expect(await reserveSample(real, { runId: 1, subjectKey: "e", cap: 5, now })).toBe(true);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["lock", "insert"]);
  });

  it("reserves each sample before its model call, so memos the provider refused still count", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const refusing: MemoClient = { create: async () => { throw new Error("Provider budget guard blocked this call."); } };
    const day = db(0);
    const refusingWriter: WrittenAnswerWriter = async () => ({ status: "unavailable", reason: "Provider budget guard blocked this call." });
    const first = await runPaidAnswerEval({ db: day.db, now, client: refusing, live, agentRunId: 77, written: refusingWriter });
    expect(first.paths[0]).toMatchObject({ path: "memo", sampled: 3, answers: 0 });
    expect(first.paths[1]).toMatchObject({ path: "simulate", sampled: 1, answers: 0 });
    expect(first.paths[2]).toMatchObject({ path: "written_answer", sampled: 1, answers: 0 });
    expect(day.state.reserved).toBe(5);
    const client = memoClient("Your overdraft fee is $32.");
    const second = await runPaidAnswerEval({ db: day.db, now, client, live, agentRunId: 78 });
    expect(client.calls).toBe(0);
    expect(second.note).toBe("Today's 5 paid samples are already used.");
    expect(day.queries.some((q) => q.includes("INSERT INTO agent_run_events") && q.includes("< "))).toBe(true);
    expect(PAID_EVAL_RESERVATION).toBe("paid_eval.sample_reserved");
  });

  it("spends one of the day's five on a Simulate read, checked by the evidence gate and tied to live values", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const research = overdraftResearch({ institutionId: 1001 });
    const input = simulateInputFor(research)!;
    const median = input.distribution.median_amount!;
    const client = memoClient("Your overdraft fee is $32.", `A $${input.proposedFee.toFixed(2)} fee sits at the peer median of $${median.toFixed(2)}. The question for management is notice.`);
    const day = db(0);
    const result = await runPaidAnswerEval({ db: day.db, now, client, live, agentRunId: 77, written: writtenWriter() });
    expect(client.simulateCalls).toBe(1);
    expect(client.calls).toBe(3);
    expect(day.state.paths.filter((p) => p === "simulate")).toHaveLength(1);
    expect(result.paths[1]).toMatchObject({ path: "simulate", sampled: 1, answers: 1, passed: 1, correctness: { checked: 1, correct: 1 } });
  });

  it("fails a Simulate read's form when it gives advice or a figure it was not given", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const client = memoClient("Your overdraft fee is $32.", "You should raise the fee; peers charge $91.37.");
    const result = await runPaidAnswerEval({ db: db(0).db, now, client, live, agentRunId: 77, written: writtenWriter() });
    expect(result.paths[1]).toMatchObject({ path: "simulate", answers: 1, passed: 0 });
    expect(result.results.find((r) => r.path === "simulate")!.failures.join(" ")).toMatch(/not in DATA/);
    // A read that fails form is not scored for correctness, as with a withheld memo.
    expect(result.results.find((r) => r.path === "simulate")!.correctness).toBeNull();
  });

  it("fails a Simulate read's correctness when it states a p25 the live catalog no longer gives (#1414)", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const input = simulateInputFor(overdraftResearch({ institutionId: 1001 }))!;
    const p25 = input.distribution.p25_amount!;
    // Every peer has moved up $0.37 since the free answer read them; the bank's own fee has not.
    const moved: LiveReader = async (id, research) => {
      const values = await live(id, research);
      return values && { rows: values.rows.map((r, i) => (i === 0 ? r : { ...r, amount: Number(r.amount) + 0.37 })) };
    };
    // The read was given the old p25 (so form passes), but the live peers no longer give it.
    const client = memoClient("Your overdraft fee is $32.", `A $${input.proposedFee.toFixed(2)} fee sits above the peer p25 of $${p25.toFixed(2)}. The question for management is notice.`);
    const result = await runPaidAnswerEval({ db: db(3, ["memo", "memo", "written_answer"]).db, now, client, live: moved, agentRunId: 77 });
    const read = result.results.find((r) => r.path === "simulate")!;
    expect(read.status).toBe("written");
    expect(read.correctness).toEqual([expect.stringMatching(new RegExp(`^figures that tie to no live catalog value: \\$${p25.toFixed(2).replace(".", "\\.")} \\(`))]);
  });

  it("gives the day's last sample to Simulate when one is still wanted (#1414)", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const client = memoClient("Your overdraft fee is $32.");
    const write = writtenWriter();
    const day = db(4, ["memo", "memo", "memo", "memo"]);
    const result = await runPaidAnswerEval({ db: day.db, now, client, live, agentRunId: 77, written: write });
    expect(client.simulateCalls).toBe(1);
    expect(client.calls).toBe(0);
    expect(write.calls).toBe(0);
    expect(day.state.paths.at(-1)).toBe("simulate");
    expect(result.results).toHaveLength(1);
  });

  it("picks the narrowest layer with a full band and tests its median, or $5 above a fee already at it", () => {
    const research = overdraftResearch({ institutionId: 1001 });
    const input = simulateInputFor(research)!;
    expect(input.currentFee).toBe(research.current);
    const atMedian = simulateInputFor({ ...research, current: input.distribution.median_amount })!;
    expect(atMedian.proposedFee).toBe((input.distribution.median_amount as number) + 5);
    expect(simulateInputFor({ ...research, current: null })).toBeNull();
  });

  it("spends one of the day's five on a written answer, checked by the route's evidence gate and tied to live values", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const writer = writtenWriter();
    const day = db(0);
    const result = await runPaidAnswerEval({ db: day.db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writer });
    expect(writer.calls).toBe(1);
    expect(day.state.paths.filter((p) => p === "written_answer")).toHaveLength(1);
    expect(result.paths[2]).toMatchObject({ path: "written_answer", sampled: 1, answers: 1, passed: 1, correctness: { checked: 1, correct: 1 } });
    expect(result.notSampled).toEqual([]);
  });

  it("fails a written answer's form for a figure no tool gave it, and its correctness when it repeats a catalog tool's fee the live catalog does not hold", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const untraced = await runPaidAnswerEval({ db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter("Your overdraft fee is $32; peers charge $91.37.") });
    expect(untraced.paths[2]).toMatchObject({ answers: 1, passed: 0, correctness: { checked: 0 } });
    // A catalog tool said $47.13 and the text repeats it; no live value, statistic or gap holds it, so the text's own figure fails.
    const tool = [{ toolName: "searchFees", output: { fee_category: "overdraft", amount: 47.13 } }];
    const stale = await runPaidAnswerEval({ db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter("A peer charges $47.13.", tool) });
    expect(stale.paths[2]).toMatchObject({ passed: 1, correctness: { checked: 1, correct: 0 } });
    expect(stale.results.find((r) => r.path === "written_answer")!.correctness).toEqual([expect.stringMatching(/^figures that tie to no live catalog value: \$47\.13 \(/)]);
  });

  it("does not write a second written answer once today's is used", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const writer = writtenWriter();
    await runPaidAnswerEval({ db: db(2, ["memo", "written_answer"]).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writer });
    expect(writer.calls).toBe(0);
  });

  it("accepts other-source money as stated, never a catalog tool's fee price, an id or a count", () => {
    expect(toolMoneyFigures([
      { toolName: "searchFees", output: { institution_id: 45, fee_count: 32, median_amount: 30, rows: [{ amount: "29.50" }], service_charge_income: 1200000 } },
      { toolName: "queryNationalData", output: { _shortened: true, text: JSON.stringify({ median: 27, n: 900 }) } },
    ])).toEqual([1200000, 27]);
  });

  it("leaves out the fee index's catalog-derived medians, so they must tie to the live national layer (#1414)", () => {
    expect(toolMoneyFigures([
      { toolName: "queryNationalData", input: { source: "fee_index", limit: 15 }, output: { median: 26, n: 1900 } },
      { toolName: "queryNationalData", input: { source: "call_reports" }, output: { service_charge_income: 5000000 } },
    ])).toEqual([5000000]);
  });

  it("accepts public-data dollar figures from queryData as stated, never a rate, and leaves its fee measures to the live catalog", () => {
    expect(toolMoneyFigures([
      { toolName: "queryData", input: { measure: "area:census-saipe:saipe_median_household_income", scope: { kind: "state", id: "FL" } }, output: { ok: true, rows: [{ geo_code: "12", period: "2023", value: 74580, unit: "usd" }, { geo_code: "12", period: "2023", value: 4.1, unit: "percent" }] } },
      { toolName: "queryData", input: { measure: "fee:overdraft", scope: { kind: "national" } }, output: { ok: true, rows: [{ median_amount: 30, institution_count: 900 }] } },
    ])).toEqual([74580]);
  });

  describe("the report answer page", () => {
    const prepared: PreparedReportAnswer = {
      institutionId: 1001,
      institutionName: "Bank 1001",
      input: { type: "executive_summary", title: "The Answer", data: {} },
      deltas: [
        { fee_name: "Overdraft fee", fee_category: "overdraft", institution_amount: 32, peer_median: 29.5, peer_p25: 25.75, peer_p75: 32, delta_amount: 2.5, delta_percent: null, position: "above_peer_median", evidence_tier: "verified", excluded_from_verified_benchmark: false, institution_count: 12 },
      ] as PreparedReportAnswer["deltas"],
      competitorNames: [],
      selectedInstitution: null,
      evidencePolicy: "provisional-first",
    };
    const fresh = (amount: number) => async () => prepared.deltas.map((d) => ({ ...d, institution_amount: amount }));
    const writer = (result: Awaited<ReturnType<ReportAnswerWriter>>): ReportAnswerWriter & { calls: number } => {
      const w = Object.assign(async () => { w.calls += 1; return result; }, { calls: 0 });
      return w;
    };

    it("spends one of the day's five on a report the screen would write, and ties the bank's own fee to the live catalog", async () => {
      evalMocks.answer.mockImplementation(async (id: number) => answered(id));
      const write = writer({ status: "written", narrative: "HEADLINE: Bank 1001's $32 overdraft fee sits above peers.", passed: true, problems: [] });
      const day = db(0);
      const result = await runPaidAnswerEval({
        db: day.db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter(),
        prepareReport: async () => prepared, writeReport: write, comparison: fresh(32),
      });
      expect(write.calls).toBe(1);
      expect(day.state.paths.filter((p) => p === "report")).toHaveLength(1);
      expect(result.paths[3]).toMatchObject({ path: "report", sampled: 1, answers: 1, passed: 1, correctness: { checked: 1, correct: 1 } });
    });

    it("fails correctness when the report states the bank's own fee the catalog no longer holds, and form on the review's problems", async () => {
      evalMocks.answer.mockImplementation(async (id: number) => answered(id));
      const stale = await runPaidAnswerEval({
        db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter(),
        prepareReport: async () => prepared,
        writeReport: writer({ status: "written", narrative: "HEADLINE: Bank 1001's $32 overdraft fee sits above peers.", passed: true, problems: [] }),
        comparison: fresh(29),
      });
      expect(stale.paths[3]).toMatchObject({ passed: 1, correctness: { checked: 1, correct: 0 } });
      expect(stale.results.find((r) => r.path === "report")!.correctness).toEqual(["Overdraft (OD): the report uses $32.00, the catalog has $29.00"]);
      const flagged = await runPaidAnswerEval({
        db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter(),
        prepareReport: async () => prepared,
        writeReport: writer({ status: "written", narrative: "Peers vary.", passed: false, problems: ["The headline must name Bank 1001."] }),
      });
      expect(flagged.paths[3]).toMatchObject({ answers: 1, passed: 0, correctness: { checked: 0 } });
    });

    it("spends nothing on a report when no sampled institution has one to write, or today's is used", async () => {
      evalMocks.answer.mockImplementation(async (id: number) => answered(id));
      const write = writer({ status: "written", narrative: "", passed: true, problems: [] });
      const none = await runPaidAnswerEval({ db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter(), prepareReport: async () => null, writeReport: write });
      expect(none.paths[3]).toMatchObject({ path: "report", sampled: 0 });
      await runPaidAnswerEval({ db: db(1, ["report"]).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter(), prepareReport: async () => prepared, writeReport: write });
      expect(write.calls).toBe(0);
    });

    it("writes no report when the day's remaining samples go to Simulate and the written answer", async () => {
      evalMocks.answer.mockImplementation(async (id: number) => answered(id));
      const write = writer({ status: "written", narrative: "", passed: true, problems: [] });
      // Two left today: Simulate and the written answer take them, so no report is reserved or written.
      await runPaidAnswerEval({ db: db(3, ["memo", "memo", "memo"]).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter(), prepareReport: async () => prepared, writeReport: write });
      expect(write.calls).toBe(0);
    });
  });
});

it("uses the same scaled dollar contract in the eval while excluding nonmonetary and catalog values (#1858)",()=>{
  expect(toolMoneyFigures([
    {toolName:"queryData",input:{measure:"area:income"},output:{rows:[
      {value:1234,unit:"thousands_dollars"},{value:2,unit:"millions_dollars"},{value:3,unit:"dollars (billions)"},
      {value:1234,unit:"thousands of dollars"},{value:1,unit:"billions_dollars"},
      {value:4.1,unit:"percent"},{value:500,unit:"persons"}]}},
    {toolName:"queryData",input:{measure:"fee:overdraft"},output:{rows:[{value:35,unit:"usd"}]}},
    {toolName:"getInstitution",output:{financials:{units:"dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)",
      latest:{service_charge_income:311051,fee_income_ratio:0.068}}}},
  ])).toEqual([1234000,2000000,3000000000,1234000,1000000000,311051000]);
});

it("reads a public-data result cut by characters, whose `_shortened` note is a string (research/tool-output.ts)", () => {
  const text = JSON.stringify({ rows: [{ value: 2, unit: "millions_dollars" }] });
  expect(toolMoneyFigures([
    { toolName: "queryData", input: { measure: "area:income" }, output: { _shortened: "Result cut to 4000 characters.", text } },
  ])).toEqual([2000000]);
});

describe("the written sample reads the claims (#1077 claim contract step 7)", () => {
  const BANK = 1001;
  const filingId = `filing:fdic:${BANK}:2026-06-30:service_charge_income:standalone_quarter`;
  /** A bank's getInstitution read with two filed quarters, in thousands, as the tool returns them. */
  const bankRead = {
    toolName: "getInstitution",
    input: { id: BANK },
    output: {
      identity: { id: BANK, name: `Bank ${BANK}`, charter_type: "bank" },
      fees: { verified: [], provisional: [] },
      financials: {
        units: "dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)",
        definition: { ...financialMeasureDefinition("fdic"), period_basis: "standalone_quarter" },
        latest: null,
        records: [["2026-06-30", 1100], ["2026-03-31", 1000]].map(([report_date, income]) => ({
          institution_id: BANK, report_date, source: "fdic", service_charge_income: income, total_assets: 400_000, total_deposits: 350_000,
          total_revenue: Number(income) * 10, fee_income_ratio: 0.1, field_units: { fee_income_ratio: "fraction" },
        })),
      },
    },
  };
  const filingText = `Bank ${BANK}'s service charge income was $1.1 million in Q2 2026.`;
  /** A fake filing reader: `value` for every key (null: no row), counting its calls. */
  const filingReader = (value: number | null): FilingReader & { keys: string[][] } => {
    const keys: string[][] = [];
    return Object.assign(async (asked: Parameters<FilingReader>[0]) => {
      keys.push(asked.map((k) => k.id));
      return new Map(asked.map((k) => [k.id, value]));
    }, { keys });
  };
  const run = (filings: FilingReader, written = writtenWriter(filingText, [bankRead]), client = memoClient("Your overdraft fee is $32.")) =>
    runPaidAnswerEval({ db: db(0).db, now, client, live, agentRunId: 77, written, filings, recordShadow: async () => null });

  it("passes a supported filing claim whose live row is unchanged, with the gate's verdict on the sample", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const reader = filingReader(1_100_000);
    const written = writtenWriter(filingText, [bankRead]);
    const client = memoClient("Your overdraft fee is $32.");
    const result = await run(reader, written, client);
    const sample = result.results.find((r) => r.path === "written_answer")!;
    expect(reader.keys).toEqual([[filingId]]);
    expect(sample).toMatchObject({ status: "written", correctness: [], filings: 1, gate: { status: "validated", critical: [], checkPassed: true } });
    expect(result.paths[2]).toMatchObject({ answers: 1, passed: 1, correctness: { checked: 1, correct: 1 } });
    // No provider call is added: one written answer, three memos and one Simulate read, as before.
    expect(written.calls).toBe(1);
    expect(client.calls).toBe(3);
    expect(client.simulateCalls).toBe(1);
  });

  it("fails correctness for a supported filing claim whose live value has changed", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const result = await run(filingReader(1_250_000));
    const sample = result.results.find((r) => r.path === "written_answer")!;
    expect(sample.status).toBe("written");
    expect(sample.correctness).toEqual([`filing claim "${filingText}": the answer uses $1,100,000 for service_charge_income for 2026-06-30 (standalone quarter), the live filing has $1,250,000`]);
    expect(result.paths[2]).toMatchObject({ passed: 1, correctness: { checked: 1, correct: 0 } });
  });

  it("fails correctness when the filing row is missing on re-read, and leaves it unchecked when the re-read cannot run", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const missing = await run(filingReader(null));
    expect(missing.results.find((r) => r.path === "written_answer")!.correctness).toEqual([expect.stringMatching(/the live filing has no row for it$/)]);
    expect(missing.paths[2]).toMatchObject({ correctness: { checked: 1, correct: 0 } });
    const failed = await run(async () => null);
    expect(failed.results.find((r) => r.path === "written_answer")!.correctness).toBeNull();
    expect(failed.paths[2]).toMatchObject({ passed: 1, correctness: { checked: 0 } });
  });

  it("scores form with the gate's verdict: a held answer fails form, and is not re-read or tied", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const reader = filingReader(1_100_000);
    // Another bank's filing stated as the reader's own: today's evidence check passes it (the figure is in the reads), the gate holds it.
    const otherRead = { ...bankRead, input: { id: 2002 }, output: { ...bankRead.output, identity: { id: 2002, name: "Bank 2002", charter_type: "bank" },
      financials: { ...bankRead.output.financials, records: bankRead.output.financials.records.map((r) => ({ ...r, institution_id: 2002 })) } } };
    const result = await run(reader, writtenWriter("Your service charge income was $1.1 million in Q2 2026.", [otherRead]));
    const sample = result.results.find((r) => r.path === "written_answer")!;
    expect(sample.gate).toMatchObject({ status: "held", critical: ["account_as_subject", "nothing_left"], checkPassed: true });
    expect(sample).toMatchObject({ status: "withheld", correctness: null });
    expect(sample.failures.length).toBeGreaterThan(0);
    expect(reader.keys).toEqual([]);
    expect(result.paths[2]).toMatchObject({ answers: 1, passed: 0 });
  });

  it("records the written answer's shadow with the route's decision: held when its check passes but the binding leaves nothing", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const otherRead = { ...bankRead, input: { id: 2002 }, output: { ...bankRead.output, identity: { id: 2002, name: "Bank 2002", charter_type: "bank" },
      financials: { ...bankRead.output.financials, records: bankRead.output.financials.records.map((r) => ({ ...r, institution_id: 2002 })) } } };
    const records: Array<{ record: { surface: string; origin: string; today: string; path: string; unified: string } }> = [];
    const recordShadow = async (record: (typeof records)[number]["record"]) => { records.push({ record }); };
    await runPaidAnswerEval({ db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77,
      written: writtenWriter("Your service charge income was $1.1 million in Q2 2026.", [otherRead]), filings: filingReader(1_100_000), recordShadow, countShadows: async () => { throw new Error("unused"); } });
    expect(records.filter((r) => r.record.surface === "written_answer").map((r) => r.record))
      .toEqual([expect.objectContaining({ origin: "paid_eval", path: "written_streaming", today: "held", unified: "held" })]);
    // A filing the binding supports is shown whole.
    records.length = 0;
    await runPaidAnswerEval({ db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77,
      written: writtenWriter(filingText, [bankRead]), filings: filingReader(1_100_000), recordShadow, countShadows: async () => { throw new Error("unused"); } });
    expect(records.filter((r) => r.record.surface === "written_answer").map((r) => r.record))
      .toEqual([expect.objectContaining({ origin: "paid_eval", today: "shown", unified: "validated" })]);
  });

  it("records the Simulate read's shadow verdict as its own run, without changing its score", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const records: Array<{ record: GateShadowRecord; context: unknown }> = [];
    const result = await runPaidAnswerEval({ db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter(),
      recordShadow: async (record, context) => { records.push({ record, context }); } });
    expect(records.filter((r) => r.record.surface === "simulate")).toEqual([
      { record: expect.objectContaining({ surface: "simulate", path: "simulate_read", origin: "paid_eval" }), context: { userId: null, researchInstitutionId: 1001 } },
    ]);
    const failing = await runPaidAnswerEval({ db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written: writtenWriter(),
      recordShadow: async () => { throw new Error("ledger down"); } });
    expect(failing.paths[1]).toMatchObject(result.paths[1]);
  });
});

describe("every paid sample feeds the shadow gate, counted apart from readers (#1077 follow-up)", () => {
  const prepared: PreparedReportAnswer = {
    institutionId: 1001, institutionName: "Bank 1001", input: { type: "executive_summary", title: "The Answer", data: {} },
    deltas: [], competitorNames: [], selectedInstitution: null, evidencePolicy: "provisional-first",
  };
  /** A report writer that hands back the section's shadow, built with the identity the eval passed. */
  const reportWriter = () => {
    const seen: Array<Parameters<ReportAnswerWriter>[1]> = [];
    const write: ReportAnswerWriter = async (_prepared, tracking) => {
      seen.push(tracking);
      const narrative = "HEADLINE: Bank 1001's overdraft fee sits near peers.";
      return { status: "written", narrative, passed: true, problems: [], gateShadow: () => reportSectionGateShadow(narrative, {}, "shown", tracking.gateIdentity!) };
    };
    return Object.assign(write, { seen });
  };
  const run = async (written: WrittenAnswerWriter, extra: Partial<Parameters<typeof runPaidAnswerEval>[0]> = {}) => {
    const records: Array<{ record: GateShadowRecord; context: unknown }> = [];
    const report = reportWriter();
    const result = await runPaidAnswerEval({
      db: db(0).db, now, client: memoClient("Your overdraft fee is $32."), live, agentRunId: 77, written,
      prepareReport: async () => prepared, writeReport: report, comparison: async () => [],
      recordShadow: async (record, context) => { records.push({ record, context }); },
      countShadows: async () => tallyGateShadow(records.map((r) => r.record)),
      ...extra,
    });
    return { result, records, report };
  };

  it("records exactly one paid_eval shadow per sample: each memo, the written answer and the report section", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const { result, records, report } = await run(writtenWriter());
    // Five samples: Simulate, the written answer, the report, and two memos.
    expect(result.results.map((r) => r.path).sort()).toEqual(["memo", "memo", "report", "simulate", "written_answer"]);
    expect(records.every((r) => r.record.origin === "paid_eval")).toBe(true);
    const bySurface = (surface: string) => records.filter((r) => r.record.surface === surface);
    expect(bySurface("memo")).toHaveLength(2);
    expect(bySurface("memo").map((r) => r.record.path)).toEqual(["memo", "memo"]);
    expect(bySurface("written_answer")).toEqual([
      { record: expect.objectContaining({ path: "written_streaming", mode: "analyze", today: "shown" }), context: { userId: null, researchInstitutionId: 1001 } },
    ]);
    expect(bySurface("report_section")).toEqual([
      { record: expect.objectContaining({ path: "report_section", today: "shown" }), context: { userId: null, researchInstitutionId: 1001 } },
    ]);
    expect(bySurface("simulate")).toHaveLength(1);
    // The report is written with the sampled institution as both the reader's own and the subject.
    expect(report.seen[0].gateIdentity).toEqual({ researchInstitutionId: 1001, accountInstitutionId: 1001, accountInstitutionName: "Bank 1001" });
    // The memos' shadow follows the memo's own decision.
    expect(bySurface("memo").map((r) => r.record.today)).toEqual(result.results.filter((r) => r.path === "memo").map((r) => (r.status === "written" ? "shown" : "held")));
  });

  it("puts the last week's shadow counts in the summary, readers apart from the eval", async () => {
    evalMocks.answer.mockImplementation(async (id: number) => answered(id));
    const readerRecord = { version: 1 as const, origin: "reader" as const, surface: "written_answer" as const, path: "written_streaming" as const, mode: "analyze",
      today: "shown" as const, unified: "held" as const, agrees: false, disagreement: "unified_holds" as const, codes: [], critical: [], cause: false, corrections: 0 };
    const days: number[] = [];
    const records: GateShadowRecord[] = [];
    const { result } = await run(writtenWriter(), {
      recordShadow: async (record) => { records.push(record); },
      countShadows: async (d) => { days.push(d); return tallyGateShadow([readerRecord, ...records]); },
    });
    expect(days).toEqual([7]);
    expect(result.shadow).toMatchObject({ days: 7, reader: { total: 1, disagree: 1, unifiedHolds: 1 }, paid_eval: { total: records.length } });
    expect(shadowCountsLine(result.shadow)).toContain(`reader answers 1 (1 disagree: 1 the unified gate would hold`);
    expect(shadowCountsLine(result.shadow)).toContain(`paid eval samples ${records.length} (`);
    // A count that cannot be read never fails the run.
    const failed = await run(writtenWriter(), { countShadows: async () => { throw new Error("db down"); } });
    expect(failed.result.shadow).toBeNull();
    expect(shadowCountsLine(null)).toBe(" Shadow gate counts could not be read.");
  });
});
