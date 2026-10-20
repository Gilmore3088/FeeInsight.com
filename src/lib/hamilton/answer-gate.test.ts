import { describe, expect, it } from "vitest";
import { checkAnswerEvidence, HELD_ANSWER_MESSAGE } from "./answer-gate";
import { memoProblems } from "./memo";

const DATA = { fee: 35, peer_median: 29 };

describe("checkAnswerEvidence", () => {
  it("passes figures that trace to the data and plain position wording", () => {
    const check = checkAnswerEvidence("The fee of $35 is $6 above the $29 peer median, a higher price.", DATA);
    expect(check).toMatchObject({ passed: true, problems: [], figureCheck: { checked: 3, unmatched: [] } });
  });

  it("names each failure the memo gate names", () => {
    const check = checkAnswerEvidence("At $41 the bank should lower the fee; Knox says it is the cheapest in published_fee_catalog.", DATA);
    expect(check.passed).toBe(false);
    expect(check.problems).toEqual([
      "These figures are not in DATA: $41.",
      'This reads as advice: "should". Lay out the paths without choosing.',
      'Internal name in the text: "Knox".',
      '"cheapest" is not house wording. Say "lower" or "higher" price.',
    ]);
  });

  it("is the gate the memo uses, word for word", () => {
    const text = "At $41 the bank should lower the fee.";
    const memo = memoProblems({ summary: text, board: "Board.", market: "Market.", questions: [] }, DATA);
    for (const problem of checkAnswerEvidence(text, DATA).problems) expect(memo.problems).toContain(problem);
  });

  it("ships James's held line, which names no figure and no internal term (#981)", () => {
    expect(HELD_ANSWER_MESSAGE).toBe("This answer didn't pass Hamilton's source check, so it isn't shown. Ask again, or name one fee to compare.");
    expect(checkAnswerEvidence(HELD_ANSWER_MESSAGE ?? "", DATA).passed).toBe(true);
  });

  it("uses scaled financial evidence through the actual answer gate (#2274)", () => {
    const evidence = { toolResults: [{ output: { _shortened: true, text: JSON.stringify({
      financials: { units: "dollar amounts in thousands; fee_income_ratio is a fraction (0.068 = 6.8%)",
        latest: { service_charge_income: 311051, fee_income_ratio: 0.068 } },
    }) } }] };
    expect(checkAnswerEvidence("Service-charge income was $311.05 million, with a 6.8% fee-income ratio.", evidence).passed).toBe(true);
    expect(checkAnswerEvidence("Service-charge income was $311,051.", evidence).problems).toEqual([
      "These figures are not in DATA: $311,051.",
    ]);
  });
});
