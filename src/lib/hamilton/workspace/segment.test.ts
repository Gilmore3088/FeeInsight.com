import { describe, expect, it } from "vitest";
import { parseAsk } from "./ask";
import { buildFeeAnswer } from "./answer";
import { evaluateFourRoles } from "./four-roles";
import { buildSegmentResearch, parseSegment } from "./segment";
import { overdraftResearch } from "./test-fixtures";
import type { SegmentMember } from "./types";

// Invented institutions and amounts; no real figure.
function member(name: string, amount: number, assets: number, cap: number | null = null): SegmentMember {
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
    member("Delta Bank", 35, 80_000_000),
    member("Epsilon Bank", 35, 50_000_000),
    member("Zeta Bank", 38, 38_000_000),
  ];

  it("builds the band, the $0 count and the bank's place, largest members first", () => {
    const seg = buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members, current: 32, ownInSegment: false });
    expect(seg.members.map((m) => m.institutionName)).toEqual(["Alpha Bank", "Beta Bank", "Gamma Bank", "Delta Bank", "Epsilon Bank", "Zeta Bank"]);
    expect(seg.band).toEqual({ p25: 16.25, median: 35, p75: 35.75, n: 6 });
    expect(seg).toMatchObject({ zeroCount: 1, withDailyCap: 1, problem: null });
    expect(seg.ownPosition).not.toBeNull();
  });

  it("leads the answer with the segment, names who charges what, and passes the four-roles check", () => {
    const research = {
      ...overdraftResearch(),
      segment: buildSegmentResearch({ segment, feeCategory: "overdraft", institutionsInSegment: 184, members, current: 32, ownInSegment: false }),
    };
    const answer = buildFeeAnswer(research, { focus: "competitors" });
    expect(answer.headline).toMatch(/^Your \$32 overdraft fee sits at the 33rd percentile of 6 institutions with \$10 billion or more in assets; their median is \$35\./);
    expect(answer.claims[0].text).toBe("6 of the 184 institutions with $10 billion or more in assets publish an overdraft fee in the index.");
    expect(answer.claims.map((c) => c.text)).toContain("1 charge $0: Beta Bank.");
    expect(answer.claims.map((c) => c.text)).toContain("Your institution is outside this segment; your $32 is placed against it for comparison.");
    expect(answer.exhibit).toMatchObject({ kind: "competitor_range" });
    if (answer.exhibit?.kind === "competitor_range") {
      expect(answer.exhibit.items.map((i) => i.amount)).toEqual([0, 10, 35, 35, 36, 38]);
      expect(answer.exhibit.title).toBe("Overdraft fees at the 6 largest institutions with $10 billion or more in assets");
    }
    expect(JSON.stringify(answer)).not.toMatch(/recommend|should|raise your|lower your/i);
    const verdict = evaluateFourRoles(answer);
    expect(verdict.roles.flatMap((r) => r.failures)).toEqual([]);
    expect(verdict.pass).toBe(true);
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
