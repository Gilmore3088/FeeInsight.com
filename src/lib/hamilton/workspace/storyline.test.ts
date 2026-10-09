import { describe, expect, it } from "vitest";
import { buildFeeAnswer } from "./answer";
import { buildAskResponse, parseAsk } from "./ask";
import { evaluateFourRoles } from "./four-roles";
import { buildSegmentResearch, parseSegment } from "./segment";
import { archetypeOf, asksAboutStructure, storylineKind } from "./storyline";
import { overdraftResearch } from "./test-fixtures";
import type { FeeResearch, SegmentMember } from "./types";

// Invented figures for tests only; no figure here is live data.
const structure: FeeResearch["structure"] = {
  groupLabel: "peers (Credit unions in Tennessee)",
  columns: [
    { category: "overdraft", label: "Overdraft fee" },
    { category: "nsf", label: "NSF fee" },
    { category: "od_daily_cap", label: "Daily cap" },
    { category: "od_protection_transfer", label: "Transfer fee" },
    { category: "continuous_od", label: "Continuous OD" },
  ],
  rows: [
    { institutionId: 1, name: "Example Valley Credit Union", own: true, values: { overdraft: 32, nsf: 32 } },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
      institutionId: i,
      name: `Peer ${i}`,
      own: false,
      values: { overdraft: 25 + i, ...(i <= 4 ? { nsf: 25 } : {}), ...(i <= 2 ? { od_protection_transfer: 10 } : {}), ...(i === 1 ? { od_daily_cap: 3 } : {}) },
    })),
  ],
  source: { label: "Fees on each institution's own published schedule (verified, live)", table: "published_fee_catalog" },
};

const changeEvents: FeeResearch["changeEvents"] = [
  { date: "2026-08-02", institutionName: "Peer 4", from: 30, to: 25 },
  { date: "2026-09-15", institutionName: "Peer 9", from: 29, to: 32 },
];

function research(overrides: Partial<FeeResearch> = {}): FeeResearch {
  return overdraftResearch({ structure, changeEvents, ...overrides });
}

