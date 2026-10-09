import { describe, expect, it, vi } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import { GROWTH_LOOP_STEPS, loopIsFree } from "./loop";
import { GROWTH_AGENTS } from "./roster";
import {
  OUTLET_REPEAT_DAYS,
  PRESS_OUTLETS,
  PRESS_WORKFLOW,
  allowedPitchNumbers,
  draftPitch,
  inSentence,
  dueOutlets,
  parsePitchSubject,
  pitchStyleProblems,
  pitchSubjectKey,
  rankFindings,
  runPressPitches,
  summarizePressPitches,
  verifiedFinding,
  type PressFinding,
  type StateFeeRow,
} from "./bernays";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";

type Db = Parameters<typeof runPressPitches>[0]["db"];

const now = new Date("2026-10-12T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** Banks 1..banks at bankAmount and credit unions 101.. at cuAmount, in one state. */
function stateRows(state: string, fee: string, banks: number, cus: number, bankAmount = 35, cuAmount = 25, base = 0): StateFeeRow[] {
  const rows: StateFeeRow[] = [];
  for (let i = 1; i <= banks; i++) rows.push({ institution_id: base + i, state_code: state, charter_type: "bank", fee_category: fee, amount: bankAmount });
  for (let i = 1; i <= cus; i++) rows.push({ institution_id: base + 100 + i, state_code: state, charter_type: "credit_union", fee_category: fee, amount: cuAmount });
  return rows;
}

const finding: PressFinding = {
  key: "overdraft:TX",
  feeCategory: "overdraft",
  state: "TX",
  bankMedian: 35,
  creditUnionMedian: 29.5,
  banks: 40,
  creditUnions: 110,
  difference: -5.5,
  failing: 3,
  bankIds: [],
  creditUnionIds: [],
};

describe("BERNAYS on the roster and in the loop", () => {
  it("is a growth agent and a free marketing step in the daily dry run", () => {
    expect(GROWTH_AGENTS).toContain("bernays");
    expect(isMarketingStep("growth-press")).toBe(true);
    expect(isProviderStep("growth-press")).toBe(false);
    expect(GROWTH_LOOP_STEPS.map((step) => step.key)).toContain("growth-press");
    expect(loopIsFree()).toBe(true);
  });

  it("pitches only outlets that take an unpaid pitch", () => {
    const keys = PRESS_OUTLETS.map((outlet) => outlet.key);
    expect(keys).toHaveLength(14);
    expect(keys).not.toContain("bank-director");
    expect(keys).not.toContain("independent-banker");
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("which outlets are due", () => {
  it("takes never-pitched outlets in list order, then the longest since a pitch", () => {
    expect(dueOutlets(PRESS_OUTLETS, new Map(), new Set(), now, 2).map((o) => o.key)).toEqual(["american-banker", "banking-dive"]);
    const all = new Map(PRESS_OUTLETS.map((outlet, index) => [outlet.key, new Date(now.getTime() - (OUTLET_REPEAT_DAYS + 20 - index) * DAY)]));
    expect(dueOutlets(PRESS_OUTLETS, all, new Set(), now, 2).map((o) => o.key)).toEqual(["american-banker", "banking-dive"]);
    const first = new Map([["american-banker", new Date(now.getTime() - 3 * DAY)]]);
    expect(dueOutlets(PRESS_OUTLETS, first, new Set(), now, 2).map((o) => o.key)).toEqual(["banking-dive", "aba-banking-journal"]);
  });

  it("leaves out an outlet James skipped with a reason", () => {
    expect(dueOutlets(PRESS_OUTLETS, new Map(), new Set(["american-banker"]), now, 1).map((o) => o.key)).toEqual(["banking-dive"]);
  });

  it("keeps the outlet and the finding in one subject", () => {
    expect(parsePitchSubject(pitchSubjectKey("bankrate", "nsf:OH"))).toEqual({ outlet: "bankrate", finding: "nsf:OH" });
    expect(parsePitchSubject("bankrate")).toEqual({ outlet: "bankrate", finding: null });
  });
});

describe("the finding", () => {
  it("needs enough banks and credit unions for both medians", () => {
    const rows = [...stateRows("TX", "overdraft", 40, 100), ...stateRows("OH", "overdraft", 20, 30, 35, 25, 1000), ...stateRows("VT", "overdraft", MIN_INSTITUTIONS_FOR_MEDIAN - 1, 30, 35, 25, 2000)];
    expect(rankFindings(rows, new Set()).map((c) => c.key)).toEqual(["overdraft:TX", "overdraft:OH"]);
    expect(rankFindings(rows, new Set(["overdraft:TX"])).map((c) => c.key)).toEqual(["overdraft:OH"]);
  });

  it("counts unknown charters as neither", () => {
    const rows = stateRows("TX", "overdraft", 6, 6).map((row, index) => (index < 2 ? { ...row, charter_type: null } : row));
    expect(rankFindings(rows, new Set())).toEqual([]);
  });

  it("states medians from verified institutions only, and none below the floor", () => {
    const rows = stateRows("OH", "overdraft", 6, 6, 30, 20);
    const [candidate] = rankFindings(rows, new Set());
    const kept = verifiedFinding(candidate, rows, new Set([101]));
    expect(kept).toMatchObject({ bankMedian: 30, creditUnionMedian: 20, banks: 6, creditUnions: 5, difference: -10, failing: 1 });
    expect(verifiedFinding(candidate, rows, new Set([101, 102]))).toBeNull();
  });
});

describe("the pitch", () => {
  const outlet = PRESS_OUTLETS[0];
  const pitch = draftPitch(outlet, finding, now);

  it("leads with Fee Insight as the publisher and states the finding neutrally", () => {
    expect(pitch.body.split("\n\n")[1]).toMatch(/^Fee Insight publishes the Bank Fee Index/);
    expect(pitch.body).toContain("in Texas, the median overdraft fee is $35 across 40 banks and $29.50 across 110 credit unions.");
    expect(pitch.body).toContain("The credit union median is $5.50 lower than the bank median.");
    expect(pitch.subject).toBe("Data note: overdraft fees at Texas banks and credit unions, from published fee schedules");
  });

  it("passes the style and number guards", () => {
    expect(pitchStyleProblems(pitch.body)).toEqual([]);
    expect(unbackedNumbers(pitch.body, allowedPitchNumbers(finding, now))).toEqual([]);
  });

  it("names the fee without its abbreviation", () => {
    expect(inSentence("Overdraft (OD)")).toBe("overdraft");
    expect(inSentence("NSF / Returned Item")).toBe("NSF / returned item");
  });

  it("keeps James's notes below the pitch", () => {
    expect(pitch.caption.indexOf(pitch.body)).toBeGreaterThan(0);
    expect(pitch.caption).toContain(outlet.routeUrl);
    expect(pitch.caption).toContain("nothing was sent");
  });

  it("refuses first person, advice, judgements and a free report", () => {
    const lead = "Hello team,\n\nFee Insight publishes the Bank Fee Index, which records fees.";
    expect(pitchStyleProblems(`${lead}\n\nWe can help.`)).toContain("first person");
    expect(pitchStyleProblems(`${lead}\n\nBanks should lower their fees.`)).toContain("advice to change a fee");
    expect(pitchStyleProblems(`${lead}\n\nThe cheapest bank.`)).toContain("a judgement, not lower or higher");
    expect(pitchStyleProblems(`${lead}\n\nGet a free fee report.`)).toContain("offers a free report");
    expect(pitchStyleProblems("Hello team,\n\nThe Bank Fee Index from Fee Insight.")).toHaveLength(1);
  });
});

function fakeDb(options: { history?: Array<{ subject_key: string; created_at: Date }>; rows: StateFeeRow[]; failing?: Set<number> }) {
  const inserts: unknown[][] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("to_regclass('public.content_drafts')")) return Promise.resolve([{ ready: true }]);
    if (query.includes("SELECT subject_key, created_at FROM content_drafts")) return Promise.resolve(options.history ?? []);
    if (query.includes("INSERT INTO content_drafts")) {
      inserts.push(values);
      return Promise.resolve([{ id: 500 + inserts.length }]);
    }
    return Promise.resolve([]);
  }) as unknown as Record<string, unknown>;
  db.unsafe = vi.fn((query: string, params: unknown[]) => {
    if (query.includes("agent_source_texts")) {
      const [fee, ids] = params as [string, number[]];
      return Promise.resolve(
        options.rows
          .filter((row) => row.fee_category === fee && ids.includes(Number(row.institution_id)))
          .map((row) => ({
            institution_id: row.institution_id,
            fee_name: "Overdraft Fee",
            amount: row.amount,
            canonical_fee_key: row.fee_category,
            normalized_text: options.failing?.has(Number(row.institution_id)) ? "Stop Payment $30.00" : `Overdraft Fee $${Number(row.amount).toFixed(2)} per item`,
          })),
      );
    }
    return Promise.resolve(options.rows);
  });
  return { db: db as unknown as Db, inserts };
}

describe("runPressPitches", () => {
  const rows = [...stateRows("TX", "overdraft", 8, 12, 35, 25), ...stateRows("OH", "overdraft", 7, 7, 32, 28, 1000)];

  it("drafts two pitches to the next outlets, each with its own verified finding", async () => {
    const { db, inserts } = fakeDb({ rows });
    const result = await runPressPitches({ db, runId: 7, now, dryRun: false });
    expect(result.outlets).toEqual(["american-banker", "banking-dive"]);
    expect(result.pitches.map((p) => [p.outlet, p.finding, p.draftId])).toEqual([
      ["american-banker", "overdraft:TX", 501],
      ["banking-dive", "overdraft:OH", 502],
    ]);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toContain(PRESS_WORKFLOW);
    expect(inserts[0]).toContain("bernays");
    expect(inserts[0]).toContain("pitch");
    expect(inserts[0]).toContain("american-banker|overdraft:TX");
    expect(summarizePressPitches(result)).toContain("Drafted 2 press pitches");
  });

  it("passes over a finding whose institutions don't trace to their schedules", async () => {
    const { db } = fakeDb({ rows, failing: new Set([101, 102, 103, 104, 105, 106, 107, 108]) });
    const result = await runPressPitches({ db, runId: 7, now, dryRun: true });
    expect(result.findingsRejected).toEqual([{ finding: "overdraft:TX", failing: 8 }]);
    expect(result.pitches.map((p) => p.finding)).toEqual(["overdraft:OH"]);
  });

  it("writes nothing on a dry run, and nothing once the week's two are drafted", async () => {
    const dry = fakeDb({ rows });
    const result = await runPressPitches({ db: dry.db, runId: null, now, dryRun: true });
    expect(dry.inserts).toHaveLength(0);
    expect(result.pitches).toHaveLength(2);
    expect(result.reason).toBe("dry run: nothing written");

    const history = [
      { subject_key: "american-banker|overdraft:TX", created_at: new Date(now.getTime() - 2 * DAY) },
      { subject_key: "banking-dive|overdraft:OH", created_at: new Date(now.getTime() - 2 * DAY) },
    ];
    const done = fakeDb({ rows, history });
    const again = await runPressPitches({ db: done.db, runId: null, now, dryRun: false });
    expect(done.inserts).toHaveLength(0);
    expect(again.reason).toBe("this week's 2 pitches are already drafted");
  });

  it("does not reuse a recent finding or a skipped outlet", async () => {
    const history = [{ subject_key: "american-banker|overdraft:TX", created_at: new Date(now.getTime() - 10 * DAY) }];
    const { db } = fakeDb({ rows, history });
    const result = await runPressPitches({ db, runId: null, now, dryRun: true, avoidSubjects: ["banking-dive|nsf:CA"] });
    expect(result.outlets).toEqual(["aba-banking-journal", "the-financial-brand"]);
    expect(result.pitches.map((p) => p.finding)).toEqual(["overdraft:OH"]);
  });
});
