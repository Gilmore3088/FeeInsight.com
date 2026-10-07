import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-provider", () => ({
  getAnthropicMessagesClient: () => {
    throw new Error("no provider in tests");
  },
  extractAnthropicText: () => "",
  getHamiltonModel: () => "test-model",
  hasAnthropicApiKey: () => false,
}));
vi.mock("@/lib/ai-provider-usage", () => ({ trackAnthropicRequest: vi.fn() }));

import { memoPayload, parseMemo, writeStorylineMemo, type MemoClient } from "./memo";
import { buildFeeAnswer } from "./workspace/answer";
import { overdraftResearch } from "./workspace/test-fixtures";

// Invented research for tests only; no figure here is live data.
const storyline = buildFeeAnswer(overdraftResearch(), { story: { wantsDecision: true } }).storyline!;

function client(...replies: string[]): MemoClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async create({ user }) {
      calls.push(user);
      return replies[Math.min(calls.length - 1, replies.length - 1)];
    },
  };
}

const good = JSON.stringify({
  summary: "Your $32 overdraft fee is at the 75th percentile of 16 peers (median $29.50). The board decision is whether that position is worth what it earns.",
  board: "Service charges came to $209 thousand over the last four quarters. The filing carries no separate overdraft line, so the money at stake is not yet measured.",
  market: "Every peer group in your comparison publishes an overdraft fee; none charges $0, so price is not the headline claim against you.",
  questions: ["How many overdraft items did you charge last year?", "Which peers do your customers actually compare you with?"],
});

describe("storyline memo", () => {
  it("writes a memo whose figures all trace to the storyline", async () => {
    const c = client(good);
    const result = await writeStorylineMemo(storyline, "should we change our overdraft fee?", { client: c, now: new Date("2026-10-06T12:00:00Z") });
    expect(result.status).toBe("written");
    if (result.status === "written") {
      expect(result.memo.figureCheck.unmatched).toEqual([]);
      expect(result.memo.figureCheck.checked).toBeGreaterThan(0);
      expect(result.memo.questions).toHaveLength(2);
      expect(result.memo.model).toBe("test-model");
    }
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toContain("DATA:");
  });

  it("retries once with the untraced figure named, then withholds", async () => {
    const invented = good.replace("$209 thousand", "$412 thousand");
    const c = client(invented, invented);
    const result = await writeStorylineMemo(storyline, "q", { client: c });
    expect(result).toEqual({ status: "withheld", reason: expect.stringContaining("figure and advice checks") });
    expect(c.calls).toHaveLength(2);
    expect(c.calls[1]).toContain("$412 thousand");
  });

  it("refuses advice and accepts the corrected draft", async () => {
    const advice = good.replace("The board decision is whether", "You should lower your fee because");
    const c = client(advice, good);
    const result = await writeStorylineMemo(storyline, "q", { client: c });
    expect(result.status).toBe("written");
    expect(c.calls[1]).toMatch(/reads as advice/);
  });

  it("asks again when the summary opens with what the data lacks", async () => {
    const limitFirst = good.replace("Your $32 overdraft fee is at", "The data cannot say who changed a fee this year. Your $32 overdraft fee is at");
    const c = client(limitFirst, good);
    const result = await writeStorylineMemo(storyline, "who changed their fee?", { client: c });
    expect(result.status).toBe("written");
    expect(c.calls[1]).toMatch(/opens with a limit/);
  });

  it("never lets a fee missing from the index read as no fee", async () => {
    const missing = buildFeeAnswer(overdraftResearch({ current: null }), { story: { wantsDecision: true } }).storyline!;
    const draft = (summary: string) => JSON.stringify({ ...JSON.parse(good), summary });
    const noFee = draft("Peers have a median of $29.50. The decision is whether a no-fee position is worth defending.");
    const fixed = draft("Peers have a median of $29.50. Your overdraft fee is not in the index yet, so your own position is not measured.");
    const c = client(noFee, fixed);
    const result = await writeStorylineMemo(missing, "q", { client: c });
    expect(result.status).toBe("written");
    expect(c.calls[1]).toMatch(/not in the index yet/);
    expect(missing.governingThought).toMatch(/^Your overdraft fee is not in the index yet/);
  });

  it("says the writer is unavailable when the budget blocks the call", async () => {
    const c: MemoClient = { create: async () => { throw new Error("Provider budget exceeded for route:api.hamilton.chat"); } };
    expect(await writeStorylineMemo(storyline, "q", { client: c })).toEqual({ status: "unavailable", reason: "Hamilton's writing budget for today is used up." });
  });

  it("needs a configured key when no client is given", async () => {
    expect((await writeStorylineMemo(storyline, "q")).status).toBe("unavailable");
  });

  it("reads JSON wrapped in prose and drops questions that are not questions", () => {
    expect(parseMemo(`Here it is: {"summary":"a","board":"b","market":"c","questions":["Why?","Do this."]}`)).toEqual({ summary: "a", board: "b", market: "c", questions: ["Why?"] });
    expect(parseMemo("not json")).toBeNull();
  });

  it("restates exhibit numbers under keys the figure check reads", () => {
    const payload = memoPayload(storyline) as { stated_amounts: { amount: number }[] };
    expect(payload.stated_amounts.map((a) => a.amount)).toEqual(expect.arrayContaining([32, 29.5]));
  });
});
