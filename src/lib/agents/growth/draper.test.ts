import { describe, expect, it, vi } from "vitest";

import { narrateStepFinished } from "@/lib/agents/narrate";
import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { growthAgentForStep } from "@/lib/data-store/growth-board";
import {
  buildMondayPlan,
  buildProposals,
  conversationLog,
  dueFollowUps,
  type LoggedOutcome,
  type PlanInput,
  proposalsFrom,
  type ProposalInput,
  RETIRE_AFTER_SENDS,
  runProposals,
  type SentEmail,
  summarizeProposals,
  thisWeek,
} from "./draper";
import { GROWTH_LOOP_STEPS, loopIsFree } from "./loop";

const now = new Date("2026-10-19T14:57:00Z");
const week = thisWeek(now);

function sentEmail(overrides: Partial<SentEmail> = {}): SentEmail {
  return {
    institutionId: 1,
    institutionName: "Bank 1",
    sentAt: "2026-10-13T15:00:00Z",
    heardBack: false,
    followUpDrafted: false,
    followUpSent: false,
    finalDrafted: false,
    ...overrides,
  };
}

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    ...week,
    now,
    queue: [],
    sent: [],
    outcomes: [],
    learning: null,
    proposals: null,
    ...overrides,
  };
}

function proposalInput(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return { weekStart: week.weekStart, campaigns: [], skips: [], outcomes: [], ...overrides };
}

