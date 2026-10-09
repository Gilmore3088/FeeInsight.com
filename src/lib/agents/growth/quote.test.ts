import { describe, expect, it, vi } from "vitest";

import type { sql } from "@/lib/data-store/connection";
import { growthAgentForStep } from "@/lib/data-store/growth-board";
import { narrateStepFinished } from "@/lib/agents/narrate";
import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { REPORT_OFFER } from "@/lib/constants";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { GROWTH_LOOP_STEPS } from "./loop";
import { OUTREACH_POSTAL_ADDRESS } from "./outreach";
import { buildQuoteDraft, runQuoteDrafts, summarizeQuoteDrafts, type QuoteLead } from "./quote";

type Db = typeof sql;

const lead = (overrides: Partial<QuoteLead> = {}): QuoteLead => ({
  id: 41,
  name: "Dana Ruiz",
  email: "dana@riverbank.com",
  company: "River Bank",
  source: "report",
  qualifiedAt: "2026-10-09T15:00:00.000Z",
  qualifiedBy: "james",
  quoteCents: null,
  institutionId: null,
  institutionName: null,
  assetsThousands: null,
  ...overrides,
});

describe("buildQuoteDraft", () => {
  it("states the live prices from the code and never invents one", () => {
    const draft = buildQuoteDraft(lead());
    expect(draft.subject).toBe("Fee Insight pricing for River Bank");
    expect(draft.caption).toContain("Hi Dana,");
    expect(draft.caption).toContain(`${REPORT_OFFER.name} (one-off)`);
    expect(draft.caption).toContain(`From $${REPORT_OFFER.fromPriceUsd}.`);
    // Unknown assets: all three Pro tiers, priced as /subscribe prices them.
    for (const tier of PRO_TIERS) {
      expect(draft.caption).toContain(`${tier.assetsLabel}: ${tierPriceLabel(tier.key, "monthly")} or ${tierPriceLabel(tier.key, "annual")}`);
    }
    expect(draft.tier).toBeNull();
    expect(draft.reportPrice).toEqual({ cents: REPORT_OFFER.fromPriceUsd * 100, quoted: false });
  });

  it("uses James's saved quote and the institution's own tier when known", () => {
    const draft = buildQuoteDraft(lead({ quoteCents: 45_000, institutionId: 7, institutionName: "River Bank of Waco", assetsThousands: 900_000 }));
    expect(draft.caption).toContain("- $450 for River Bank of Waco against its local competitors.");
    expect(draft.tier).toBe("mid");
    expect(draft.caption).toContain("$500M to $2B in assets: $300/mo or $3,000/yr (2 months free)");
    expect(draft.caption).not.toContain("Under $500M in assets");
    expect(draft.caption).toContain("Report price: your saved quote on /admin/leads ($450).");
  });

  it("signs off as the founder, keeps the postal placeholder, and never says free or promises a date", () => {
    const { caption } = buildQuoteDraft(lead());
    expect(caption).toContain("Founder, Fee Insight");
    expect(caption).toContain(OUTREACH_POSTAL_ADDRESS);
    expect(caption).toContain('reply "no thanks"');
    expect(caption.toLowerCase()).not.toContain("free report");
    expect(caption.toLowerCase()).not.toMatch(/\bwithin \d+|48 hours|business days?\b/);
    expect(caption).toContain("--- For your review. Not part of the email; delete before sending. ---");
    expect(caption).toContain("To: Dana Ruiz <dana@riverbank.com>, River Bank");
    expect(caption).toContain("marked qualified 2026-10-09 15:00 UTC by james");
  });

  it("greets by first name only when it reads as one", () => {
    expect(buildQuoteDraft(lead({ name: "dana.ruiz@riverbank.com" })).caption).toContain("Hi there,");
  });
});

