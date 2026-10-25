import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAskResponse, parseAsk } from "./workspace/ask";
import { overdraftResearch } from "./workspace/test-fixtures";

// Invented institutions and questions for tests only; nothing here is live data.
const provider = vi.hoisted(() => ({
  getAnthropicMessagesClient: vi.fn(() => { throw new Error("the gate replay must never build a provider client"); }),
  getAnthropicLanguageModel: vi.fn(() => { throw new Error("the gate replay must never build a provider model"); }),
}));
vi.mock("@/lib/ai-provider", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai-provider")>()), ...provider }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(async () => []) }));

const { runGateReplay, planGateReplay, countGateReplay, gateReplaySummaryLine, replayKey, GATE_REPLAY_DAILY_CAP } = await import("./gate-replay");
const { tallyGateShadow } = await import("./output-gate-shadow");
const { isProviderStep } = await import("@/lib/agents/types");
const { TICK_EXCLUDED_STEP_KEYS } = await import("@/lib/agents/run-store");
type GateReplayDeps = import("./gate-replay").GateReplayDeps;
type GateShadowRecord = import("./output-gate-shadow").GateShadowRecord;
type GateShadowContext = import("./output-gate-shadow-store").GateShadowContext;

const now = new Date("2026-10-25T16:53:00Z");
const db = vi.fn(async () => []) as unknown as import("@/lib/agents/hamilton/studies/common").SqlTag;

function engine(question: string, institutionId: number) {
  const research = overdraftResearch({ institutionId });
  const response = buildAskResponse({ question, intent: parseAsk(question), research, memory: [] });
  return { response, research, schedule: null };
}

function deps(overrides: Partial<GateReplayDeps> = {}) {
  const recorded: Array<{ record: GateShadowRecord; context: GateShadowContext }> = [];
  const d: GateReplayDeps = {
    pickProQuestions: vi.fn(async () => [
      { institutionId: 2001, question: "How does our overdraft fee compare?", askedAt: "2026-10-24T10:00:00.000Z" },
      { institutionId: 2002, question: "Is our overdraft fee high for our peers?", askedAt: "2026-10-23T10:00:00.000Z" },
    ]),
    pickInstitutions: vi.fn(async () => [1001, 1002].map((id) => ({ id, name: `Bank ${id}`, stateCode: "TN", charterType: "bank", assetTier: "a" }))),
    answer: vi.fn(async (institutionId: number, question: string) => engine(question, institutionId)),
    record: vi.fn(async (record: GateShadowRecord, context: GateShadowContext) => {
      recorded.push({ record, context });
      return recorded.length;
    }),
    recordedSince: vi.fn(async () => []),
    settledToday: vi.fn(async () => new Set<string>()),
    recentTally: vi.fn(async () => tallyGateShadow([])),
    ...overrides,
  };
  return { deps: d, recorded };
}

beforeEach(() => {
  provider.getAnthropicMessagesClient.mockClear();
  provider.getAnthropicLanguageModel.mockClear();
});

describe("the gate replay (#1077)", () => {
  it("is a deterministic step the tick never starts", () => {
    expect(isProviderStep("hamilton-gate-replay")).toBe(false);
    expect(TICK_EXCLUDED_STEP_KEYS).toContain("hamilton-gate-replay");
  });

  it("replays every Pro question and the quality bar, records each verdict as origin replay, and never calls the provider", async () => {
    const { deps: d, recorded } = deps();
    const summary = await runGateReplay({ db, now, deps: d });
    expect(provider.getAnthropicMessagesClient).not.toHaveBeenCalled();
    expect(provider.getAnthropicLanguageModel).not.toHaveBeenCalled();
    // Two Pro questions, then 17 quality-bar questions for each of two institutions.
    expect(summary.planned).toBe(2 + 2 * 17);
    expect(summary.proQuestions).toBe(2);
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.length + Object.values(summary.run.skipped).reduce((a, b) => a + b, 0) + summary.run.errors).toBe(summary.planned);
    for (const { record, context } of recorded) {
      expect(record).toMatchObject({ origin: "replay", path: "ask_replay", surface: "ask", today: "shown_ungated" });
      expect(context.userId).toBeNull();
      expect(context.replayKey).toMatch(/^2026-10-25:\d+:/);
    }
    expect(recorded.filter((r) => r.record.mode === "pro")).toHaveLength(2);
    expect(summary.today.total).toBe(recorded.length);
    expect(summary.today.byStatus.validated + summary.today.byStatus.ready_partial + summary.today.byStatus.held).toBe(recorded.length);
    expect(summary.complete).toBe(true);
    expect(summary.golden.total).toBeGreaterThan(0);
    expect(gateReplaySummaryLine(summary)).toContain("Today's plan is complete.");
  });

  it("caps the day's plan", async () => {
    const pro = Array.from({ length: GATE_REPLAY_DAILY_CAP + 50 }, (_, i) => ({ institutionId: 3000 + i, question: `Question ${i} about our overdraft fee?`, askedAt: "2026-10-24T00:00:00.000Z" }));
    expect(planGateReplay("2026-10-25", pro, [])).toHaveLength(GATE_REPLAY_DAILY_CAP);
    const { deps: d, recorded } = deps();
    const summary = await runGateReplay({ db, now, deps: d, cap: 5 });
    expect(summary.planned).toBe(5);
    expect(recorded.length).toBeLessThanOrEqual(5);
    expect(d.pickProQuestions).toHaveBeenCalledWith(db, 5);
  });

  it("skips what earlier runs today recorded or settled, so nothing is recorded twice", async () => {
    const first = deps();
    const done = await runGateReplay({ db, now, deps: first.deps });
    const keys = first.recorded.map((r) => ({ record: r.record, key: r.context.replayKey ?? null }));
    const second = deps({ recordedSince: vi.fn(async () => keys), settledToday: vi.fn(async () => new Set(done.settledKeys)) });
    const again = await runGateReplay({ db, now, deps: second.deps });
    expect(second.deps.answer).not.toHaveBeenCalled();
    expect(second.recorded).toHaveLength(0);
    expect(again.today.total).toBe(first.recorded.length);
    expect(again.complete).toBe(true);
  });

  it("stops at the time budget and leaves the rest for the next run", async () => {
    const { deps: d } = deps();
    const summary = await runGateReplay({ db, now, deps: d, budgetMs: -1 });
    expect(summary.run.timedOut).toBe(true);
    expect(summary.remaining).toBe(summary.planned);
    expect(summary.complete).toBe(false);
  });

  it("keys a Pro question by its wording without carrying its text", () => {
    const key = replayKey("2026-10-25", 2001, "pro", "How does our overdraft fee compare?");
    expect(key).toBe(replayKey("2026-10-25", 2001, "pro", "  how does our OVERDRAFT fee compare?  "));
    expect(key).not.toContain("overdraft");
  });

  it("keeps replay counts apart from readers' and the paid eval's", () => {
    const base: GateShadowRecord = {
      version: 1, origin: "reader", surface: "memo", path: "memo", mode: null, today: "shown", unified: "validated",
      agrees: true, disagreement: null, codes: [], critical: [], cause: false, corrections: 0,
    };
    const records: GateShadowRecord[] = [
      base,
      { ...base, origin: "paid_eval", unified: "held", agrees: false, disagreement: "unified_holds", codes: ["untraced_figure"], critical: ["untraced_figure"] },
      { ...base, origin: "replay", surface: "ask", path: "ask_replay", mode: "pro", today: "shown_ungated", unified: "held", agrees: false, disagreement: "unified_holds", codes: ["account_as_subject"], critical: ["account_as_subject"] },
      { ...base, origin: "replay", surface: "ask", path: "ask_replay", mode: "q01", today: "shown_ungated", unified: "ready_partial", agrees: false, disagreement: "partial_differs", codes: ["advice"] },
    ];
    const tally = tallyGateShadow(records);
    expect(tally.byOrigin.reader.total).toBe(1);
    expect(tally.byOrigin.paid_eval.total).toBe(1);
    expect(tally.byOrigin.replay).toMatchObject({ total: 2, disagree: 2, byStatus: { validated: 0, ready_partial: 1, held: 1 } });
    const counts = countGateReplay(records.filter((r) => r.origin === "replay"));
    expect(counts.heldBy).toEqual([{ code: "account_as_subject", count: 1 }]);
    expect(counts.byFrom.pro).toMatchObject({ total: 1, held: 1 });
    expect(counts.byFrom.quality).toMatchObject({ total: 1, ready_partial: 1 });
    expect(counts.bySurface.ask).toMatchObject({ total: 2, held: 1, ready_partial: 1 });
  });
});
