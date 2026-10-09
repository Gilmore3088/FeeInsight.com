import { beforeEach, describe, expect, it, vi } from "vitest";

const { startAgentRunMock } = vi.hoisted(() => ({ startAgentRunMock: vi.fn() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { isMarketingStep, isProviderStep, pauseScopeForStep } from "@/lib/agents/types";
import { withdrawNonBuyerDrafts } from "./outreach";
import {
  STALE_OUTREACH_WITHDRAW_SOURCE,
  STALE_OUTREACH_WITHDRAW_STEP,
  scheduleStaleOutreachWithdrawal,
  staleOutreachWithdrawKey,
} from "./withdraw";

type Draft = { id: number; status: string; facts: Record<string, unknown> };

const ceo = { email: "jane@bank.example", name: "Jane Doe", title: "Chief Executive Officer", role: "executive" };
function draft(id: number, quoteRule: number): Draft {
  return { id, status: "draft", facts: { to: ceo, quote_rule: quoteRule, published_ids: [] } };
}

/**
 * A stand-in for the sql tag over content_drafts and agent_runs: answers the scheduler's
 * count, its idempotency lookup, withdrawNonBuyerDrafts's draft read, and the status update
 * setContentDraftStatus makes.
 */
function createDb(drafts: Draft[], runKeys: string[] = []) {
  const statements: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push(text);
    if (/count\(\*\)::int AS n FROM content_drafts/.test(text)) {
      return Promise.resolve([{ n: drafts.filter((row) => row.status === "draft").length }]);
    }
    if (/FROM agent_runs WHERE idempotency_key/.test(text)) {
      return Promise.resolve(runKeys.includes(String(values[0])) ? [{ id: 4321 }] : []);
    }
    if (/SELECT id, facts FROM content_drafts/.test(text)) {
      return Promise.resolve(drafts.filter((row) => row.status === "draft").map(({ id, facts }) => ({ id, facts })));
    }
    if (/UPDATE content_drafts/.test(text)) {
      const id = values.find((value) => typeof value === "number" && drafts.some((row) => row.id === value));
      const row = drafts.find((candidate) => candidate.id === id);
      if (row) row.status = "skipped";
      return Promise.resolve(row ? [{ id: row.id }] : []);
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as NonNullable<Parameters<typeof scheduleStaleOutreachWithdrawal>[1]>, statements };
}

const NOW = new Date("2026-10-09T15:05:00Z");

describe("stale outreach withdrawal from the agent tick", () => {
  beforeEach(() => {
    startAgentRunMock.mockReset();
    startAgentRunMock.mockResolvedValue({ run: { id: 900 }, steps: [], reused: false });
  });

  it("is a free marketing step that the marketing pause holds", () => {
    expect(isMarketingStep(STALE_OUTREACH_WITHDRAW_STEP)).toBe(true);
    expect(isProviderStep(STALE_OUTREACH_WITHDRAW_STEP)).toBe(false);
    expect(pauseScopeForStep(STALE_OUTREACH_WITHDRAW_STEP)).toBe("marketing");
  });

  it("starts one growth-withdraw run, keyed to the day, when stale drafts are waiting", async () => {
    const { db } = createDb([draft(49, 2), draft(50, 2), draft(51, 2)]);
    const result = await scheduleStaleOutreachWithdrawal({ marketingEnabled: true, now: NOW }, db);
    expect(result).toEqual({ scheduled: true, runId: 900, due: 3, reason: null });
    expect(startAgentRunMock).toHaveBeenCalledTimes(1);
    const input = startAgentRunMock.mock.calls[0][0];
    expect(input).toMatchObject({
      agent: "growth",
      kind: "workflow",
      title: "Withdraw stale outreach drafts 2026-10-09",
      triggerSource: "schedule",
      idempotencyKey: staleOutreachWithdrawKey("2026-10-09"),
      params: { source: STALE_OUTREACH_WITHDRAW_SOURCE, agent: "carnegie", due: 3 },
    });
    expect(input.steps.map((step: { key: string }) => step.key)).toEqual(["growth-withdraw"]);
  });

  it("counts with a dry run: scheduling changes no draft", async () => {
    const drafts = [draft(49, 2)];
    const { db, statements } = createDb(drafts);
    await scheduleStaleOutreachWithdrawal({ marketingEnabled: true, now: NOW }, db);
    expect(drafts[0].status).toBe("draft");
    expect(statements.some((text) => /UPDATE/.test(text))).toBe(false);
  });

  it("creates nothing when no unreviewed first email is waiting", async () => {
    const { db, statements } = createDb([]);
    const result = await scheduleStaleOutreachWithdrawal({ marketingEnabled: true, now: NOW }, db);
    expect(result).toMatchObject({ scheduled: false, runId: null, reason: "no_drafts" });
    expect(startAgentRunMock).not.toHaveBeenCalled();
    // The cheap count only: no idempotency lookup, no draft read.
    expect(statements).toHaveLength(1);
  });

  it("creates nothing when every waiting draft still qualifies", async () => {
    const { db } = createDb([draft(80, 4)]);
    const result = await scheduleStaleOutreachWithdrawal({ marketingEnabled: true, now: NOW }, db);
    expect(result).toMatchObject({ scheduled: false, reason: "nothing_to_withdraw" });
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("creates nothing a second time the same day", async () => {
    const { db } = createDb([draft(49, 2)], [staleOutreachWithdrawKey("2026-10-09")]);
    const result = await scheduleStaleOutreachWithdrawal({ marketingEnabled: true, now: NOW }, db);
    expect(result).toMatchObject({ scheduled: false, runId: 4321, reason: "already_ran_today" });
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("the step withdraws the 23 rule-2 drafts once; a second pass withdraws nothing and the next tick queues nothing", async () => {
    const drafts = Array.from({ length: 23 }, (_, index) => draft(49 + index, 2));
    const { db } = createDb(drafts);
    // What the growth-withdraw step runs (run-store), twice.
    expect(await withdrawNonBuyerDrafts(db)).toBe(23);
    expect(drafts.every((row) => row.status === "skipped")).toBe(true);
    expect(await withdrawNonBuyerDrafts(db)).toBe(0);
    const next = await scheduleStaleOutreachWithdrawal({ marketingEnabled: true, now: new Date("2026-10-10T00:05:00Z") }, db);
    expect(next).toMatchObject({ scheduled: false, reason: "no_drafts" });
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("reads nothing and creates nothing while marketing is paused", async () => {
    const { db, statements } = createDb([draft(49, 2)]);
    const result = await scheduleStaleOutreachWithdrawal({ marketingEnabled: false, now: NOW }, db);
    expect(result).toMatchObject({ scheduled: false, reason: "marketing_paused" });
    expect(statements).toHaveLength(0);
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });
});