function fakeDb(options: { qualifiedColumns?: boolean; leads?: Array<Record<string, unknown>>; drafted?: string[] } = {}) {
  const calls: string[] = [];
  let nextId = 900;
  const db = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    calls.push(query);
    if (query.includes("to_regclass('public.content_drafts')")) return Promise.resolve([{ ready: true }]);
    if (query.includes("information_schema.columns")) return Promise.resolve([{ n: options.qualifiedColumns === false ? 0 : 2 }]);
    if (query.includes("FROM leads l")) return Promise.resolve(options.leads ?? []);
    if (query.includes("SELECT DISTINCT subject_key")) return Promise.resolve((options.drafted ?? []).map((subject_key) => ({ subject_key })));
    if (query.includes("INSERT INTO content_drafts")) return Promise.resolve([{ id: nextId++ }]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, calls };
}

const row = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: "Dana Ruiz",
  email: `dana${id}@riverbank.com`,
  company: "River Bank",
  source: "report",
  qualified_at: "2026-10-09T15:00:00Z",
  qualified_by: "james",
  email_unsubscribed_at: null,
  quote_cents: null,
  paid_at: null,
  institution_id: null,
  institution_name: null,
  asset_size: null,
  ...overrides,
});

describe("runQuoteDrafts", () => {
  it("drafts one quote per qualified, unpaid lead into the queue and sends nothing", async () => {
    const { db, calls } = fakeDb({
      leads: [row(1), row(2, { paid_at: "2026-10-09T16:00:00Z" }), row(3), row(4, { name: "Test User" }), row(5, { email_unsubscribed_at: "2026-10-01T00:00:00Z" })],
      drafted: ["lead:3"],
    });
    const result = await runQuoteDrafts({ db, runId: 12 });
    expect(result).toMatchObject({ schemaReady: true, qualified: 3, alreadyDrafted: 1, drafted: 1, draftIds: [900] });
    expect(result.skipped).toEqual([{ leadId: 4, reason: "test lead" }]);
    const inserts = calls.filter((query) => query.includes("INSERT INTO content_drafts"));
    expect(inserts).toHaveLength(1);
    expect(calls.some((query) => /UPDATE|DELETE/.test(query))).toBe(false);
    expect(summarizeQuoteDrafts(result)).toBe("Drafted 1 quote email for James to review and send himself; 1 already drafted; 1 skipped (3 qualified, unpaid).");
  });

  it("writes nothing on a dry run or before the migration", async () => {
    const dry = fakeDb({ leads: [row(1)] });
    const dryResult = await runQuoteDrafts({ db: dry.db, runId: null, dryRun: true });
    expect(dryResult.drafted).toBe(1);
    expect(dry.calls.some((query) => query.includes("INSERT"))).toBe(false);
    expect(summarizeQuoteDrafts(dryResult)).toContain("Would draft 1 quote email");

    const before = fakeDb({ qualifiedColumns: false, leads: [row(1)] });
    const beforeResult = await runQuoteDrafts({ db: before.db, runId: null });
    expect(beforeResult.schemaReady).toBe(false);
    expect(before.calls.some((query) => query.includes("FROM leads l"))).toBe(false);
  });
});

describe("growth-quote step", () => {
  it("is a free marketing step, CARNEGIE's, and in the daily loop", () => {
    expect(isMarketingStep("growth-quote")).toBe(true);
    expect(isProviderStep("growth-quote")).toBe(false);
    expect(growthAgentForStep("growth-quote", {}, {})).toBe("carnegie");
    expect(GROWTH_LOOP_STEPS.map((step) => step.key)).toContain("growth-quote");
  });

  it("narrates what it drafted", () => {
    expect(narrateStepFinished("growth-quote", { schemaReady: true, qualified: 0, drafted: 0 })).toBe("Checked the leads; none is marked qualified, so no quote was drafted.");
    expect(narrateStepFinished("growth-quote", { schemaReady: true, qualified: 2, drafted: 0 })).toBe("Checked 2 qualified leads; each already has a quote draft.");
    expect(narrateStepFinished("growth-quote", { dryRun: true, schemaReady: true, qualified: 1, drafted: 1 })).toBe("Dry run, nothing saved: Drafted 1 quote email for James to review and send himself.");
  });
});