describe("storyline", () => {
  it("picks the storyline from the question", () => {
    expect(storylineKind(research(), {})).toBe("position");
    expect(storylineKind(research(), { tested: [25] })).toBe("price_test");
    expect(storylineKind(research(), { wantsDecision: true })).toBe("board_decision");
    expect(storylineKind(research(), { structure: true })).toBe("structure");
    expect(storylineKind(research(), { focus: "trend" })).toBe("trend");
    expect(asksAboutStructure("do others cap overdraft per day?")).toBe(true);
    expect(asksAboutStructure("how does my overdraft fee compare?")).toBe(false);
  });

  it("builds three to five numbered exhibits, each titled with a point that carries a number", () => {
    const story = buildFeeAnswer(research()).storyline!;
    expect(story.kind).toBe("position");
    expect(story.exhibits.length).toBeGreaterThanOrEqual(3);
    expect(story.exhibits.length).toBeLessThanOrEqual(5);
    expect(story.exhibits.map((e) => e.number)).toEqual(story.exhibits.map((_, i) => i + 1));
    for (const e of story.exhibits) expect(e.actionTitle).toMatch(/\d/);
    expect(story.exhibits[0].actionTitle).toBe("Peers' middle half charges $25.75 to $32; your $32 sits at the 75th percentile.");
    expect(story.governingThought).toMatch(/\$32/);
    expect(story.keyFigures.length).toBeLessThanOrEqual(4);
    expect(story.keyFigures[0]).toMatchObject({ value: "$32", label: "Your overdraft fee" });
    expect(story.defaultView).toBe("market");
  });

  it("sorts peers into the four pricing groups and places the bank", () => {
    const story = buildFeeAnswer(research()).storyline!;
    const map = story.exhibits.find((e) => e.exhibit.kind === "archetype_map")!;
    expect(map.actionTitle).toBe("Of 16 peers: 11 at $15.01–$30 and 5 over $30.");
    if (map.exhibit.kind === "archetype_map") {
      expect(map.exhibit.archetypes.map((a) => a.count)).toEqual([0, 0, 11, 5]);
      expect(map.exhibit.ownKey).toBe("premium");
    }
    expect(map.takeaway?.text).toBe("Your $32 puts you in the premium group (Over $30) with 5 peers.");
    expect([archetypeOf(0), archetypeOf(10), archetypeOf(15), archetypeOf(30), archetypeOf(30.5)]).toEqual(["zero_od", "low_capped", "low_capped", "mid", "premium"]);
  });

  it("shows fee structure beyond the price, with blanks where a schedule shows nothing", () => {
    const story = buildFeeAnswer(research(), { story: { structure: true } }).storyline!;
    expect(story.kind).toBe("structure");
    const matrix = story.exhibits[0];
    expect(matrix.actionTitle).toBe("Of 6 peers: 4 publish an NSF fee, 2 a transfer fee, 1 a daily cap.");
    if (matrix.exhibit.kind === "structure_matrix") {
      expect(matrix.exhibit.rows[0]).toMatchObject({ name: "Example Valley Credit Union", own: true, cells: ["$32", "$32", null, null, null] });
      expect(matrix.exhibit.rows).toHaveLength(7);
    }
  });

  it("lays options side by side for a decision, with consequences and no pick", () => {
    const story = buildFeeAnswer(research(), { story: { wantsDecision: true } }).storyline!;
    expect(story.kind).toBe("board_decision");
    expect(story.defaultView).toBe("finance");
    expect(story.options?.map((o) => o.label)).toEqual(["Hold at $32", "Peer median, $29.50", "Remove the overdraft fee"]);
    expect(story.options?.map((o) => o.price)).toEqual([32, 29.5, 0]);
    expect(story.options?.[2].consequences.map((c) => c.text)).toContain("None of 16 peers publishes a $0 overdraft fee today.");
    expect(JSON.stringify(story)).not.toMatch(/recommend|should|raise your|lower your|best option/i);
  });

  it("puts filed money at stake on the finance side and says when the fee line is missing", () => {
    const story = buildFeeAnswer(research(), { story: { wantsDecision: true } }).storyline!;
    const money = story.exhibits.find((e) => e.exhibit.kind === "money_at_stake")!;
    expect(money.actionTitle).toBe("Your fee income came to $209 thousand in the year to June 30, 2026.");
    if (money.exhibit.kind === "money_at_stake") {
      expect(money.exhibit.rows).toEqual([{ label: "Fee income (NCUA 5300), last four quarters", low: 209_400, high: 209_400, evidenceLevel: "institution" }]);
      expect(money.exhibit.note).toBe("NCUA reports no overdraft income line; this is all fee income.");
    }
    expect(story.lenses.finance.some((f) => /\$209 thousand/.test(f.text))).toBe(true);
  });

  it("prices each option off the filed fee line at today's item count, labelled as such", () => {
    const withLine = research({
      revenueLine: {
        annualIncome: 120_000,
        label: "Overdraft fee income (NCUA 5300)",
        quarterEnd: "2026-06-30",
        source: { label: "NCUA 5300 call report", table: "institution_financial_records" },
      },
    });
    const story = buildFeeAnswer(withLine, { story: { tested: [25] } }).storyline!;
    expect(story.kind).toBe("price_test");
    const test = story.options!.find((o) => o.label === "Test $25")!;
    expect(test.consequences.map((c) => c.text)).toContain("At today's item count, overdraft income would be about $93.8 thousand a year, against $120 thousand filed.");
  });

  it("names who changed the fee and when, newest first", () => {
    const story = buildFeeAnswer(research(), { story: { focus: "trend" } }).storyline!;
    const timeline = story.exhibits.find((e) => e.exhibit.kind === "change_timeline")!;
    expect(timeline.actionTitle).toBe("2 institutions in Tennessee changed an overdraft fee in the last 180 days; 1 lowered it.");
    if (timeline.exhibit.kind === "change_timeline") expect(timeline.exhibit.events[0].institutionName).toBe("Peer 9");
    expect(story.complication[0].text).toMatch(/^2 institutions in Tennessee changed an overdraft fee/);
  });

  it("leads a segment question with the segment table and its pricing groups", () => {
    const segment = parseSegment("all 10B and up institutions")!;
    const members: SegmentMember[] = [10, 0, 36, 35, 35, 38].map((amount, i) => ({
      institutionId: 200 + i,
      institutionName: `Big Bank ${i + 1}`,
      amount,
      stateCode: "NY",
      sourceDocumentIds: [i],
      documentUrls: [`https://example.org/big-${i}.pdf`],
      publishedAt: "2026-09-20",
      totalAssets: 1_000_000_000 - i * 10_000_000,
      charterType: "bank",
      dailyCap: null,
      dailyFeeLimit: null,
    }));
    const seg = buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members, current: 32, ownInSegment: false });
    const question = "talk to me about all 10B and up institutions for od fees";
    const res = buildAskResponse({ question, intent: parseAsk(question), research: research({ segment: seg }), memory: [] });
    const story = res.answer!.storyline!;
    expect(story.kind).toBe("segment");
    expect(story.exhibits[0].exhibit.kind).toBe("segment_table");
    expect(story.exhibits[0].actionTitle).toBe("6 of 184 $10B+ institutions publish an overdraft fee, 1 at $0; the median is $35.");
    expect(story.exhibits.some((e) => e.exhibit.kind === "archetype_map")).toBe(true);
    // The table already lists every member at its price; no second exhibit repeats it.
    expect(story.exhibits.some((e) => e.exhibit.kind === "competitor_range")).toBe(false);
    expect(story.lenses.market.map((f) => f.text)).toEqual([
      "2 of 6 $10B+ institutions charge less than your $32; the lowest is Big Bank 2 ($0).",
      "1 of them publishes a $0 overdraft fee (Big Bank 2), the claim your $32 faces.",
      "2 of 6 in the group price a transfer from savings, typically $10; your schedule in the index shows none.",
      "In Tennessee, 1 decrease and 1 increase in 180 days; latest Peer 9, $29 to $32 on Sep 15.",
    ]);
  });

  it("states where the price sits against local competitors without judging it", () => {
    const lowest = buildFeeAnswer({ ...research(), current: 20 }).storyline!.lenses.market.map((f) => f.text);
    expect(lowest[0]).toBe("None of the 3 local competitors charge less than your $20; the highest is Peer 101 ($35).");
    const highest = buildFeeAnswer({ ...research(), current: 40 }).storyline!.lenses.market.map((f) => f.text);
    expect(highest).toContain("No one in that group charges more than your $40.");
    expect([...lowest, ...highest].join(" ")).not.toMatch(/favou?r|against you|advantage/i);
  });

  it("reads the exhibits for a market reader instead of repeating their titles", () => {
    for (const intent of [{}, { structure: true }, { focus: "trend" as const }]) {
      const story = buildFeeAnswer(research(), { story: intent }).storyline!;
      const titles = new Set(story.exhibits.flatMap((e) => [e.actionTitle, e.takeaway?.text]));
      expect(story.lenses.market.length).toBeGreaterThan(0);
      for (const fact of story.lenses.market) expect(titles.has(fact.text)).toBe(false);
    }
  });

  it("passes the four-roles check across every storyline", () => {
    for (const story of [{}, { wantsDecision: true }, { tested: [25, 0] }, { structure: true }, { focus: "trend" as const }]) {
      const answer = buildFeeAnswer(research(), { story });
      const verdict = evaluateFourRoles(answer);
      expect(verdict.roles.flatMap((r) => r.failures)).toEqual([]);
    }
  });
});

