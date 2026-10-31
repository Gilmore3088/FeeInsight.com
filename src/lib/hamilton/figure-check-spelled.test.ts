/**
 * Numbers written as words (#975 go-live, #1899): the answer gate reads "twenty-five dollars",
 * "three in ten banks", "half of peers" and "two thirds" as the figures they are, and an
 * unsupported one is held exactly as "$25" or "30%" would be. Ordinary words stay words.
 */
import { describe, expect, it } from "vitest";
import { checkAnswerEvidence } from "./answer-gate";
import { gateAnswer } from "./output-gate";
import { checkNarrativeFigures, extractFigures, extractQuestionFigures } from "./figure-check";
import { HELD_FINDING_FIGURE, holdUntracedFindingFigures } from "./report-finding-claims";
import { parseCardinal } from "./spelled-figures";

const read = (text: string) => extractFigures(text).map((f) => [f.kind, Number(f.value.toFixed(2)), f.raw]);

describe("the gap: a figure in words was never read (#975)", () => {
  it("an unsupported spelled-out figure does not slip through", () => {
    const data = { peer_median: 30, overdraft_share: 0.42 };
    expect(extractFigures("The fee is twenty-five dollars.").map((f) => [f.kind, f.value])).toEqual([["usd", 25]]);
    expect(checkNarrativeFigures("Three in ten banks charge it, and the fee is twenty-five dollars.", data).unmatched)
      .toEqual(["twenty-five dollars", "Three in ten"]);
  });
});

describe("parseCardinal", () => {
  it.each([
    ["zero", 0, 1], ["seven", 7, 1], ["nineteen", 19, 1], ["forty", 40, 1], ["twenty-five", 25, 1], ["ninety nine", 99, 1],
    ["a hundred", 100, 1], ["one hundred and five", 105, 1], ["three hundred twenty-five", 325, 1],
    ["a thousand", 1000, 1000], ["two thousand five hundred", 2500, 1], ["twenty-five thousand", 25000, 1000],
    ["two million", 2e6, 1e6], ["one million two hundred thousand", 1.2e6, 1000], ["a dozen", 12, 1], ["two dozen", 24, 1],
  ])("%s is %d", (words, value, place) => {
    expect(parseCardinal(words)).toEqual({ value, place });
  });

  it.each(["five six", "twelve three", "twenty thirty", "thousand", "hundred", "a five", "thousand million", "twenty hundred"])("%s is not one number", (words) => {
    expect(parseCardinal(words)).toBeNull();
  });
});

describe("each form in words is read as the figure it states", () => {
  it("dollars: cardinals, compounds, scale words and a dollar adjective", () => {
    expect(read("A twenty-five dollar fee, one hundred and five dollars, a thousand dollars and two million dollars.")).toEqual([
      ["usd", 25, "twenty-five dollar"], ["usd", 105, "one hundred and five dollars"],
      ["usd", 1000, "a thousand dollars"], ["usd", 2e6, "two million dollars"],
    ]);
    expect(read("A thirty-five-dollar overdraft fee.")).toEqual([["usd", 35, "thirty-five-dollar"]]);
    expect(read("Twelve dollars, or a dozen dollars.")).toEqual([["usd", 12, "Twelve dollars"], ["usd", 12, "a dozen dollars"]]);
    expect(read("A thirty dollar median; the wire costs one dollar.")).toEqual([["usd", 30, "thirty dollar"], ["usd", 1, "one dollar"]]);
  });

  it("percent: \"percent\" and \"per cent\"", () => {
    expect(read("Fees rose fifteen percent, then twenty per cent.")).toEqual([["pct", 15, "fifteen percent"], ["pct", 20, "twenty per cent"]]);
  });

  it("shares: x in y and x out of y, in words or digits", () => {
    expect(read("Three in ten banks charge it; one in four peers waive it; 2 out of 5 credit unions do.")).toEqual([
      ["pct", 30, "Three in ten"], ["pct", 25, "one in four"], ["pct", 40, "2 out of 5"],
    ]);
  });

  it("fractions of a group: half, a third, two thirds, three quarters", () => {
    expect(read("Half of peers charge it, half the banks in Ohio waive it, a third of credit unions cap it, two thirds of them post it and three-quarters of all institutions list it.")).toEqual([
      ["pct", 50, "Half"], ["pct", 50, "half"], ["pct", 33.33, "a third"], ["pct", 66.67, "two thirds"], ["pct", 75, "three-quarters"],
    ]);
  });

  it("a range in words gives both ends the unit", () => {
    expect(read("Between ten and twenty dollars; two to five million dollars.")).toEqual([
      ["usd", 10, "ten"], ["usd", 20, "twenty dollars"], ["usd", 2e6, "two"], ["usd", 5e6, "five million dollars"],
    ]);
  });

  it("markdown emphasis inside a figure keeps the original characters", () => {
    const text = "The fee is **twenty-five** dollars.";
    const [figure] = extractFigures(text);
    expect(figure).toMatchObject({ kind: "usd", value: 25, raw: "twenty-five** dollars" });
    expect(text.slice(figure.index, figure.index + figure.raw.length)).toBe(figure.raw);
  });
});

