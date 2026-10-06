import { describe, expect, it } from "vitest";
import { buildScenario, pricePosition } from "./scenario";

const peers = [25, 28, 30, 30, 32, 35, 35, 36, 25, 30];

describe("pricePosition", () => {
  it("counts half of the peers at the same price", () => {
    // Two peers below $28, one at $28: (2 + 0.5) / 10
    expect(pricePosition(28, peers)).toBe(25);
  });
  it("gives no position for too few peers", () => {
    expect(pricePosition(30, [25, 30, 35])).toBeNull();
  });
});

describe("buildScenario", () => {
  it("stays at the market level with no revenue evidence and asks for volume", () => {
    const s = buildScenario({ feeCategory: "overdraft", current: 30, tested: 25, peers, peerLabel: "Texas banks" });
    expect(s.evidenceLevel).toBe("market");
    expect(s.revenueEffect).toBeNull();
    expect(s.peersMore + s.peersSame + s.peersLess).toBe(10);
    expect(s).toMatchObject({ peersMore: 8, peersSame: 2, peersLess: 0, per1000ItemsDelta: -5000 });
    expect(s.missingInput?.fieldKey).toBe("fee.overdraft.annual_items");
  });

  it("builds a working estimate from reported income, with the assumptions written out", () => {
    const s = buildScenario({
      feeCategory: "overdraft",
      current: 30,
      tested: 25,
      peers,
      peerLabel: "Texas banks",
      revenueLine: {
        annualIncome: 900_000,
        label: "Overdraft fee income (NCUA 5300)",
        quarterEnd: "2026-06-30",
        source: { label: "NCUA 5300" },
      },
    });
    expect(s.evidenceLevel).toBe("working_estimate");
    // 30,000 implied paid items x -$5
    expect(s.revenueEffect).toEqual({ low: -150_000, high: -150_000 });
    expect(s.assumptions.join(" ")).toContain("30,000 a year");
    expect(s.assumptions.join(" ")).toContain("stays the same");
  });

  it("notes when the filed line combines two fees", () => {
    const s = buildScenario({
      feeCategory: "overdraft", current: 30, tested: 35, peers, peerLabel: "p",
      revenueLine: { annualIncome: 300_000, label: "Overdraft-related charges (RIAD H032)", quarterEnd: "2026-06-30", source: { label: "Call report" }, combinedWith: "NSF" },
    });
    expect(s.assumptions.join(" ")).toContain("also includes NSF income");
  });

  it("uses the bank's own figures and a volume range it sets", () => {
    const s = buildScenario({
      feeCategory: "overdraft", current: 30, tested: 25, peers, peerLabel: "p",
      institutionFacts: {
        annualItems: 41_000,
        waiverRate: 0.18,
        refs: [{ factId: "m1", fieldKey: "fee.overdraft.annual_items", value: 41_000, givenBy: "user-7", givenAt: "2026-10-05T12:00:00Z" }],
      },
      volumeChangePct: [0, 10],
    });
    // paid = 33,620; at 0%: 33,620 x 25 - 33,620 x 30 = -168,100; at +10%: 36,982 x 25 - 1,008,600 = -84,050
    expect(s.evidenceLevel).toBe("institution");
    expect(s.revenueEffect).toEqual({ low: -168_100, high: -84_050 });
    expect(s.factIds).toEqual(["m1"]);
    expect(s.missingInput).toBeNull();
    expect(s.provenance.evidenceLevel).toBe("institution");
    expect(s.provenance.clientFacts).toEqual([expect.objectContaining({ factId: "m1", givenBy: "user-7" })]);
    expect(s.provenance.assumptions).toEqual(s.assumptions);
  });

  it("asks for the waiver rate when only volume is known", () => {
    const s = buildScenario({
      feeCategory: "nsf", current: 30, tested: 0, peers, peerLabel: "p",
      institutionFacts: { annualItems: 1000 },
    });
    expect(s.revenueEffect).toEqual({ low: -30_000, high: -30_000 });
    expect(s.missingInput?.fieldKey).toBe("fee.nsf.waiver_rate");
  });
});