describe("local competitors carry their market deposits", () => {
  it("passes each competitor's local deposits to the exhibit, null when unknown", () => {
    const base = overdraftResearch();
    const local = base.localCompetitors!.map((c, i) => ({ ...c, marketDeposits: i === 0 ? 1_200_000_000 : null }));
    const story = buildFeeAnswer(overdraftResearch({ localCompetitors: local })).storyline!;
    const exhibit = story.exhibits.find((e) => e.exhibit.kind === "competitor_range")!.exhibit;
    if (exhibit.kind !== "competitor_range") throw new Error("expected competitor_range");
    expect(exhibit.items.find((i) => i.name === "Peer 101")?.deposits).toBe(1_200_000_000);
    expect(exhibit.items.find((i) => i.name === "Peer 102")?.deposits).toBeNull();
  });
});

describe("storyline for a regulation question", () => {
  const regulation = [
    { text: "An overdraft fee may be charged on ATM and one-time debit card transactions only after the consumer opts in.", source: { label: "Regulation E overdraft opt-in, 12 CFR 1005.17" } },
    { text: "Overdraft fees on transactions authorized against a sufficient balance can be an unfair practice.", source: { label: "Unanticipated overdraft fees, CFPB Circular 2022-06" } },
    { text: "The OCC charters and supervises you as a national bank.", source: { label: "FDIC BankFind institution records", table: "institution_sources", asOf: "2026-10-08" } },
  ];
  const research = { ...overdraftResearch(), regulation };

  it("names the bank's own regulator in the finance lens, ahead of the rules", () => {
    const question = "What regulation applies to our overdraft fee?";
    const finance = buildAskResponse({ question, intent: parseAsk(question), research, memory: [] }).answer?.storyline?.lenses.finance ?? [];
    expect(finance[0]?.text).toBe("The OCC charters and supervises you as a national bank.");
  });

  it("puts fee complaints against peers' right after the regulator, and the rules still follow", () => {
    const complaints = {
      text: "Your 12 CFPB fee complaints in 2025 equal 34 per $10B of deposits; 42 Tennessee peers' median is 8.",
      source: { label: "CFPB Consumer Complaint Database, against FDIC and NCUA deposits", table: "institution_complaint_records", asOf: "2025-12-31" },
      sampleSize: 42,
    };
    const question = "What regulation applies to our overdraft fee?";
    const withComplaints = { ...research, regulation: [...regulation, complaints] };
    const response = buildAskResponse({ question, intent: parseAsk(question), research: withComplaints, memory: [] });
    expect((response.answer?.storyline?.lenses.finance ?? []).map((f) => f.source.label)).toEqual([
      "FDIC BankFind institution records",
      "CFPB Consumer Complaint Database, against FDIC and NCUA deposits",
      "Regulation E overdraft opt-in, 12 CFR 1005.17",
      "Unanticipated overdraft fees, CFPB Circular 2022-06",
    ]);
    expect(response.answer ? evaluateFourRoles(response.answer).roles.flatMap((r) => r.failures) : ["no answer"]).toEqual([]);
  });

  it("leaves the regulator out of a price question's finance lens when two rules apply", () => {
    const question = "How does our overdraft fee compare?";
    const finance = buildAskResponse({ question, intent: parseAsk(question), research, memory: [] }).answer?.storyline?.lenses.finance ?? [];
    expect(finance.map((f) => f.text)).not.toContain("The OCC charters and supervises you as a national bank.");
  });
});

