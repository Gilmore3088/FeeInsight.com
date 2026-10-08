import { describe, expect, it } from "vitest";
import { studyObservations, withStudyPlace, type StudyPlacementRow } from "./studies";
import type { Observation } from "./types";

function row(over: Partial<StudyPlacementRow>): StudyPlacementRow {
  return {
    studyKey: "fee_dependence",
    title: "Fee dependence since 2010",
    asOf: "2025",
    studyN: 183766,
    studyHeadline: null,
    metric: "fee_share_of_revenue_pct",
    value: 3.83,
    peerGroup: "banks $10B+",
    peerN: 151,
    peerMedian: 2.87,
    percentile: 66.6,
    detail: { year: 2025, charter: "bank", first_year: 2010, first_year_value: 6.47 },
    ...over,
  };
}

const priceRow = row({
  studyKey: "local_income",
  title: "Local income and fee prices",
  asOf: "2026-Q4",
  studyN: 3006,
  studyHeadline: "The overdraft fee runs $0.21 lower per $10,000 of local median household income, holding size and charter fixed.",
  metric: "local_income",
  value: 90889.68,
  peerGroup: "all institutions in this study",
  peerN: 3006,
  peerMedian: 70521.03,
  percentile: 84.1,
  detail: {
    fifth: 5,
    fees: {
      overdraft: { price: 34, fifth_n: 317, fifth_median: 30, price_percentile_in_fifth: 79.2 },
      monthly_maintenance: { price: 15, fifth_n: 177, fifth_median: 8.5, price_percentile_in_fifth: 87 },
      nsf: { price: 30, fifth_n: 3, fifth_median: 25, price_percentile_in_fifth: 99 },
    },
  },
});

const inferredRow = row({
  studyKey: "inferred_items_paid",
  title: "Inferred overdraft and NSF items paid",
  asOf: "2026-06-30",
  metric: "inferred_overdraft_nsf_items",
  value: 26817647,
  peerGroup: "banks $10B+",
  peerN: 75,
  peerMedian: 406200,
  percentile: 98,
  detail: { label: "inferred", income: 1164000000, period: "2026-06-30", fee_low: 34, fee_high: 60, items_low: 19400000, items_high: 34235294 },
});

describe("studyObservations", () => {
  it("places a bank's fee dependence against its charter and size", () => {
    const [o] = studyObservations([row({})]);
    expect(o.kind).toBe("study");
    expect(o.headline).toBe("Deposit service charges were 3.83% of your revenue in 2025, higher than the 2.87% median for banks $10B+.");
    expect(o.facts.map((f) => f.text)).toEqual([
      "banks $10B+: median 2.87% across 151 institutions; you are at the 67th percentile.",
      "In 2010 the share was 6.47%.",
    ]);
    expect(o.facts[0].source).toEqual({ label: "Hamilton study: Fee dependence since 2010", table: "hamilton_studies", asOf: "2025" });
  });

  it("names fee income for a credit union", () => {
    const [o] = studyObservations([row({ peerGroup: "credit unions $1B-$10B", detail: { year: 2025, charter: "credit_union" }, value: 2.5, peerMedian: 2.5 })]);
    expect(o.headline).toBe("Fee income was 2.50% of your revenue in 2025, about the same as the 2.50% median for credit unions $1B-$10B.");
  });

  it("compares the fee furthest from its income fifth's median, skipping thin groups", () => {
    const [o] = studyObservations([priceRow]);
    expect(o.feeCategory).toBe("monthly_maintenance");
    expect(o.headline).toBe(
      "Your monthly maintenance fee of $15 is higher than the $8.50 median of 177 institutions whose markets have similar household income.",
    );
    expect(o.facts.map((f) => f.text)).toEqual([
      "Median household income across your markets: $90,890, higher than 84% of the 3,006 institutions in the study.",
      "Across the study: The overdraft fee runs $0.21 lower per $10,000 of local median household income, holding size and charter fixed.",
    ]);
  });

  it("labels items paid as inferred and shows the range", () => {
    const [o] = studyObservations([inferredRow]);
    expect(o.headline).toBe("Your overdraft and NSF income implies about 19.4 million to 34.2 million overdraft and NSF items paid in the four quarters to 2026-06-30.");
    expect(o.facts[0].text).toBe(
      "Inferred, not reported: $1.16B of reported overdraft and NSF income (net of waivers and refunds) divided by your published $34 to $60 fee.",
    );
    expect(o.facts[1].text).toBe("banks $10B+: median about 406,200 items across 75 institutions.");
  });

  it("drops placements with too few peers or missing figures", () => {
    expect(studyObservations([row({ peerN: 3 }), row({ studyKey: "local_income", detail: { fees: {} } }), row({ studyKey: "inferred_items_paid", metric: "inferred_overdraft_nsf_items", detail: {} })])).toEqual([]);
  });

  it("returns one observation per study", () => {
    const out = studyObservations([row({}), priceRow, inferredRow]);
    expect(out.map((o) => o.id).sort()).toEqual(["study:fee_dependence", "study:inferred_items_paid", "study:local_income"]);
  });
});

describe("withStudyPlace", () => {
  const obs = (id: string, salience: number, kind: Observation["kind"] = "market_position"): Observation => ({
    id,
    kind,
    feeCategory: null,
    headline: id,
    facts: [],
    actions: [],
    salience,
  });

  it("keeps the last place for the most notable study when none ranked", () => {
    const ranked = [obs("a", 0.9), obs("b", 0.8), obs("c", 0.7)];
    const out = withStudyPlace(ranked, [obs("s1", 0.3, "study"), obs("s2", 0.5, "study")], 3);
    expect(out.map((o) => o.id)).toEqual(["a", "b", "s2"]);
  });

  it("leaves the list alone when a study already ranked or there is none", () => {
    const ranked = [obs("a", 0.9), obs("s", 0.8, "study")];
    expect(withStudyPlace(ranked, [obs("s", 0.8, "study")], 2)).toBe(ranked);
    expect(withStudyPlace(ranked, [], 2)).toBe(ranked);
  });

  it("adds the study when the list has room", () => {
    expect(withStudyPlace([obs("a", 0.9)], [obs("s", 0.3, "study")], 5).map((o) => o.id)).toEqual(["a", "s"]);
  });
});
