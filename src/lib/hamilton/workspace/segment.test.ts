import { describe, expect, it } from "vitest";
import { buildAskResponse, parseAsk } from "./ask";
import { buildFeeAnswer } from "./answer";
import { evaluateFourRoles } from "./four-roles";
import { buildSegmentResearch, parseSegment } from "./segment";
import { overdraftResearch } from "./test-fixtures";
import type { SegmentMember } from "./types";

// Invented institutions and amounts; no real figure.
function member(name: string, amount: number, assets: number, cap: number | null = null, limit: number | null = null): SegmentMember {
  return {
    institutionId: assets,
    institutionName: name,
    amount,
    stateCode: "TX",
    sourceDocumentIds: [assets],
    documentUrls: [`https://example.test/${assets}.pdf`],
    publishedAt: "2026-09-01T00:00:00Z",
    totalAssets: assets,
    charterType: "bank",
    dailyCap: cap,
    dailyFeeLimit: limit === null ? null : { count: limit, line: `Maximum ${limit} overdraft fees per day` },
  };
}

describe("parseSegment", () => {
  it("reads James's question: $10B and up, any charter", () => {
    const s = parseSegment("talk to me about all 10B and up instititions for od fees")!;
    expect(s).toMatchObject({ minAssets: 10_000_000, maxAssets: null, charterType: null, stateCode: null, largest: null });
    expect(s.label).toBe("institutions with $10 billion or more in assets");
  });

  it("reads ranges, ceilings, charters, states and 'largest'", () => {
    expect(parseSegment("credit unions under $1 billion in Texas")).toMatchObject({
      maxAssets: 1_000_000,
      charterType: "credit_union",
      stateCode: "TX",
      label: "credit unions with under $1 billion in assets in Texas",
    });
    expect(parseSegment("banks between $300M and $1B")).toMatchObject({ minAssets: 300_000, maxAssets: 1_000_000, charterType: "bank" });
    expect(parseSegment("over 1.5 billion")).toMatchObject({ minAssets: 1_500_000 });
    expect(parseSegment("the 10 largest banks")).toMatchObject({ largest: 10, charterType: "bank", label: "the 10 largest banks" });
    expect(parseSegment("how do the biggest banks price overdraft")).toMatchObject({ largest: 25 });
  });

  it("finds no segment in plain fee questions or prices", () => {
    expect(parseSegment("what is our overdraft fee against peers")).toBeNull();
    expect(parseSegment("what if we charged $25 for overdraft")).toBeNull();
    expect(parseSegment("banks in Texas")).toBeNull();
  });

  it("keeps asset sizes out of tested prices and points the exhibit at named institutions", () => {
    const intent = parseAsk("talk to me about all 10B and up institutions for od fees");
    expect(intent).toMatchObject({ feeCategory: "overdraft", tested: [], focus: "competitors" });
    expect(intent.segment?.minAssets).toBe(10_000_000);
    expect(parseAsk("model $25 for banks over $10B").tested).toEqual([25]);
  });
});