describe("storyline: checking lineup", () => {
  // Invented figures for tests only; no figure here is live data.
  const summary = (accounts: number, lowest: number, median: number, free: boolean, balance: number | null) => ({
    institutions: 1,
    accounts,
    lowestMonthlyFee: lowest,
    medianMonthlyFee: median,
    shareWithFreeAccount: free ? 1 : 0,
    medianMinBalanceToAvoid: balance,
    shareWithWayToAvoid: null,
  });
  const lineup: FeeResearch["lineup"] = {
    groupLabel: "peers (Credit unions in Tennessee)",
    rows: [
      { institutionId: 1, name: "Example Valley Credit Union", own: true, summary: summary(2, 5, 7.5, false, 1500) },
      ...[2, 3, 4, 5, 6, 7].map((i) => ({ institutionId: i, name: `Peer ${i}`, own: false, summary: summary(3, i <= 3 ? 0 : 4, 6, i <= 3, null) })),
    ],
    ownAccounts: [],
    source: { label: "Monthly maintenance fees with the account each one belongs to", table: "published_fee_catalog" },
  };

  it("sets the bank's accounts beside each peer's lineup for a monthly fee question", () => {
    const story = buildFeeAnswer(research({ feeCategory: "monthly_maintenance", lineup, structure: null })).storyline!;
    const piece = story.exhibits.find((e) => e.exhibit.kind === "structure_matrix" && e.exhibit.title.startsWith("Checking lineup"))!;
    expect(piece.actionTitle).toBe("You publish 2 accounts with a monthly fee from $5; 2 of 6 peers publish an account with no monthly fee.");
    if (piece.exhibit.kind === "structure_matrix") {
      expect(piece.exhibit.rows[0]).toEqual({ name: "Example Valley Credit Union", own: true, cells: ["2", "$5", "$7.50", "No", "$1,500"] });
      expect(piece.exhibit.rows[1].cells).toEqual(["3", "$0", "$6", "Yes", null]);
      expect(piece.exhibit.rows).toHaveLength(7);
    }
  });

  it("shows no lineup when the bank publishes none", () => {
    const story = buildFeeAnswer(research({ lineup: null })).storyline!;
    expect(story.exhibits.some((e) => e.exhibit.title.startsWith("Checking lineup"))).toBe(false);
  });
});