describe("DRAPER's steps", () => {
  it("are free marketing steps, DRAPER's, in the daily loop after the learning report", () => {
    for (const key of ["growth-plan", "growth-proposals"]) {
      expect(isMarketingStep(key)).toBe(true);
      expect(isProviderStep(key)).toBe(false);
      expect(growthAgentForStep(key, {}, {})).toBe("draper");
    }
    const keys = GROWTH_LOOP_STEPS.map((step) => step.key);
    expect(keys.indexOf("growth-proposals")).toBe(keys.indexOf("growth-learning") + 1);
    expect(keys.indexOf("growth-plan")).toBe(keys.indexOf("growth-proposals") + 1);
    expect(loopIsFree()).toBe(true);
  });

  it("plans the Monday-to-Monday week it runs in", () => {
    expect(week.weekStart.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(week.weekEnd.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("narrates a dry run as saving nothing", () => {
    expect(narrateStepFinished("growth-proposals", { dryRun: true, week: "2026-10-19", proposals: 0 })).toBe(
      "Dry run, nothing saved: Filed no proposed change for the week of 2026-10-19: too little evidence yet.",
    );
    expect(narrateStepFinished("growth-plan", { dryRun: false, week: "2026-10-19" })).toBe("Filed the Monday plan for the week of 2026-10-19 for James to read.");
  });
});

describe("follow-ups due", () => {
  it("follows the outreach rule: day 6, then day 13 once the first follow-up is sent, never after a reply", () => {
    const due = dueFollowUps(
      [
        sentEmail({ institutionId: 1, institutionName: "Day six", sentAt: "2026-10-15T10:00:00Z" }),
        sentEmail({ institutionId: 2, institutionName: "Replied", heardBack: true }),
        sentEmail({ institutionId: 3, institutionName: "Final", sentAt: "2026-10-08T10:00:00Z", followUpDrafted: true, followUpSent: true }),
        sentEmail({ institutionId: 4, institutionName: "Waiting on first follow-up", followUpDrafted: true }),
        sentEmail({ institutionId: 5, institutionName: "Too late", sentAt: "2026-10-25T10:00:00Z" }),
      ],
      week.weekEnd,
    );
    expect(due).toEqual([
      { institutionName: "Day six", stage: 1, dueAt: "2026-10-21T10:00:00.000Z", sentAt: "2026-10-15T10:00:00Z" },
      { institutionName: "Final", stage: 2, dueAt: "2026-10-21T10:00:00.000Z", sentAt: "2026-10-08T10:00:00Z" },
    ]);
  });
});

describe("the Monday plan", () => {
  it("lists the queue, the follow-ups, the last report and the month-one floor from counts only", () => {
    const outcomes: LoggedOutcome[] = [
      { institutionId: 1, outcome: "sent", note: null, at: "2026-10-13T15:00:00Z" },
      { institutionId: 2, outcome: "sent", note: null, at: "2026-10-13T15:00:00Z" },
      { institutionId: 2, outcome: "conversation", note: "Owns pricing", at: "2026-10-15T15:00:00Z" },
    ];
    const { title, body, counts } = buildMondayPlan(
      planInput({
        queue: [
          { workflow: "outreach", agent: "carnegie", kind: "outreach_email", status: "draft", campaign: "research_efficiency", count: 4, oldest: "2026-10-12T14:07:00Z" },
          { workflow: "outreach", agent: "carnegie", kind: "outreach_email", status: "draft", campaign: null, count: 2, oldest: "2026-10-08T22:21:00Z" },
          { workflow: "outreach-followup", agent: "carnegie", kind: "outreach_email", status: "draft", campaign: null, count: 1, oldest: "2026-10-19T14:07:00Z" },
          { workflow: "w1-market-spread", agent: "murrow", kind: "linkedin_post", status: "approved", campaign: null, count: 1, oldest: "2026-10-11T13:37:00Z" },
        ],
        sent: [sentEmail({ institutionId: 1, institutionName: "Bank 1" })],
        outcomes,
        learning: {
          id: 40,
          title: "What we learned, week of 2026-10-12",
          status: "draft",
          createdAt: "2026-10-19T14:37:00Z",
          metrics: { contacted: 2, qualified: 1, qualifiedInbound: 0, qualifiedPer100: 50, reachedProposal: 0, paid: 0, medianDaysToPurchase: null },
        },
        proposals: { id: 41, title: "DRAPER's proposals, week of 2026-10-12", status: "draft", createdAt: "2026-10-12T14:57:00Z", lines: ["No change yet."] },
      }),
    );
    expect(title).toBe("Monday plan, week of 2026-10-19");
    expect(body).toContain("- 6 first emails to audit (campaign A 4, no campaign recorded 2); oldest drafted 2026-10-08.");
    expect(body).toContain("- 1 follow-up drafted, waiting to be checked and sent; oldest 2026-10-19.");
    expect(body).toContain("- Bank 1: follow-up due 2026-10-19 (first email marked sent 2026-10-13).");
    expect(body).toContain("- MURROW w1-market-spread (linkedin_post): 1 approved, not yet marked posted; oldest 2026-10-11.");
    expect(body).toContain("- What we learned, week of 2026-10-12 (item 40): 1 qualified of 2 contacted, 0 at a proposal or later, 0 paid.");
    expect(body).toContain("  No change yet.");
    expect(body).toContain("- Last week: Sent 2, Replied 0, Had a conversation 1,");
    expect(body).toContain("So far 1 and 0; 18 days left.");
    expect(counts).toEqual({ outreachAwaiting: 6, followUpsAwaiting: 1, outreachApproved: 0, followUpsDue: 1, contentQueued: 1 });
  });

  it("says plainly when there is nothing yet", () => {
    const { body } = buildMondayPlan(planInput());
    expect(body).toContain("Outreach waiting for your review\n- None in the queue.");
    expect(body).toContain("- None: no first email is marked sent.");
    expect(body).toContain("- No what-we-learned report is in the queue yet.");
    expect(body).toContain("- Nothing recorded in outreach_outcomes yet: no email is marked sent.");
  });
});

describe("proposals", () => {
  it("files one line, with the counts, when the evidence is thin", () => {
    const built = buildProposals(proposalInput());
    expect(built.thin).toBe(true);
    expect(built.body.split("\n")[2]).toBe("- Too little evidence for a proposal: 0 first emails marked sent, 0 outcomes recorded, 0 skips with a reason in 30 days.");
    const some = buildProposals(proposalInput({ campaigns: [{ campaign: "research_efficiency", sent: 5, heardBack: 0 }] }));
    expect(some.thin).toBe(true);
    expect(some.body).toContain("No change the evidence supports yet: 5 first emails marked sent, 0 heard back");
  });

  it("proposes retiring a campaign with nothing heard back, a workflow James keeps skipping, and a repeated decline", () => {
    const declined = (id: number, note: string): LoggedOutcome => ({ institutionId: id, outcome: "declined", note, at: "2026-10-15T10:00:00Z" });
    const proposals = proposalsFrom(
      proposalInput({
        campaigns: [
          { campaign: "research_efficiency", sent: RETIRE_AFTER_SENDS, heardBack: 0 },
          { campaign: "personalized_research", sent: 30, heardBack: 2 },
          { campaign: null, sent: 40, heardBack: 0 },
        ],
        skips: [
          { agent: "murrow", workflow: "w1-market-spread", reason: "Too long." },
          { agent: "murrow", workflow: "w1-market-spread", reason: "too long" },
          { agent: "murrow", workflow: "w1-market-spread", reason: "Wrong metro" },
          { agent: "ernest", workflow: "ernest-od-by-state", reason: "No" },
        ],
        outcomes: [declined(1, "Core vendor sends a peer report"), declined(2, "core vendor sends a peer report."), declined(3, "No budget")],
      }),
    );
    expect(proposals.map((proposal) => proposal.rule)).toEqual(["retire_campaign", "change_workflow", "answer_decline"]);
    expect(proposals[0].text).toBe(
      `Retire campaign A: ${RETIRE_AFTER_SENDS} first emails marked sent and nothing recorded back (no reply, call, request or decline). Take A out of OUTREACH_CAMPAIGNS.`,
    );
    expect(proposals[1].text).toBe('Change or pause MURROW w1-market-spread: you skipped 3 of its items in 30 days; the reason given most: "Too long." (2).');
    expect(proposals[2].text).toBe('Answer a repeated decline in the first email: "Core vendor sends a peer report" (2 of 3 declines recorded).');
  });

  it("keeps at most three", () => {
    const campaigns = (["research_efficiency", "personalized_research", "market_insight"] as const).map((campaign) => ({ campaign, sent: 25, heardBack: 0 }));
    const skips = Array.from({ length: 5 }, () => ({ agent: "murrow", workflow: "w3-fee-depth", reason: "Off topic" }));
    expect(proposalsFrom(proposalInput({ campaigns, skips }))).toHaveLength(3);
  });

  it("writes nothing on a dry run", async () => {
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("to_regclass('public.content_drafts')")) return [{ ready: true }];
      if (text.includes("to_regclass('public.snapshot_events')")) return [{ ready: true }];
      if (text.includes("to_regclass('public.pipeline_feedback')")) return [{ ready: false }];
      if (text.includes("INSERT")) throw new Error("dry run wrote");
      return [];
    }) as unknown as NonNullable<Parameters<typeof runProposals>[0]["db"]>;
    const result = await runProposals({ db, runId: null, dryRun: true, now });
    expect(result).toMatchObject({ schemaReady: true, dryRun: true, week: "2026-10-19", draftId: null, proposals: 0, thin: true, sent: 0 });
    expect(summarizeProposals(result)).toBe("Would file DRAPER's proposals for the week of 2026-10-19: none, too little evidence (0 first emails marked sent).");
  });
});

describe("the conversation log", () => {
  it("counts outreach_outcomes to date and in the week before", () => {
    const log = conversationLog(
      [
        { institutionId: 1, outcome: "sent", note: null, at: "2026-10-01T10:00:00Z" },
        { institutionId: 1, outcome: "replied", note: null, at: "2026-10-14T10:00:00Z" },
      ],
      week.weekStart,
    );
    expect(log.toDate.sent).toBe(1);
    expect(log.toDate.replied).toBe(1);
    expect(log.lastWeek.sent).toBe(0);
    expect(log.lastWeek.replied).toBe(1);
    expect(log.institutions).toBe(1);
  });
});