describe("segment answer", () => {
  const segment = parseSegment("all 10B and up institutions")!;
  const members = [
    member("Alpha Bank", 10, 2_600_000_000),
    member("Beta Bank", 0, 660_000_000),
    member("Gamma Bank", 36, 600_000_000, 216),
    member("Delta Bank", 35, 80_000_000, null, 3),
    member("Epsilon Bank", 35, 50_000_000, null, 3),
    member("Zeta Bank", 38, 38_000_000),
    member("Eta Bank", 30, 30_000_000),
    member("Theta Bank", 25, 25_000_000),
    member("Iota Bank", 40, 20_000_000),
    member("Kappa Bank", 34, 15_000_000),
    member("Lambda Bank", 37, 10_000_000),
  ];

  it("builds the band, the $0 count and the bank's place, largest members first", () => {
    const seg = buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members, current: 32, ownInSegment: false });
    expect(seg.members.map((m) => m.institutionName)).toEqual(["Alpha Bank", "Beta Bank", "Gamma Bank", "Delta Bank", "Epsilon Bank", "Zeta Bank", "Eta Bank", "Theta Bank", "Iota Bank", "Kappa Bank", "Lambda Bank"]);
    // 0, 10, 25, 30, 34, 35, 35, 36, 37, 38, 40.
    expect(seg.band).toEqual({ p25: 27.5, median: 35, p75: 36.5, n: 11 });
    expect(seg).toMatchObject({ zeroCount: 1, withDailyCap: 1, withDailyFeeLimit: 2, problem: null });
    expect(seg.ownPosition).not.toBeNull();
  });

  it("counts sister charters on one shared schedule once in the band, and still lists each (rule 7)", () => {
    // Delta and Epsilon are sister charters reading one schedule: ten values count, eleven are listed.
    const sisters = members.map((m) => (m.institutionName === "Epsilon Bank" ? { ...m, countedAs: 80_000_000 } : m));
    const seg = buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members: sisters, current: 32, ownInSegment: false });
    expect(seg.members).toHaveLength(11);
    // 0, 10, 25, 30, 34, 35 (Delta and Epsilon once), 36, 37, 38, 40.
    expect(seg.band).toEqual({ p25: 26.25, median: 34.5, p75: 36.75, n: 10 });
  });

  it("hands the segment and its members to the page with the Ask response", () => {
    const question = "talk to me about all 10B and up institutions for od fees";
    const seg = buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members, current: 32, ownInSegment: false });
    const res = buildAskResponse({ question, intent: parseAsk(question), research: { ...overdraftResearch(), segment: seg }, memory: [] });
    expect(res.segment?.members.map((m) => m.institutionName)).toEqual(seg.members.map((m) => m.institutionName));
    const plain = buildAskResponse({ question: "overdraft", intent: parseAsk("overdraft"), research: overdraftResearch(), memory: [] });
    expect(plain.segment).toBeUndefined();
  });

  it("leads the answer with the segment, names who charges what, and passes the four-roles check", () => {
    const research = {
      ...overdraftResearch(),
      segment: buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members, current: 32, ownInSegment: false }),
    };
    const answer = buildFeeAnswer(research, { focus: "competitors" });
    expect(answer.headline).toBe("Your $32 overdraft fee is at the 36th percentile of 11 $10B+ institutions (median $35).");
    expect(answer.claims[0].text).toBe("11 of the 184 $10B+ institutions publish an overdraft fee in the index.");
    expect(answer.claims.map((c) => c.text)).toContain("1 charge $0: Beta Bank.");
    expect(answer.claims.find((c) => c.text.startsWith("The largest by assets:"))?.text).not.toMatch(/National Association|Federal Credit Union/);
    expect(answer.claims.map((c) => c.text)).toContain("2 of them limit how many overdraft fees they charge in a day; the most common limit is 3.");
    expect(answer.claims.map((c) => c.text)).toContain("Your institution is outside this segment; your $32 is placed against it for comparison.");
    expect(answer.exhibit).toMatchObject({ kind: "competitor_range" });
    if (answer.exhibit?.kind === "competitor_range") {
      expect(answer.exhibit.items.map((i) => i.amount)).toEqual([0, 10, 25, 30, 34, 35, 35, 36, 37, 38, 40]);
      expect(answer.exhibit.title).toBe("Overdraft fees at the 11 largest $10B+ institutions");
    }
    expect(JSON.stringify(answer)).not.toMatch(/recommend|should|raise your|lower your/i);
    const verdict = evaluateFourRoles(answer);
    expect(verdict.roles.flatMap((r) => r.failures)).toEqual([]);
    expect(verdict.pass).toBe(true);
  });

  it("says a fee at the bottom of the segment is at the bottom, not at the 0th percentile", () => {
    const seg = buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members, current: 0, ownInSegment: false });
    expect(buildFeeAnswer({ ...overdraftResearch(), current: 0, segment: seg }, { focus: "competitors" }).headline).not.toContain("0th percentile");
  });

  describe("a 'the N largest' segment reads as counted English (#2028)", () => {
    const top25 = parseSegment("Which credit unions in the top 25 of the $1 billion to $10 billion tier run a fee share below 4%?")!;
    const ten = members.filter((m) => m.amount > 0).map((m) => ({ ...m, charterType: "credit_union" as const }));

    it("places the fee 'at the bottom of 10 of the 25 largest', never 'of 10 the 25 largest'", () => {
      const seg = buildSegmentResearch({ segment: top25, feeCategory: "overdraft", institutionsInSegment: 25, members: ten, current: 0, ownInSegment: true });
      const answer = buildFeeAnswer({ ...overdraftResearch(), current: 0, segment: seg }, { focus: "competitors" });
      expect(answer.headline).toBe("Your $0 overdraft fee is at the bottom of 10 of the 25 largest $1B to $10B credit unions (median $35).");
      expect(answer.claims[0].text).toBe("10 of the 25 largest $1B to $10B credit unions publish an overdraft fee in the index.");
    });

    it("names the whole group once when every member publishes", () => {
      const all = Array.from({ length: 25 }, (_, i) => ({ ...members[i % members.length], institutionId: i + 1, institutionName: `CU ${i + 1}`, totalAssets: 9_000_000 - i }));
      const seg = buildSegmentResearch({ segment: top25, feeCategory: "overdraft", institutionsInSegment: 25, members: all, current: null, ownInSegment: false });
      const answer = buildFeeAnswer({ ...overdraftResearch(), current: null, segment: seg }, { focus: "competitors" });
      expect(answer.headline).toMatch(/^The 25 largest \$1B to \$10B credit unions publish an overdraft fee; median/);
      expect(answer.claims[0].text).toBe("25 of the 25 largest $1B to $10B credit unions publish an overdraft fee in the index.");
    });

    it("counts a too-small group without stacking two counts", () => {
      const seg = buildSegmentResearch({ segment: top25, feeCategory: "overdraft", institutionsInSegment: 25, members: ten.slice(0, 2), current: 32, ownInSegment: false });
      expect(buildFeeAnswer({ ...overdraftResearch(), segment: seg }).headline).toBe(
        "Only 2 of the 25 largest $1B to $10B credit unions publish an overdraft fee, too few for a median.",
      );
    });

    it("says none of the group publishes the fee without 'the 25 the 25 largest'", () => {
      const seg = buildSegmentResearch({ segment: top25, feeCategory: "overdraft", institutionsInSegment: 25, members: [], current: 32, ownInSegment: false });
      expect(seg.problem).toBe("None of the 25 largest credit unions with $1 billion to $10 billion in assets publishes an overdraft fee in the index yet.");
    });

    it("writes no 'N the' or 'the N the' anywhere in the answer", () => {
      const seg = buildSegmentResearch({ segment: top25, feeCategory: "overdraft", institutionsInSegment: 25, members: ten, current: 32, ownInSegment: true });
      const text = JSON.stringify(buildFeeAnswer({ ...overdraftResearch(), segment: seg }, { focus: "competitors" }));
      expect(text).not.toMatch(/\d the \d/);
    });
  });

  it("says so in the first claim when the segment can't be built, then falls back to peers", () => {
    const research = {
      ...overdraftResearch(),
      segment: buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members: [], current: 32, ownInSegment: false }),
    };
    const answer = buildFeeAnswer(research);
    expect(answer.claims[0].text).toBe(
      "None of the 184 institutions with $10 billion or more in assets publishes an overdraft fee in the index yet. The figures below are for your default peer group instead.",
    );
    expect(answer.exhibit?.kind).toBe("fee_position");
  });
});
