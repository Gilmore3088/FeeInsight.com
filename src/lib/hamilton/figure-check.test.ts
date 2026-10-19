import { describe, expect, it } from "vitest";
import { checkNarrativeFigures, extractFigures } from "./figure-check";

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
    ] as const) expect(checkNarrativeFigures(text, data).unmatched, text).toEqual(unmatched);
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
