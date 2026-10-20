import { describe, expect, it } from "vitest";
import { buildCallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import { PERCENTILE_METHOD } from "@/lib/percentile";
import { feeItem } from "./names";
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

  it("ranks a price among the peers the band counts, sister charters once (#2048)", () => {
    const base = research();
    // Six publishing rows, three of them sister charters of one schedule: four counted peers.
    const peers = base.peers.slice(0, 6).map((p, i) => ({ ...p, amount: 20 + i, ...(i >= 3 ? { countedAs: base.peers[3].institutionId } : {}) }));
    const thin = { ...base, current: 30, peers, band: { p25: 20.75, median: 21.5, p75: 22.75, n: 4 } };
    const answer = buildFeeAnswer(thin);
    expect(answer.headline).toBe("Your overdraft fee is $30; only 4 peers publish one, too few to rank.");
    expect(answer.storyline!.exhibits.some((e) => e.exhibit.kind === "fee_position")).toBe(false);
    expect(answer.storyline!.keyFigures.some((k) => /percentile|Highest|Lowest/.test(`${k.value} ${k.label}`))).toBe(false);
  });

  it("never prints a 0th percentile, a range of one price, or the institution's name twice in a title (Space Coast review)", () => {
    const base = research();
    const lowest = {
      ...base,
      current: 5,
      peers: base.peers.slice(0, 5).map((p) => ({ ...p, amount: 25 })),
      band: { p25: 25, median: 25, p75: 25, n: 5 },
      localCompetitors: base.localCompetitors!.map((c) => ({ ...c, amount: 10 })),
    };
    const answer = buildFeeAnswer(lowest);
    expect(answer.headline).toBe("Your $5 overdraft fee is below all 5 peers (median $25).");
    const titles = answer.storyline!.exhibits.map((e) => e.actionTitle);
    expect(titles).toContain("Peers' middle half all charge $25; your $5 sits below all 5 peers.");
    expect(titles).toContain("All 3 competitors in your market charge more than your $5; each charges $10.");
    expect(titles.join(" ")).not.toMatch(/0th|\$25 to \$25|\$10 to \$10/);
    const named = buildFeeAnswer({ ...lowest, subjectName: "Example Valley Credit Union" }).storyline!.exhibits.map((e) => e.actionTitle);
    for (const t of named) expect(t.split("Example Valley Credit Union").length - 1).toBeLessThanOrEqual(1);
    expect(named).toContain("All 3 competitors in Example Valley Credit Union's market charge more than its $5; each charges $10.");
    expect(answer.storyline!.keyFigures).toContainEqual(expect.objectContaining({ value: "Lowest", label: "Your place among 5 peers" }));
    const groups = buildFeeAnswer({ ...lowest, subjectName: "Example Valley Credit Union" }).storyline!.exhibits.find((e) => e.exhibit.kind === "archetype_map");
    expect(groups?.takeaway?.text).toBe("Example Valley Credit Union's $5 puts it in the low group ($0.01 to $15), where no peer sits.");
  });

  it("counts every local competitor in the exhibit title, as the memo does, when the chart shows only the largest (demo run)", () => {
    const base = research();
    const template = base.localCompetitors![0];
    // 16 competitors, largest first: the four smallest charge $1, so the 12 largest alone would say 5 of 12.
    const localCompetitors = Array.from({ length: 16 }, (_, i) => ({
      ...template, institutionId: 500 + i, institutionName: `Rival ${i + 1}`, amount: i < 5 ? 2 : i < 12 ? 4 : 1,
    }));
    const answer = buildFeeAnswer({ ...base, current: 3, localCompetitors });
    const local = answer.storyline!.exhibits.find((e) => e.exhibit.kind === "competitor_range" && /market/.test(e.actionTitle))!;
    expect(local.actionTitle).toBe("9 of 16 competitors in your market charge less than your $3; their range is $1 to $4.");
    expect(local.exhibit.kind === "competitor_range" && local.exhibit.items.length).toBe(12);
    expect(local.exhibit.kind === "competitor_range" && local.exhibit.note).toBe("Charted: the 12 largest by local deposits.");
    // Every competitor counted stays listable (#2036): the four smallest, lowest fee first.
    expect(local.exhibit.kind === "competitor_range" && local.exhibit.rest?.map((r) => r.name)).toEqual(["Rival 13", "Rival 14", "Rival 15", "Rival 16"]);
    // Past the 100-row cap the note names the total and stays within a note's 16 words.
    const many = Array.from({ length: 120 }, (_, i) => ({ ...template, institutionId: 600 + i, institutionName: `Rival ${i + 1}`, amount: 2 + (i % 5) }));
    const big = buildFeeAnswer({ ...base, current: 3, localCompetitors: many }).storyline!.exhibits.find((e) => e.exhibit.kind === "competitor_range" && /market/.test(e.actionTitle))!;
    expect(big.exhibit.kind === "competitor_range" && big.exhibit.note).toBe("Charted: the 12 largest by local deposits; 88 more listed, of 120.");
    expect(big.exhibit.kind === "competitor_range" && big.exhibit.rest?.length).toBe(88);
    expect(local.exhibit.kind === "competitor_range" && local.exhibit.allAmounts?.length).toBe(16);
    const lens = answer.storyline!.exhibits.flatMap((e) => [e.actionTitle, e.takeaway?.text ?? ""]).join(" ")
      + " " + JSON.stringify(answer);
    expect(lens).not.toMatch(/5 of 12/);
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

  describe("missing, $0 and charged stay apart (#2035)", () => {
    it("counts only a charge above $0 as charging, and shows a $0 as no fee", () => {
      const zeroNsf = { ...structure!, rows: structure!.rows.map((r) => (r.institutionId === 3 || r.institutionId === 4 ? { ...r, values: { ...r.values, nsf: 0 } } : r)) };
      const story = buildFeeAnswer(research({ structure: zeroNsf }), { story: { structure: true } }).storyline!;
      const matrix = story.exhibits.find((e) => e.exhibit.kind === "structure_matrix")!;
      expect(matrix.actionTitle).toBe("Of 6 peers: 2 charge an NSF fee, 2 a transfer fee, 1 a daily cap.");
      if (matrix.exhibit.kind !== "structure_matrix") throw new Error("expected a matrix");
      expect(matrix.exhibit.rows.find((r) => r.name === "Peer 3")?.cells[1]).toBe("No fee ($0)");
      expect(matrix.exhibit.rows.find((r) => r.name === "Peer 5")?.cells[1]).toBeNull();
    });

    it("keeps a $0 daily cap as $0, and counts a row whose several fees include a charge", () => {
      const rows = structure!.rows.map((r) =>
        r.institutionId === 1 && !r.own
          ? { ...r, values: { ...r.values, od_daily_cap: 0 } }
          : r.institutionId === 5 && !r.own
            ? { ...r, values: { ...r.values, nsf: 0 }, several: { nsf: { low: 0, high: 32, fees: [{ name: "NSF, first", amount: 0 }, { name: "NSF, later", amount: 32 }] } } }
            : r,
      );
      const story = buildFeeAnswer(research({ structure: { ...structure!, rows } }), { story: { structure: true } }).storyline!;
      const matrix = story.exhibits.find((e) => e.exhibit.kind === "structure_matrix")!;
      expect(matrix.actionTitle).toBe("Of 6 peers: 5 charge an NSF fee, 2 a transfer fee, 0 a daily cap.");
      if (matrix.exhibit.kind !== "structure_matrix") throw new Error("expected a matrix");
      const cap = matrix.exhibit.columns.indexOf("Daily cap");
      expect(matrix.exhibit.rows.find((r) => r.name === "Peer 1")?.cells[cap]).toBe("$0");
    });

    it("says the bank's schedule lists no such fee, with the schedule and its date, never a $0", () => {
      const r = research({ current: null, ownRows: [], subjectName: "Space Coast Federal Credit Union", ownSchedule: { documentUrl: "https://example.org/fees.pdf", readAt: "2026-10-09" } });
      const answer = buildFeeAnswer(r);
      expect(answer.headline).toBe("Space Coast Federal Credit Union's schedule lists no overdraft fee; 16 peers' median is $29.50.");
      expect(answer.claims[0]).toMatchObject({
        text: "Space Coast Federal Credit Union's fee schedule, read October 9, 2026, lists no overdraft fee.",
        source: { url: "https://example.org/fees.pdf", asOf: "2026-10-09" },
      });
      expect(JSON.stringify(answer)).not.toMatch(/not in the index/);
      const none = buildFeeAnswer(research({ current: null, ownRows: [], subjectName: "Space Coast Federal Credit Union", ownSchedule: null }));
      expect(none.headline).toBe("Space Coast Federal Credit Union has no fee schedule on file; 16 peers' median is $29.50.");
      // Not read: the older wording stands.
      expect(buildFeeAnswer(research({ current: null, ownRows: [] })).headline).toMatch(/is not in the index yet/);
    });

    it("never says \"item item\"", () => {
      expect(feeItem("overdraft")).toBe("overdraft item");
      expect(feeItem("NSF / returned item")).toBe("NSF / returned item");
      expect(feeItem("NSF / returned item", true)).toBe("NSF / returned items");
    });
  });

  it("states the typical transfer from savings as the statistics contract's median, not the upper middle value (#2029)", () => {
    const transfers: Record<number, number> = { 1: 5, 2: 12.5, 3: 0 };
    const rows = structure!.rows.map((r) => {
      if (r.own) return r;
      const rest = { ...r.values };
      delete rest.od_protection_transfer;
      return { ...r, values: r.institutionId in transfers ? { ...rest, od_protection_transfer: transfers[r.institutionId] } : rest };
    });
    const story = buildFeeAnswer(research({ structure: { ...structure!, rows } })).storyline!;
    const line = story.lenses.market.map((f) => f.text).find((t) => t.includes("transfer from savings"));
    // Two priced transfers, $5 and $12.50: the median is $8.75 (a $0 transfer is no fee and is not counted).
    expect(line).toBe("2 of 6 in the group price a transfer from savings, typically $8.75; your schedule in the index shows none.");
  });

  it("shows fee structure beyond the price, with blanks where a schedule shows nothing", () => {
    const story = buildFeeAnswer(research(), { story: { structure: true } }).storyline!;
    expect(story.kind).toBe("structure");
    const matrix = story.exhibits[0];
    expect(matrix.actionTitle).toBe("Of 6 peers: 4 charge an NSF fee, 2 a transfer fee, 1 a daily cap.");
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
      expect(money.exhibit.note).toBe("No current overdraft income line is on file; the figure is all fee income.");
    }
    expect(story.lenses.finance.some((f) => /\$209 thousand/.test(f.text))).toBe(true);
  });

  it("gives the fee's share of service charges only when both figures cover the same four quarters (#2034)", () => {
    const line = (quarterEnd: string) => ({
      annualIncome: 120_000,
      label: "Overdraft fee income (NCUA 5300)",
      quarterEnd,
      source: { label: "NCUA 5300 call report", table: "institution_financial_records" },
    });
    const title = (quarterEnd: string) =>
      buildFeeAnswer(research({ revenueLine: line(quarterEnd) }), { story: { wantsDecision: true } }).storyline!.exhibits.find((e) => e.exhibit.kind === "money_at_stake")!.actionTitle;
    expect(title("2026-06-30")).toMatch(/% of all service charges\.$/);
    expect(title("2026-03-31")).toBe("Your filing shows $120 thousand in overdraft income in the year to March 31, 2026.");
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

  it("retains a peer history manifest on saved trend exhibits and labels its limits", () => {
    const base = research();
    const history = buildCallCohortHistory({ requestedIds: [1, 2], periods: [] });
    const financials = { ...base.institutionFinancials!, peerMedian: { label: "Regional credit unions", cohortHistory: history,
      quarters: [{ quarterEnd: "2026-06-30", amount: 60000, institutions: 5 }, { quarterEnd: "2026-03-31", amount: 50000, institutions: 6 }],
      sourceRef: { label: "NCUA dated cross-sections" } } };
    const answer = buildFeeAnswer(research({ institutionFinancials: financials }), { story: { focus: "trend" } });
    const exhibit = answer.storyline!.exhibits.find((e) => e.exhibit.kind === "trend")!.exhibit;
    expect(exhibit).toMatchObject({ kind: "trend", cohortHistory: history, note: expect.stringContaining("not constant-cohort or merger-adjusted growth") });
    // Own as-filed arithmetic remains available and is not mistaken for peer growth.
    expect(answer.storyline!.exhibits[0].actionTitle).toContain("4.2%");
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

  it("counts a 'the N largest' segment as 'n of the N largest' in every storyline line (#2028)", () => {
    const question = "Which credit unions in the top 25 of the $1 billion to $10 billion tier run a fee share below 4%?";
    const segment = parseSegment(question)!;
    const members: SegmentMember[] = [10, 0, 36, 35, 38].map((amount, i) => ({
      institutionId: 300 + i,
      institutionName: `Big CU ${i + 1}`,
      amount,
      stateCode: "NY",
      sourceDocumentIds: [i],
      documentUrls: [`https://example.org/cu-${i}.pdf`],
      publishedAt: "2026-09-20",
      totalAssets: 9_000_000 - i * 10_000,
      charterType: "credit_union",
      dailyCap: null,
      dailyFeeLimit: null,
    }));
    const story = (current: number) => {
      const seg = buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 25, members, current, ownInSegment: true });
      return buildFeeAnswer(research({ current, segment: seg }), { focus: "competitors" }).storyline!;
    };
    const mid = story(32);
    expect(mid.exhibits[0].actionTitle).toBe("5 of the 25 largest $1B to $10B credit unions publish an overdraft fee, 1 at $0; the median is $35.");
    expect(mid.lenses.market[0].text).toMatch(/^2 of 5 of the 25 largest \$1B to \$10B credit unions charge less than your \$32; the lowest/);
    const archetype = mid.exhibits.find((e) => e.exhibit.kind === "archetype_map");
    expect(archetype?.actionTitle).toMatch(/^Of 5 of the 25 largest \$1B to \$10B credit unions: /);
    const low = story(0);
    expect(low.lenses.market[0].text).toMatch(/^None of the 5 of the 25 largest \$1B to \$10B credit unions charge less than your \$0/);
    expect(JSON.stringify([mid, low])).not.toMatch(/\d the \d/);
  });

  it("states where the price sits against local competitors without judging it", () => {
    const lowest = buildFeeAnswer({ ...research(), current: 20 }).storyline!.lenses.market.map((f) => f.text);
    expect(lowest[0]).toBe("None of the 3 local competitors charge less than your $20; the highest is Peer 101 ($35).");
    const highest = buildFeeAnswer({ ...research(), current: 40 }).storyline!.lenses.market.map((f) => f.text);
    expect(highest).toContain("No one in that group charges more than your $40.");
    expect([...lowest, ...highest].join(" ")).not.toMatch(/favou?r|against you|advantage/i);
  });

  it("names a competitor by its stated price only, and shows several fees as their range (#1931)", () => {
    const base = research();
    const several = { low: 30, high: 40, fees: [{ name: "Overdraft item", amount: 30 }, { name: "Overdraft ACH", amount: 40 }] };
    const localCompetitors = base.localCompetitors!.map((c) => (c.institutionName === "Peer 101" ? { ...c, several } : c));
    const answer = buildFeeAnswer({ ...base, current: 20, localCompetitors });
    // Peer 101 is the highest by its one value, but it states no single price to name.
    expect(answer.storyline!.lenses.market[0].text).toBe("In group statistics, 0 of 3 local competitors have values below your $20; the named rows show their stated prices.");
    const local = answer.storyline!.exhibits.find((e) => e.exhibit.kind === "competitor_range" && /market/.test(e.actionTitle))!;
    if (local.exhibit.kind === "competitor_range") {
      expect(local.exhibit.items.find((i) => i.name === "Peer 101")?.several).toEqual(several);
    }
  });

  it("keeps the local range on the same one value per institution as the counts (#1931)", () => {
    const base = research();
    const template = base.localCompetitors![0];
    const localCompetitors = [
      { ...template, institutionId: 701, institutionName: "Rival A", amount: 170 },
      { ...template, institutionId: 702, institutionName: "Rival B", amount: 162.5, several: { low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] } },
    ];
    const answer = buildFeeAnswer({ ...base, current: 160, localCompetitors });
    const local = answer.storyline!.exhibits.find((e) => e.exhibit.kind === "competitor_range" && /market/.test(e.actionTitle))!;
    expect(local.actionTitle).toBe("All 2 competitors in your market charge more than your $160; their range is $162.50 to $170.");
    expect(local.actionTitle).not.toContain("$150");
  });

  it("counts a 'the N largest' group as 'n of the N largest' in the structure exhibit (#2028)", () => {
    const largest = { ...structure!, groupLabel: "the 25 largest $1B to $10B credit unions" };
    const story = buildFeeAnswer(research({ structure: largest }), { story: { structure: true } }).storyline!;
    const matrix = story.exhibits.find((e) => e.exhibit.kind === "structure_matrix")!;
    expect(matrix.actionTitle).toBe("Of 6 of the 25 largest $1B to $10B credit unions: 4 charge an NSF fee, 2 a transfer fee, 1 a daily cap.");
    const whole = { ...structure!, groupLabel: "the 6 largest credit unions in Tennessee" };
    const all = buildFeeAnswer(research({ structure: whole }), { story: { structure: true } }).storyline!;
    expect(all.exhibits.find((e) => e.exhibit.kind === "structure_matrix")!.actionTitle).toBe(
      "Of the 6 largest credit unions in Tennessee: 4 charge an NSF fee, 2 a transfer fee, 1 a daily cap.",
    );
    expect(JSON.stringify([story, all])).not.toMatch(/\d the \d/);
  });

  it("shows a structure cell with several fees as their range and names, a single fee as its price (#1931)", () => {
    const rows = structure!.rows.map((r) =>
      r.institutionId === 2 && !r.own ? { ...r, several: { nsf: { low: 20, high: 30, fees: [{ name: "NSF item", amount: 20 }, { name: "NSF ACH", amount: 30 }] } } } : r,
    );
    const story = buildFeeAnswer(research({ structure: { ...structure!, rows } }), { story: { structure: true } }).storyline!;
    const matrix = story.exhibits[0];
    // The counts stay one per institution.
    expect(matrix.actionTitle).toBe("Of 6 peers: 4 charge an NSF fee, 2 a transfer fee, 1 a daily cap.");
    if (matrix.exhibit.kind === "structure_matrix") {
      expect(matrix.exhibit.rows.find((r) => r.name === "Peer 2")?.cells[1]).toBe("$20 to $30 (NSF item $20; NSF ACH $30)");
      expect(matrix.exhibit.rows.find((r) => r.name === "Peer 1")?.cells[1]).toBe("$25");
    }
  });

  it("keeps every institution in the structure table, with no \"Showing 12 of 14\" note (#2036)", () => {
    const peer = structure!.rows.find((r) => !r.own)!;
    const others = Array.from({ length: 14 }, (_, i) => ({ ...peer, institutionId: 900 + i, name: `Local ${i + 1}` }));
    const rows = [structure!.rows.find((r) => r.own)!, ...others];
    const story = buildFeeAnswer(research({ structure: { ...structure!, rows } }), { story: { structure: true } }).storyline!;
    const matrix = story.exhibits[0];
    expect(matrix.exhibit.kind === "structure_matrix" && matrix.exhibit.rows.length).toBe(15);
    expect(matrix.exhibit.kind === "structure_matrix" && matrix.exhibit.note).toBeUndefined();
  });

  it("names the one peer group and how many institutions it holds on the position exhibit (#2046)", () => {
    const story = buildFeeAnswer(research({ peerGroupSize: 38 })).storyline!;
    const position = story.exhibits.find((e) => e.exhibit.kind === "fee_position")!;
    const n = buildFeeAnswer(research()).storyline!.exhibits.find((e) => e.exhibit.kind === "fee_position")!;
    const publishing = n.exhibit.kind === "fee_position" ? n.exhibit.band.n : 0;
    expect(position.exhibit.kind === "fee_position" && position.exhibit.note).toMatch(new RegExp(`^Peer group picked by Hamilton: (.+; )?${publishing} of its 38 institutions publish this fee\\.$`));
    const saved = buildFeeAnswer(research({ peerGroupSize: 6, peerGroupSaved: true, peerLabel: "Lancaster rivals" })).storyline!.exhibits.find((e) => e.exhibit.kind === "fee_position")!;
    expect(saved.exhibit.kind === "fee_position" && saved.exhibit.note).toBe("Saved peer group: Lancaster rivals (6 institutions).");
  });

  it("names the percentile method wherever the position exhibit places a price (#2048)", () => {
    const position = buildFeeAnswer(research()).storyline!.exhibits.find((e) => e.exhibit.kind === "fee_position")!;
    expect(position.exhibit.kind === "fee_position" && position.exhibit.method).toBe(PERCENTILE_METHOD);
    const noOwn = buildFeeAnswer(research({ current: null })).storyline!.exhibits.find((e) => e.exhibit.kind === "fee_position");
    expect(noOwn?.exhibit.kind === "fee_position" ? noOwn.exhibit.method : undefined).toBeUndefined();
  });

  it("drops a long competitor name rather than run past a storyline line's 20 words", () => {
    const base = research();
    const local = base.localCompetitors!.map((c, i) => (i === 0 ? { ...c, institutionName: "Second Federal Savings and Loan Association of Philadelphia", amount: 40 } : c));
    const long = { ...base, current: 0, localCompetitors: local };
    const line = buildFeeAnswer(long).storyline!.lenses.market.map((f) => f.text)[0];
    expect(line).toBe("None of the 3 local competitors charge less than your $0; the highest charges $40.");
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

  it("lists the Regulatory Wire's rule, bill and action under what to watch, not in the lens (#1090)", () => {
    // Invented Wire items for tests only.
    const wire = [
      { text: 'OCC final rule "Example Fee Rule", published April 29, 2026.', source: { label: "Federal Register", table: "reg_tracker_items", url: "https://www.federalregister.gov/d/x", asOf: "2026-04-29" } },
      { text: 'Illinois bill HB 1 "Example Overdraft Bill": in committee, last action March 18, 2026.', source: { label: "Illinois legislature, via Open States", table: "reg_tracker_items", url: "https://openstates.org/x", asOf: "2026-03-18" } },
      { text: 'OCC "Civil Money Penalty (CMP)" against "Example Bank" (OH), December 19, 2025; its subjects include consumer law.', source: { label: "OCC enforcement actions", table: "institution_enforcement_actions", url: "https://apps.occ.gov/EASearch/", asOf: "2025-12-19" } },
    ];
    const question = "What regulation applies to our overdraft fee?";
    const withWire = { ...research, regulation: [...regulation, ...wire] };
    const answer = buildAskResponse({ question, intent: parseAsk(question), research: withWire, memory: [] }).answer;
    const story = answer?.storyline;
    expect(story?.watch.slice(0, 3).map((f) => f.text)).toEqual(wire.map((f) => f.text));
    expect(answer ? evaluateFourRoles(answer).roles.flatMap((r) => r.failures) : ["no answer"]).toEqual([]);
    expect(story?.lenses.finance.some((f) => wire.some((w) => w.text === f.text))).toBe(false);
    // A price question keeps its own watch list.
    const price = "How does our overdraft fee compare?";
    const priceWatch = buildAskResponse({ question: price, intent: parseAsk(price), research: withWire, memory: [] }).answer?.storyline?.watch ?? [];
    expect(priceWatch.some((f) => wire.some((w) => w.text === f.text))).toBe(false);
  });

  it("keeps a state regulator post out of a price question's watch list and the complication (#1254)", () => {
    // Invented items for tests only.
    const statePost = { text: 'Illinois state regulator post "Example Fee Notice", May 1, 2026.', source: { label: "Illinois state regulator release", table: "reg_articles", kind: "state_post" as const, url: "https://example.gov/a", asOf: "2026-05-01" } };
    const federal = { text: "FDIC: Example overdraft guidance (2026-09-01)", source: { label: "FDIC release", table: "reg_articles", url: "https://example.gov/b", asOf: "2026-09-01" } };
    const price = "How does our overdraft fee compare?";
    const story = (regulationFacts: FeeResearch["regulation"]) => {
      const withFacts = { ...research, recentChanges: [], changeEvents: [], institutionFinancials: null, regulation: [...regulation, ...regulationFacts] };
      return buildAskResponse({ question: price, intent: parseAsk(price), research: withFacts, memory: [] }).answer?.storyline;
    };
    const none = story([]);
    const onlyState = story([statePost]);
    expect(onlyState?.watch.some((f) => f.text === statePost.text)).toBe(false);
    expect(onlyState?.complication.some((f) => f.text === statePost.text)).toBe(false);
    expect(onlyState?.watch).toEqual(none?.watch);
    expect(onlyState?.complication).toEqual(none?.complication);
    // A federal release still fills the news slot (and so is not repeated under what to watch).
    const withFederal = story([statePost, federal]);
    expect(withFederal?.complication.some((f) => f.text === federal.text)).toBe(true);
    expect(withFederal?.watch.some((f) => f.text === statePost.text)).toBe(false);
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
    expect(piece.actionTitle).toBe("Your lowest monthly fee is $5; 2 of 6 peers offer a no-fee account.");
    if (piece.exhibit.kind === "structure_matrix") {
      expect(piece.exhibit.rows[0]).toEqual({ name: "Example Valley Credit Union", own: true, cells: ["2", "$5", "$7.50", "No", "$1,500"] });
      expect(piece.exhibit.rows[1].cells).toEqual(["3", "$0", "$6", "Yes", null]);
      expect(piece.exhibit.rows).toHaveLength(7);
    }
  });

  it("leads with the bank's own no-fee account and keeps the note within the limit", () => {
    const withFree = { ...lineup!, rows: lineup!.rows.map((r) => (r.own ? { ...r, summary: summary(7, 0, 5, true, null) } : r)) };
    const story = buildFeeAnswer(research({ feeCategory: "monthly_maintenance", lineup: withFree, structure: null })).storyline!;
    const piece = story.exhibits.find((e) => e.exhibit.kind === "structure_matrix" && e.exhibit.title.startsWith("Checking lineup"))!;
    expect(piece.actionTitle).toBe("Your lineup includes a no-fee account; 2 of 6 peers offer a no-fee account.");
    expect(piece.exhibit.note).toBe("A blank balance means the schedule states none.");
  });

  it("counts a 'the N largest' group as 'n of the N largest' in the lineup exhibit (#2028)", () => {
    const largest = { ...lineup!, groupLabel: "the 25 largest $1B to $10B credit unions" };
    const story = buildFeeAnswer(research({ feeCategory: "monthly_maintenance", lineup: largest, structure: null })).storyline!;
    const piece = story.exhibits.find((e) => e.exhibit.kind === "structure_matrix" && e.exhibit.title.startsWith("Checking lineup"))!;
    expect(piece.actionTitle).toBe("Your lowest monthly fee is $5; 2 of 6 of the 25 largest $1B to $10B credit unions offer a no-fee account.");
    const few = { ...largest, rows: largest.rows.slice(0, 3) };
    const thin = buildFeeAnswer(research({ feeCategory: "monthly_maintenance", lineup: few, structure: null })).storyline!;
    const thinPiece = thin.exhibits.find((e) => e.exhibit.kind === "structure_matrix" && e.exhibit.title.startsWith("Checking lineup"))!;
    expect(thinPiece.actionTitle).toBe("Your lowest monthly fee is $5; too few of the 25 largest $1B to $10B credit unions publish their lineup to compare.");
    expect(JSON.stringify([story, thin])).not.toMatch(/\d the \d/);
  });

  it("shows no lineup when the bank publishes none", () => {
    const story = buildFeeAnswer(research({ lineup: null })).storyline!;
    expect(story.exhibits.some((e) => e.exhibit.title.startsWith("Checking lineup"))).toBe(false);
  });
});

describe("list questions (#2033)", () => {
  // Invented figures for tests only.
  const coverage: FeeResearch["peerGroup"] = {
    total: 20,
    missing: [
      { institutionId: 501, institutionName: "Quiet Ridge Credit Union", stateCode: "TN", totalAssets: 900_000, hasSchedule: true },
      { institutionId: 502, institutionName: "No Schedule Credit Union", stateCode: "TN", totalAssets: 400_000, hasSchedule: false },
    ],
  };

  it("reads list wording as a list, and leaves comparisons alone", () => {
    expect(parseAsk("list peers' overdraft fees").list).toBe(true);
    expect(parseAsk("show me every peer's NSF fee").list).toBe(true);
    expect(parseAsk("which credit unions charge an overdraft fee?").list).toBe(true);
    expect(parseAsk("what do our competitors charge for overdraft?").list).toBe(true);
    expect(parseAsk("compare our NSF fee with peers").list).toBe(false);
    expect(parseAsk("How does our overdraft pricing compare in our market?").list).toBe(false);
  });

  it("reads the other ways people ask for the rows, and not comparisons, changes or whole-schedule questions", () => {
    for (const q of [
      "show me peers' overdraft fees",
      "What are our peers' overdraft fees?",
      "Which of our peers charge an overdraft fee?",
      "what are competitors charging for NSF",
      "show me every peer's NSF fee",
    ]) expect(parseAsk(q).list, q).toBe(true);
    for (const q of [
      "How does our overdraft fee compare to all of our peers?",
      "Are we higher than all our competitors on NSF?",
      "Which banks have eliminated NSF fees?",
      "What is our list price vs peers for overdraft?",
      "Which banks charge more than us for overdraft, and should we raise ours?",
      "list all our fees vs peers",
      "show all our fees vs peers",
    ]) expect(parseAsk(q).list, q).toBe(false);
  });

  it("answers with every peer by name, the ones with no fee on file too, and nothing else", () => {
    const r = research({ peerGroup: coverage, peerGroupSaved: false });
    const story = buildFeeAnswer(r, { story: { list: true } }).storyline!;
    expect(story.kind).toBe("list");
    expect(story.governingThought).toBe(`${r.peers.length} of 20 peers publish an overdraft fee; the median is $29.50.`);
    expect(story.exhibits).toHaveLength(1);
    const x = story.exhibits[0].exhibit;
    if (x.kind !== "peer_list") throw new Error("expected a peer list");
    expect(x.rows[0]).toMatchObject({ own: true, institutionName: r.institutionName, amount: 32, status: "published" });
    const peers = x.rows.filter((row) => !row.own);
    expect(peers.filter((row) => row.status === "published")).toHaveLength(r.peers.length);
    // Largest first across both kinds of row; the fixture's publishing peers have no assets on file, so they follow.
    expect(peers.slice(0, 2).map((row) => [row.institutionName, row.status])).toEqual([
      ["Quiet Ridge Credit Union", "not_on_schedule"],
      ["No Schedule Credit Union", "no_schedule"],
    ]);
    expect(x.unlisted).toBe(20 - r.peers.length - 2);
    expect(x.note).toMatch(/^Peer group picked by Hamilton: /);
    expect([story.situation, story.complication, story.lenses.finance, story.lenses.market, story.watch].every((l) => l.length === 0)).toBe(true);
    expect(story.options).toBeUndefined();
    expect(story.keyFigures.map((k) => k.label)).toEqual(["Your overdraft fee", "Peer median", "Peers publishing one"]);
  });

  it("names a saved peer group as saved", () => {
    const story = buildFeeAnswer(research({ peerGroupSaved: true }), { story: { list: true } }).storyline!;
    const x = story.exhibits[0].exhibit;
    expect(x.kind === "peer_list" && x.note).toMatch(/^Saved peer group: /);
  });

  it("lists every local competitor when the question is about the market", () => {
    const r = research();
    const story = buildFeeAnswer(r, { focus: "competitors", story: { list: true } }).storyline!;
    const x = story.exhibits[0].exhibit;
    if (x.kind !== "peer_list") throw new Error("expected a peer list");
    expect(x.rows.filter((row) => !row.own)).toHaveLength(r.localCompetitors!.length);
    expect(story.governingThought).toBe("3 local competitors publish an overdraft fee; they charge $25 to $35.");
  });

  it("says one peer and one competitor in the singular", () => {
    const base = research();
    const one = buildFeeAnswer(research({ peers: base.peers.slice(0, 1), band: null }), { story: { list: true } }).storyline!;
    expect(one.governingThought).toBe("1 peer publishes an overdraft fee.");
    expect(one.exhibits[0].exhibit.title).toBe("Overdraft fee of 1 peer, largest institutions first");
    const local = buildFeeAnswer(research({ localCompetitors: base.localCompetitors!.slice(0, 1) }), { focus: "competitors", story: { list: true } }).storyline!;
    expect(local.governingThought).toMatch(/^1 local competitor publishes an overdraft fee; it charges \$/);
  });

  it("marks a fee that is on the schedule but not counted, and lists the bank's several stated fees", () => {
    const r = research({
      current: null,
      ownRows: [
        { ...research().ownRows[0], id: 1, feeName: "Overdraft fee, tier 1", amount: 25 },
        { ...research().ownRows[0], id: 2, feeName: "Overdraft fee, tier 2", amount: 35 },
      ],
      peerGroup: { total: 20, missing: [{ institutionId: 503, institutionName: "Business Only Bank", stateCode: "TN", totalAssets: 500_000, hasSchedule: true, uncounted: true }] },
    });
    const x = buildFeeAnswer(r, { story: { list: true } }).storyline!.exhibits[0].exhibit;
    if (x.kind !== "peer_list") throw new Error("expected a peer list");
    expect(x.rows[0]).toMatchObject({ own: true, amount: 25, amountText: "$25 to $35 (Overdraft fee, tier 1 $25; Overdraft fee, tier 2 $35)" });
    expect(x.rows.find((row) => row.institutionId === 503)?.status).toBe("not_counted");
  });

  it("passes the four roles and leads the short answer with the count", () => {
    const r = research({ peerGroup: coverage });
    const response = buildAskResponse({ question: "list peers' overdraft fees", intent: parseAsk("list peers' overdraft fees"), research: r, memory: [] });
    expect(response.answer?.storyline?.kind).toBe("list");
    expect(response.shortAnswer).toBe(response.answer?.storyline?.governingThought);
    const roles = evaluateFourRoles(response.answer!);
    expect(roles.roles.filter((role) => !role.pass)).toEqual([]);
  });
});
