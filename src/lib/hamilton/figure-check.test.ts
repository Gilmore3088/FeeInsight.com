import { describe, expect, it } from "vitest";
import type { FiledFeeIncome } from "@/lib/data-store/fee-revenue";
import { feeIncomeAgainstPeers } from "@/lib/research/fee-income-peers";
import { assetTierBoundFacts } from "./asset-tier-facts";
import { ASSET_TIER_BOUNDS, checkNarrativeFigures, extractFigures, extractQuestionFigures } from "./figure-check";

describe("extractFigures", () => {
  it("reads dollars (with separators and scale words) and percentages", () => {
    const figures = extractFigures("Revenue of $1.2 million, a $35.00 fee, $2,500 wires and 12.5% growth (3 percent).");
    expect(figures.map((f) => [f.kind, f.value])).toEqual([
      ["usd", 1_200_000],
      ["usd", 35],
      ["usd", 2500],
      ["pct", 12.5],
      ["pct", 3],
    ]);
  });
});

describe("checkNarrativeFigures", () => {
  const data = { institution_amount: 35.5, peer_median: 30, peer_p75: 36, ratio: 0.142, revenue: 1_234_567 };

  it("matches payload values within the figure's own rounding", () => {
    expect(checkNarrativeFigures("Your $35.50 fee vs a $30 median; p75 is $36.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("About $36 against peers.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Service charges were $1.2 million.", data).unmatched).toEqual([]);
  });

  it("accepts differences, percent differences and ratios expressed as percentages", () => {
    expect(checkNarrativeFigures("$5.50 above the median, 18.3% higher; fee ratio 14.2%.", data).unmatched).toEqual([]);
  });

  it("flags figures the data does not support", () => {
    expect(checkNarrativeFigures("Peers average $42 and fees rose 27%.", data).unmatched).toEqual(["$42", "27%"]);
  });

  it("reports nothing to check when the narrative has no figures", () => {
    expect(checkNarrativeFigures("Pricing is competitive.", data)).toEqual({ checked: 0, unmatched: [] });
  });
});

describe("explicit field units in mixed financial rows (#2358)", () => {
  const data = {
    source: "ncua", units: "thousands of dollars",
    service_charge_income: 153080, avg_fee: 30, fee_income_ratio: 0.0382,
    income_per_10k_assets: 7.49, absolute: 1200000,
    field_units: { avg_fee: "USD", fee_income_ratio: "fraction", income_per_10k_assets: "USD income per 10,000 USD assets", absolute: "thousands of dollars" },
  };
  const options = { explicitFinancialDerivations: true };

  it("uses per-field units before the shared scale, including explicitly tagged nonmoney field names", () => {
    expect(checkNarrativeFigures("Income was $153.08 million, the fee was $30, revenue share was 3.82%, and deposits were $1.2 billion.", data, options).unmatched).toEqual([]);
  });

  it("keeps wrong scales, fractions, asset intensity, and unvalidated NCUA arithmetic held", () => {
    expect(checkNarrativeFigures("The fee was $30,000. Revenue share was 0.0382%. Income was $7,490 or 7.49% of revenue. The gap was $153.07997 million.", data, options).unmatched).toEqual(["$30,000", "$7,490", "$153.07997 million", "0.0382%", "7.49%"]);
    expect(checkNarrativeFigures("Income was $1.2 billion.", { ...data, field_units: { absolute: "unrecognized" } }, options).unmatched).toEqual(["$1.2 billion"]);
  });
});

describe("explicit asset-intensity quantities (#2361)", () => {
  const data = { source: "ncua", income_per_10k_assets: 7.49, field_units: { income_per_10k_assets: "USD income per 10,000 USD assets" } };
  const options = { explicitFinancialDerivations: true };
  it.each([
    "Fee income was $7.49 per $10,000 of total assets.",
    "Fee income per ten thousand dollars of assets was $7.49.",
    "Fee income was $7.49 per ten thousand dollars of assets.",
  ])("accepts exactly the typed dollar-per-asset quantity: %s", (text) => {
    expect(checkNarrativeFigures(text, data, options)).toEqual({ checked: 1, unmatched: [] });
  });
  it.each([
    "Fee income was $7.49.", "Fee income was 7.49% of revenue.",
    "Fee income was $7.49 per account.", "Fee income was $7.49 per $1,000 of total assets.",
    "Fee income was $7.49 per $10,000 of revenue.",
  ])("holds a different quantity: %s", (text) => {
    expect(checkNarrativeFigures(text, data, options).unmatched.length).toBeGreaterThan(0);
  });
  it("cannot convert an ordinary dollar total to asset intensity, including legacy bank figures", () => {
    for (const source of ["ncua", "fdic"]) {
      expect(checkNarrativeFigures("Income was $7.49 per $10,000 of assets.", { source, amount: 7.49, unit: "USD" }, options).unmatched).toEqual(["$7.49"]);
    }
  });
});

describe("the per-$10,000-of-assets denominator in any wording (#1077)", () => {
  // Invented rows for tests only: the peers view's shape, values rounded to cents as the tool sends them.
  const filed = (id: number, ratio: number): FiledFeeIncome => ({
    institution_id: id, institution_name: `Synthetic CU ${id}`, charter_type: "credit_union", state_code: "VA",
    asset_size_tier: "large_regional", fed_district: 5, report_date: "2026-06-30", financial_source: "ncua",
    total_assets: 1_000_000 * id, service_charge_income: 100 * id, fee_income_ratio: ratio,
  });
  const evidence = feeIncomeAgainstPeers(
    [filed(1, 15.14), ...[2, 3, 4, 5, 6, 7, 8].map((id) => filed(id, 10 + id / 100))], 1, {});
  const options = { explicitFinancialDerivations: true };

  it.each([
    "Fee income was $15.14 per $10,000 in assets.",
    "Fee income was $15.14 per $10,000 of assets.",
    "Fee income was **$15.14** per **$10,000** in total assets.",
    "Fee income was $15.14 for every $10,000 of assets.",
    "Fee income was $15.14 for each $10,000 in assets.",
    "Fee income was $15.14 per $10K in assets.",
    "Fee income was $15.14 per $10k of assets.",
    "Fee income was $15.14/$10,000 of assets.",
    "Fee income was $15.14 per ten thousand dollars in assets.",
    "For every $10,000 in assets, fee income was $15.14.",
    "Fee income per $10K of assets was $15.14.",
  ])("traces a ratio the evidence types as income per ten thousand dollars of assets: %s", (text) => {
    expect(checkNarrativeFigures(text, evidence, options)).toMatchObject({ unmatched: [] });
    expect(extractFigures(text).filter((f) => f.kind === "usd")).toEqual([
      expect.objectContaining({ value: 15.14, denominatorUnit: "ten_thousand_assets" }),
    ]);
  });

  it("holds a ratio the evidence does not hold, in every wording", () => {
    for (const text of [
      "Fee income was $16.02 per $10,000 in assets.",
      "Fee income was $16.02 for every $10K of assets.",
      "For every $10,000 in assets, fee income was $16.02.",
    ]) expect(checkNarrativeFigures(text, evidence, options).unmatched).toEqual(["$16.02"]);
  });

  it("never traces a ratio from an untyped dollar figure of the same value", () => {
    expect(checkNarrativeFigures("Fee income was $15.14 per $10,000 in assets.", { source: "ncua", amount: 15.14, unit: "USD" }, options).unmatched)
      .toEqual(["$15.14"]);
  });

  it("holds a bare $10,000 that is no ratio's denominator", () => {
    for (const text of [
      "A $10,000 deposit earns no fee.",
      "Fee income per $10,000 in assets rose this quarter.",
      "Its fee income was $10,000 in assets terms.",
      "Fee income was $15.14 per $10,000 of revenue.",
    ]) expect(checkNarrativeFigures(text, evidence, options).unmatched).toContain("$10,000");
  });

  // A filed ratio of 35.10 beside a $30 overdraft fee: a $35 fee must never borrow the ratio's unit.
  const withFee = [
    feeIncomeAgainstPeers([filed(1, 35.1), filed(2, 12), ...[3, 4, 5, 6, 7, 8].map((id) => filed(id, 10 + id / 100))], 1, {}),
    { fee_category: "overdraft", amount: 30, unit: "USD" },
  ];

  it.each([
    "For every $10,000 in assets, the overdraft fee is $35.",
    "Per $10,000 of assets, the bank's overdraft fee of $35 compares with peers.",
    "Income per $10,000 of assets\n\nThe overdraft fee is $35.",
    "Fee income per $10,000 of assets. Its fee is $35.",
  ])("holds a fee that only follows the denominator: %s", (text) => {
    expect(checkNarrativeFigures(text, withFee, options).unmatched).toContain("$35");
    expect(extractFigures(text).find((f) => f.raw === "$35")?.denominatorUnit).toBeUndefined();
  });

  it("gives every figure in a list the denominator they share", () => {
    const text = "Fee income was $35.10 and $12.00 per $10,000 of assets.";
    expect(extractFigures(text).map((f) => [f.raw, f.denominatorUnit])).toEqual([
      ["$35.10", "ten_thousand_assets"], ["$12.00", "ten_thousand_assets"],
    ]);
    expect(checkNarrativeFigures(text, withFee, options).unmatched).toEqual([]);
    // Listed under the denominator, the $30 reads as a ratio, finds no filed ratio of 30 and holds.
    expect(checkNarrativeFigures("The fee is $30 and $35.10 per $10,000 of assets.", withFee, options).unmatched).toEqual(["$30"]);
    expect(checkNarrativeFigures("Fee income was $35.10, or $12.50 per $10,000 of assets.", withFee, options).unmatched).toEqual(["$12.50"]);
  });
});

describe("figures that are not the data's to trace (#1425)", () => {
  const data = { institution_amount: 35, peer_median: 30 };

  it("accepts a figure the reader's question names, and nothing else from outside the data", () => {
    const text = "At $40, the fee you asked about would sit above the $30 peer median; $47.13 is not in the data.";
    expect(checkNarrativeFigures(text, data).unmatched).toEqual(["$40", "$47.13"]);
    expect(checkNarrativeFigures(text, data, { question: "Would a $40 overdraft fee be high?" }).unmatched).toEqual(["$47.13"]);
  });

  it("accepts an asset-tier bound stated as a size range or threshold", () => {
    for (const text of [
      "Among banks with $1 billion to $10 billion in assets, the median is $30.",
      "Peers in the $300M to $1B tier charge $30.",
      "Banks with between $1 billion and $10 billion in total assets charge $30.",
      "Banks under $1 billion in assets charge $30.",
      "Among institutions with assets above $10 billion, the median is $30.",
      "Reported assets from $10 billion up to, but not including, $250 billion.",
      "Reported assets from $10 billion to $250 billion.",
      "Credit unions with $10 billion to under $250 billion in assets.",
      "Credit unions with reported assets of at least $10 billion and under $250 billion.",
    ]) expect(checkNarrativeFigures(text, data).unmatched, text).toEqual([]);
  });

  it("still holds a tier bound stated as money, even beside the word assets (review of #1425)", () => {
    for (const [text, unmatched] of [
      ["The bank earned $1 billion in fee income. Its assets are large.", ["$1 billion"]],
      ["The bank earned $1 billion in fees, with assets of $10 billion.", ["$1 billion", "$10 billion"]],
      ["Overdraft revenue hit $1B in the community tier.", ["$1B"]],
      ["Banks under $1 billion in assets charge a $1 billion overdraft fee.", ["$1 billion"]],
      ["The bank has $10 billion in assets.", ["$10 billion"]],
      // Only the tiers' own bounds: $5 billion is not one.
      ["Banks with $5 billion in assets charge $30.", ["$5 billion"]],
      ["Fee income from $10 billion up to, but not including, $250 billion.", ["$10 billion", "$250 billion"]],
      ["Fee income from $10 billion to under $250 billion.", ["$10 billion", "$250 billion"]],
      ["Institutions with $5 billion to under $250 billion in assets.", ["$5 billion"]],
      ["Credit unions with $10 billion to under $250 billion in assets had $10 billion in fee income.", ["$10 billion"]],
      ["Reported assets from $10 billion up to, but not including, $250 billion. Fee income was $10 billion.", ["$10 billion"]],
    ] as const) expect(checkNarrativeFigures(text, data).unmatched, text).toEqual(unmatched);
  });

  it("keeps an explicitly defined asset range when a follow-up names the same peer group", () => {
    const definition = "The group is credit unions with $10 billion to $50 billion in assets. ";
    expect(checkNarrativeFigures(definition + "How does fee income compare with peers in the $10 billion to $50 billion group?", {}).unmatched).toEqual([]);
    expect(checkNarrativeFigures("How does fee income compare with peers in the $10 billion to $50 billion group?", {}).unmatched).toEqual(["$10 billion", "$50 billion"]);
    expect(checkNarrativeFigures(definition + "The credit union earned $10 billion in fee income.", {}).unmatched).toEqual(["$10 billion"]);
    expect(checkNarrativeFigures(definition + "How does income compare with peers in the $1 billion to $10 billion group?", {}).unmatched).toEqual(["$1 billion", "$10 billion"]);
  });
});

describe("explicit monetary units and compacted evidence (#2274)",()=>{
  it.each([
    ["thousands_dollars",1234,"$1.234 million"],
    ["thousands of dollars",1234,"$1.234 million"],
    ["millions_dollars",1.234,"$1.234 million"],
    ["billions_dollars",1.234,"$1.234 billion"],
    ["dollars (billions)",1.234,"$1.234 billion"],
  ])("normalizes %s before matching a stated dollar amount",(unit,value,text)=>{
    expect(checkNarrativeFigures(String(text),{rows:[{value,unit}]}).unmatched).toEqual([]);
  });
  it("rejects the unscaled amount and scales arithmetic differences consistently",()=>{
    const data={rows:[{value:1234,unit:"thousands_dollars"},{value:1000,unit:"thousands_dollars"}]};
    expect(checkNarrativeFigures("The difference is $234 thousand.",data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Income is $1,234, with a $234 gap.",data).unmatched).toEqual(["$1,234","$234"]);
  });
  it("keeps financial dollar units on nested records and fractions on ratio fields",()=>{
    const data={financials:{units:"dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)",
      latest:{service_charge_income:311051,fee_income_ratio:0.068,employee_count:4}},fees:[{amount:35}]};
    expect(checkNarrativeFigures("Income was $311.05 million, a 6.8% share. The fee is $35.",data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("The fee is $35 thousand and the ratio is $0.068.",data).unmatched).toEqual(["$35 thousand","$0.068"]);
  });
  it("reads valid compacted JSON without treating ordinary prose as supporting evidence",()=>{
    const data={_shortened:true,text:JSON.stringify({rows:[{value:"1,234",unit:"thousands of dollars"}]})};
    expect(checkNarrativeFigures("Income was $1.234 million.",data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Income was $1.234 million.","Income was $1.234 million.").unmatched).toEqual(["$1.234 million"]);
  });
  it("keeps rates, counts and other currencies out of dollar candidates",()=>{
    for(const unit of ["percent","persons","count","Canadian dollars","euros"])
      expect(checkNarrativeFigures("The amount is $4.10.",{value:4.1,unit}).unmatched,unit).toEqual(["$4.10"]);
    expect(checkNarrativeFigures("The rate is 4.1%.",{value:4.1,unit:"percent"}).unmatched).toEqual([]);
    expect(checkNarrativeFigures("The rate is 410%.",{value:4.1,unit:"percent"}).unmatched).toEqual(["410%"]);
    expect(checkNarrativeFigures("The rate is 14.2%.",{value:0.142,unit:"fraction"}).unmatched).toEqual([]);
  });
  it("keeps legitimate zero and excludes ids/counts under a monetary caption",()=>{
    expect(checkNarrativeFigures("Income was $0.",{value:0,unit:"thousands_dollars"}).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Income was $4 thousand.",{units:"thousands_dollars",institution_id:4,employee_count:4}).unmatched).toEqual(["$4 thousand"]);
  });
  it("preserves legacy unannotated dollar growth fields and explicit monetary growth units", () => {
    expect(checkNarrativeFigures("Deposit growth was $1,234.", { deposit_growth: 1234 }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Deposit growth was $1.234 million.", { deposit_growth: 1234, unit: "thousands_dollars" }).unmatched).toEqual([]);
  });
});

describe("written NCUA answers use explicit financial derivations", () => {
  const options = { explicitFinancialDerivations: true };
  const filings = {
    measure: "call:acct_131", scope: "institution", unit: "USD",
    rows: [{ value: 57_261_959, period: "2026-06-30", source: "ncua", period_basis: "ytd" },
      { value: 27_229_618, period: "2026-03-31", source: "ncua", period_basis: "ytd" }],
  };

  it("keeps observed NCUA values but requires a server-calculated candidate for a standalone quarter", () => {
    expect(checkNarrativeFigures("The cumulative filings were $57.26 million and $27.23 million.", filings, options).unmatched).toEqual([]);
    expect(checkNarrativeFigures("The quarter was $30.03 million.", filings, options).unmatched).toEqual(["$30.03 million"]);
    // Existing non-written consumers retain their historical numerical check.
    expect(checkNarrativeFigures("The quarter was $30.03 million.", filings).unmatched).toEqual([]);
    expect(checkNarrativeFigures("The quarter was $30.03 million.", { filings, validated_calculations: [{ value: 30_032_341, unit: "USD", source: "ncua", operation: "ytd_to_quarter" }] }, options).unmatched).toEqual([]);
  });

  it("does not combine different NCUA subjects, dates or metrics into a matching subtraction or percentage", () => {
    const data = { facts: [{ institution_id: 1, value: 120, unit: "USD", source: "ncua", metric: "income" },
      { institution_id: 2, value: 80, unit: "USD", source: "ncua", metric: "balance" }] };
    expect(checkNarrativeFigures("The income was $120, a $40 gain and 50% growth.", data, options).unmatched).toEqual(["$40", "50%"]);
  });

  it("never derives quarterly peer income by subtracting separate NCUA medians", () => {
    const data = { measure: "call:acct_131", scope: "peer_set", rows: [{ median: 80, unit: "USD", sources: "ncua" }, { median: 30, unit: "USD", sources: "ncua" }] };
    expect(checkNarrativeFigures("The reported median was $80. Quarterly peer income was $50, up 166.7%.", data, options).unmatched).toEqual(["$50", "166.7%"]);
  });

  it("does not re-derive additional arithmetic from validated calculation values", () => {
    const data = { validated_calculations: [{ value: 30_032_341, unit: "USD", source: "ncua" }, { value: 796_408, unit: "USD", source: "ncua" }] };
    expect(checkNarrativeFigures("The values were $30.03 million and $796,408, implying $29.24 million.", data, options).unmatched).toEqual(["$29.24 million"]);
  });

  it("honors direct-only wrappers through nested and compacted JSON without rejecting the observed amounts", () => {
    const data = { numeric_arithmetic_allowed: false, nested: JSON.stringify({ rows: [{ value: 100, unit: "USD" }, { value: 30, unit: "USD" }] }) };
    expect(checkNarrativeFigures("The figures were $100 and $30; the gap was $70.", data, options).unmatched).toEqual(["$70"]);
  });

  it("preserves ordinary fee comparison arithmetic alongside NCUA evidence", () => {
    const data = { filings, fees: { period_basis: "fee_schedule", source: "ncua", institution_amount: 35, peer_median: 30 } };
    expect(checkNarrativeFigures("The $35 price is $5 or 16.7% above the $30 median.", data, options).unmatched).toEqual([]);
    expect(checkNarrativeFigures("The maintenance fee is $35 per account.", data, options).unmatched).toEqual([]);
    expect(checkNarrativeFigures("The price is $27,229,583 lower.", data, options).unmatched).toEqual(["$27,229,583"]);
  });

  it.each(["fdic", "ffiec"])("leaves %s arithmetic unchanged in the first bounded NCUA release", (source) => {
    const data = { source, rows: [{ value: 100, unit: "USD" }, { value: 80, unit: "USD" }] };
    expect(checkNarrativeFigures("The $20 increase was 25%.", data, options).unmatched).toEqual([]);
  });

  it("accepts an explicitly validated percentage as a percentage without multiplying it again", () => {
    const data = { source: "ncua", validated_calculations: [{ value: 2.724072462, unit: "percent" }] };
    expect(checkNarrativeFigures("Quarterly income increased 2.7%.", data, options).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Quarterly income increased 272.4%.", data, options).unmatched).toEqual(["272.4%"]);
  });
});

describe("derived dollar ratios retain their denominator", () => {
  const data = { validated_calculations: [{ value: 2497.471532, unit: "USD", denominator_unit: "account", source: "ncua", operation: "ratio" }] };
  const options = { explicitFinancialDerivations: true };

  it.each([
    "The balance was $2,497 per account.",
    "The balance was $2,497 per checking account.",
    "The balance was $2,497/share-draft account.",
    "The per-account balance was $2,497.",
    "The balance was **$2,497** per account.",
  ])("matches the explicit per-account quantity: %s", (text) => {
    expect(checkNarrativeFigures(text, data, options).unmatched).toEqual([]);
  });

  it.each([
    "Fee income was $2,497.",
    "The fee price was $2,497.",
    "The balance was $2,497 per employee.",
    "The balance was $2,497 per member.",
    "Accounts grew. Fee income was $2,497.",
  ])("does not use a ratio to substantiate another quantity: %s", (text) => {
    expect(checkNarrativeFigures(text, data, options).unmatched).toEqual(["$2,497"]);
  });

  it("does not label a total balance as a per-account amount or mix total/ratio arithmetic", () => {
    const totals = { facts: [{ value: 2497.471532, unit: "USD", source: "ncua" }] };
    expect(checkNarrativeFigures("The balance was $2,497 per account.", totals, options).unmatched).toEqual(["$2,497"]);
    expect(checkNarrativeFigures("The gap was $2,487.", { ...data, price: { amount: 10, unit: "USD" } }, options).unmatched).toEqual(["$2,487"]);
  });
});

describe("checkNarrativeFigures: fee maps keyed by category (T5, #1726)", () => {
  // The local competitor read's shape: prices keyed by fee category alone.
  const local = {
    institution: "Harbor Point Bank", institution_id: 9101, your_fees: { overdraft: 30 },
    competitors: [{ institution_id: 9131, name: "Synthetic Competitor One", fees: { overdraft: 25, nsf: 27 } }],
  };

  it("traces a price stated from your_fees or a competitor's fees", () => {
    expect(checkNarrativeFigures("Harbor Point Bank charges $30; its competitor charges $25 and $27 for NSF.", local).unmatched).toEqual([]);
  });

  it("still never traces an id or count inside a fee map", () => {
    expect(checkNarrativeFigures("A fee of $9131.", local).unmatched).toEqual(["$9131"]);
    expect(checkNarrativeFigures("It charges $4.", { fees: { overdraft_count: 4 } }).unmatched).toEqual(["$4"]);
  });

  it("reads only plain-object maps under your_fees or competitors[].fees, never items of an array named fees", () => {
    const rows = { fees: [{ institutionId: 4821, sourceDocumentId: 99123, amount: 30 }] };
    expect(checkNarrativeFigures("A fee of $4821.", rows).unmatched).toEqual(["$4821"]);
    expect(checkNarrativeFigures("A fee of $30.", rows).unmatched).toEqual([]);
    expect(checkNarrativeFigures("A fee of $5.", { your_fees: { "2024": 5 } }).unmatched).toEqual(["$5"]);
    // A `fees` map outside a competitors array is not the local read's.
    expect(checkNarrativeFigures("A fee of $6.", { fees: { overdraft: 6 } }).unmatched).toEqual(["$6"]);
  });
});

describe("asset-tier bounds as typed evidence and question sizes without a $ (#1077)", () => {
  const data = { peer_median: 30 };
  const withTiers = (...tiers: string[]) => ({ ...data, asset_tier_bounds: assetTierBoundFacts({ asset_tiers: tiers }) });

  it("traces the paid replay's tier phrasings to the tier in the evidence, and holds them without it", () => {
    for (const [text, tier, figure] of [
      ["Credit unions under $10 billion charge a $30 median.", "community_large", "$10 billion"],
      ["Banks over $250 billion charge a $30 median.", "super_regional", "$250 billion"],
      ["Banks with $10 billion in assets and up charge a $30 median.", "regional", "$10 billion"],
    ] as const) {
      expect(checkNarrativeFigures(text, withTiers(tier)).unmatched, text).toEqual([]);
      if (!text.includes("in assets")) expect(checkNarrativeFigures(text, data).unmatched, text).toEqual([figure]);
    }
  });

  it("holds a figure that is no bound of the evidence's tiers, and never pools bounds into arithmetic", () => {
    expect(checkNarrativeFigures("Credit unions under $7 billion charge $30.", withTiers("community_large", "super_regional")).unmatched).toEqual(["$7 billion"]);
    expect(checkNarrativeFigures("Banks over $5 billion charge $30.", withTiers("community_large", "regional")).unmatched).toEqual(["$5 billion"]);
    expect(checkNarrativeFigures("The tier spans $9 billion.", withTiers("community_large")).unmatched).toEqual(["$9 billion"]);
    // A tier that starts at zero states no "$0" bound.
    expect(checkNarrativeFigures("Fees of $0 apply.", withTiers("community_small")).unmatched).toEqual(["$0"]);
  });

  it("reads the tier codes the reads carry: a peer filter, a CSV list, a registry row and a JSON string", () => {
    expect(assetTierBoundFacts([{ input: { asset_tiers: "community_mid,community_large" } }, { identity: { asset_tier: "super_regional" } },
      JSON.stringify({ assetTiers: ["community_mid"], tier: "unknown_tier", evidence_tier: "regulatory" })])).toEqual([
      { asset_tier: "community_mid", min_assets: 300e6, max_assets: 1e9, unit: "USD", numeric_arithmetic_allowed: false, source: "asset tier definition" },
      { asset_tier: "community_large", min_assets: 1e9, max_assets: 10e9, unit: "USD", numeric_arithmetic_allowed: false, source: "asset tier definition" },
      { asset_tier: "super_regional", min_assets: 250e9, unit: "USD", numeric_arithmetic_allowed: false, source: "asset tier definition" },
    ]);
    // The phrase rule's bounds are exactly the tiers' own.
    expect(ASSET_TIER_BOUNDS).toEqual([100e6, 300e6, 1e9, 10e9, 50e9, 250e9]);
  });

  it("reads a question's sizes given without a $ as dollars", () => {
    expect(extractQuestionFigures("credit unions < 10B, 5B, $10bn, 250 billion, 2.5 million members, 30k members and 10 banks").filter((f) => f.kind === "usd").map((f) => f.value))
      .toEqual([10e9, 10e9, 5e9, 250e9]);
    for (const [question, text] of [
      ["How do credit unions < 10B price overdraft?", "Credit unions under $10 billion charge $30."],
      ["What about institutions over 5B?", "Institutions over $5 billion charge $30."],
      ["Compare banks above $10bn.", "Banks above $10 billion charge $30."],
      ["And banks over 250 billion?", "Banks over $250 billion charge $30."],
    ] as const) {
      expect(checkNarrativeFigures(text, data, { question }).unmatched, question).toEqual([]);
      expect(checkNarrativeFigures(text, data).unmatched.length, text).toBe(1);
    }
    // A bare count is not a dollar figure; an unrelated figure still holds.
    expect(checkNarrativeFigures("Ten banks charge $10.", data, { question: "List 10 banks." }).unmatched).toEqual(["$10"]);
    expect(checkNarrativeFigures("Banks over $7 billion charge $30.", data, { question: "Banks under 10B?" }).unmatched).toEqual(["$7 billion"]);
  });

  it("never reads a count in the question as dollars (review of f2046e3f7)", () => {
    expect(checkNarrativeFigures("Overdraft income was $2 million.", data,
      { question: "We serve 2 million members; how does our overdraft compare?" }).unmatched).toEqual(["$2 million"]);
    expect(checkNarrativeFigures("Overdraft income was $30,000.", data,
      { question: "We have 30k members; how does our overdraft compare?" }).unmatched).toEqual(["$30,000"]);
  });

  it("gives 'regional' only its shared minimum: the FDIC tier runs to $250 billion, the stored segment to $50 billion", () => {
    const fdicRead = { by_tier: [{ asset_size_tier: "regional", mean_listed_fee_usd: 12 }] };
    const evidence = { ...fdicRead, asset_tier_bounds: assetTierBoundFacts(fdicRead) };
    expect(evidence.asset_tier_bounds).toEqual([{ asset_tier: "regional", min_assets: 10e9, unit: "USD", numeric_arithmetic_allowed: false, source: "asset tier definition" }]);
    expect(checkNarrativeFigures("Regional banks, those under $50 billion, list a $12 mean fee.", evidence).unmatched).toEqual(["$50 billion"]);
    expect(checkNarrativeFigures("Regional banks, those under $250 billion, list a $12 mean fee.", evidence).unmatched).toEqual(["$250 billion"]);
    expect(checkNarrativeFigures("Regional banks, those over $10 billion, list a $12 mean fee.", evidence).unmatched).toEqual([]);
  });
});