describe("ordinary words are not figures", () => {
  it.each([
    "One of the banks charges the fee.",
    "No one in ten years has waived it.",
    "A single fee applies.",
    "It was the first fee on the schedule, and the third bank to post it.",
    "The fee is charged once a month.",
    "The one in Texas is lower, and that one is higher.",
    "A dozen institutions post the fee.",
    "Twelve banks were compared.",
    "The fee is charged in the first half of the year.",
    "It sits in the bottom half of peers.",
    "Every dollar of fee income counts, and a dollar figure is shown.",
    "A third quarter filing and a second half review.",
    "Half an hour later, half the time.",
    "One in five-year terms.",
    "Two in three months.",
    "A quarter of the year passed.",
    "The medians sit as bars on one dollar axis.",
    "Glyphs never fall between two dollar figures.",
    "A two-direction/two-dollar pair binds each.",
  ])("%s", (text) => {
    expect(extractFigures(text)).toEqual([]);
  });
});

describe("the gate checks a figure in words as it checks digits", () => {
  const data = { peer_median: 30, peer_p75: 35, waive_share: 0.3, half_share: 0.5, cap_rate: 0.6667, revenue: 2_000_000 };

  it("a supported figure in words passes, with the digit tolerance", () => {
    expect(checkNarrativeFigures("The median is thirty dollars and the p75 thirty-five dollars.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Three in ten waive it, half of peers charge it, two thirds of banks cap it.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Revenue was two million dollars.", data).unmatched).toEqual([]);
    // As "$2 million" covers $1.5 to $2.5 million, so does "two million dollars".
    expect(checkNarrativeFigures("Revenue was two million dollars.", { revenue: 2_400_000 }).unmatched).toEqual([]);
  });

  it("an unsupported figure in words is unmatched", () => {
    expect(checkNarrativeFigures("The fee is twenty-five dollars.", data).unmatched).toEqual(["twenty-five dollars"]);
    expect(checkNarrativeFigures("Four in ten waive it.", data).unmatched).toEqual(["Four in ten"]);
    expect(checkNarrativeFigures("A quarter of peers charge it.", data).unmatched).toEqual(["A quarter"]);
    expect(checkNarrativeFigures("Fees rose twelve percent.", data).unmatched).toEqual(["twelve percent"]);
    // A share is read as the whole percent it names: three in ten is 30%, not 31%.
    expect(checkNarrativeFigures("Three in ten waive it.", { waive_share: 0.31 }).unmatched).toEqual(["Three in ten"]);
    expect(checkNarrativeFigures("Two thirds of banks cap it.", { cap_rate: 0.66 }).unmatched).toEqual([]);
  });

  it("the shared answer gate fails an answer on a figure in words", () => {
    const check = checkAnswerEvidence("Half of peers charge a twenty-five dollar fee.", { peer_median: 30 });
    expect(check.passed).toBe(false);
    expect(check.problems[0]).toBe("These figures are not in DATA: twenty-five dollar, Half.");
  });

  it("a figure in words the reader's question names may be restated", () => {
    expect(extractQuestionFigures("Is a twenty dollar fee high?").map((f) => [f.kind, f.value])).toEqual([["usd", 20]]);
    expect(checkNarrativeFigures("A $20 fee sits below the thirty dollar median.", data, { question: "Is a twenty dollar fee high?" }).unmatched).toEqual([]);
  });

  it("a denominator in words is the figure's unit, not a dollar total", () => {
    const figures = extractFigures("Fee income was fifteen dollars per ten thousand dollars of assets.");
    expect(figures.map((f) => [f.raw, f.denominatorUnit])).toEqual([["fifteen dollars", "ten_thousand_assets"]]);
  });

  it("a dollar figure in words per account keeps its denominator", () => {
    expect(extractFigures("Deposits were nine thousand dollars per account.")[0]).toMatchObject({ value: 9000, denominatorUnit: "account" });
  });
});

describe("a hold replaces exactly the characters of a figure in words", () => {
  it("holdUntracedFindingFigures swaps only the spelled span", () => {
    const text = "Half of peers charge it; the fee is twenty-five dollars, against a thirty dollar median.";
    const out = holdUntracedFindingFigures(text, null, { peer_median: 30 });
    expect(out.held).toEqual(["twenty-five dollars", "Half"]);
    expect(out.text).toBe(`${HELD_FINDING_FIGURE} of peers charge it; the fee is ${HELD_FINDING_FIGURE}, against a thirty dollar median.`);
  });
});

describe("the one output gate holds an answer on an untraced figure in words", () => {
  const gate = (text: string) => gateAnswer({ surface: "simulate", text, evidence: { kind: "data", data: { peer_median: 30, waive_share: 0.3 } },
    identity: { researchInstitutionId: null, accountInstitutionId: null } });

  it("holds \"twenty-five dollars\" as it holds \"$25\", and passes the traced words", () => {
    const words = gate("The peer median is thirty dollars. The fee is twenty-five dollars.");
    const digits = gate("The peer median is $30. The fee is $25.");
    expect(words.status).toBe("held");
    expect(digits.status).toBe("held");
    expect(words.failures.map((f) => [f.code, f.critical])).toEqual([["untraced_figure", true]]);
    expect(gate("The peer median is thirty dollars, and three in ten banks waive it.").status).toBe("validated");
  });
});
