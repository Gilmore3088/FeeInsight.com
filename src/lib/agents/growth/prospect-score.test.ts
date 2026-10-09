import { describe, expect, it } from "vitest";

import { buildSnapshotFee, type MarketSnapshot, type SnapshotFeeRow } from "./market-snapshot";
import { buyerRelevance, comparisonTier, roleProblem, scoreProspect } from "./prospect-score";

function row(category: string, institutionId: number, amount: number, text: string | null = `Fee ${category} $${amount.toFixed(2)}`): SnapshotFeeRow {
  return {
    fee_published_id: institutionId * 1000 + category.length,
    institution_id: institutionId,
    fee_category: category,
    fee_name: `Fee ${category}`,
    amount,
    canonical_fee_key: category,
    conditions: null,
    account_product_type: null,
    waiver_text: null,
    document_url: `https://bank${institutionId}.example/fees.pdf`,
    read_at: "2026-10-01T00:00:00.000Z",
    normalized_text: text,
  };
}

const peers = [10, 11, 12, 13, 14];
function snapshot(): MarketSnapshot {
  const rows = [
    // Tier A: subject and five verified peers.
    row("stop_payment", 1, 30), ...peers.map((id, i) => row("stop_payment", id, 20 + i)),
    // Tier B: subject and two verified peers.
    row("money_order", 1, 5), row("money_order", 10, 4), row("money_order", 11, 6),
    // Tier C: the subject's value doesn't verify.
    row("paper_statement", 1, 3, "No such wording"), row("paper_statement", 10, 2),
  ];
  const inst = (id: number) => ({ id, name: `Bank ${id}`, city: null, stateCode: "TX", cbsaCode: "1", cbsaName: "Waco, TX", charterType: "bank" });
  return { subject: inst(1), peers: peers.map(inst), fees: ["stop_payment", "money_order", "paper_statement", "nsf"].map((c) => buildSnapshotFee(c, 1, rows)) };
}

describe("comparison tiers", () => {
  it("grades each fee type A to D, and gives none where the prospect publishes nothing", () => {
    const [stop, money, paper, nsf] = snapshot().fees;
    expect(comparisonTier(stop)).toBe("A");
    expect(comparisonTier(money)).toBe("B");
    expect(comparisonTier(paper)).toBe("C");
    expect(comparisonTier(nsf)).toBeNull();
    expect(comparisonTier(stop, new Set([10 * 1000 + "stop_payment".length]))).toBe("D");
  });
});

describe("prospect score", () => {
  it("adds the plan's five weighted parts", () => {
    const score = scoreProspect(snapshot(), { title: "Chief Financial Officer", role: "finance" }, 900_000);
    expect(score.tiers).toEqual({ stop_payment: "A", money_order: "B", paper_statement: "C" });
    expect(score.parts).toEqual({ fit: 25, buyer: 20, research: 4, confidence: 13, commercial: 15 });
    expect(score.total).toBe(77);
  });

  it("ranks a pricing owner above a lender-adjacent title, and a small institution's CEO as a buyer", () => {
    expect(buyerRelevance({ title: "VP of Retail & Business Development", role: "retail" }, 500_000)).toBe(1);
    expect(buyerRelevance({ title: "President/CEO", role: "executive" }, 200_000)).toBe(1);
    expect(buyerRelevance({ title: "President/CEO", role: "executive" }, 1_500_000)).toBe(0.8);
    expect(buyerRelevance({ title: "SVP, Chief Operating Officer", role: "operations" }, 300_000)).toBe(0.6);
  });

  it("names the research problem that fits the buyer's role", () => {
    expect(roleProblem({ title: "Chief Financial Officer", role: "finance" }).opening).toBe("Preparing a competitive fee review for management or the board");
    expect(roleProblem({ title: "VP of Retail", role: "retail" }).useFor).toBe("your deposit-account reviews");
    expect(roleProblem({ title: "President", role: "executive" }).opening).toBe("Keeping track of what competitors charge");
  });

  it("frames a credit union's buyer for members, the board, ALCO or the supervisory committee", () => {
    expect(roleProblem({ title: "Chief Financial Officer", role: "finance" }, "credit_union")).toEqual({ opening: "Preparing a competitive fee review for the board or ALCO", useFor: "your next ALCO or board review" });
    expect(roleProblem({ title: "VP of Member Experience", role: "retail" }, "credit_union").useFor).toBe("your member deposit-account reviews");
    expect(roleProblem({ title: "Compliance Officer", role: "compliance" }, "credit_union").opening).toContain("supervisory committee");
    expect(roleProblem({ title: "President", role: "executive" }, "credit_union").opening).toBe("Keeping track of what other credit unions and banks charge");
    expect(roleProblem({ title: "President", role: "executive" }, "bank").opening).toBe("Keeping track of what competitors charge");
  });
});
