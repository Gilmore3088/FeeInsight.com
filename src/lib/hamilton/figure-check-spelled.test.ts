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
    expect(read("Half of peers charge it, half the banks in Ohio waive it, a third of credit unions cap it, two thirds of members post it and three-quarters of all institutions list it.")).toEqual([
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
    expect(figure).toMatchObject({ kind: "usd", value: 25, raw: "**twenty-five** dollars" });
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
    expect(checkNarrativeFigures("Three in ten banks waive it, half of peers charge it, two thirds of banks cap it.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Revenue was two million dollars.", data).unmatched).toEqual([]);
    // As "$2 million" covers $1.5 to $2.5 million, so does "two million dollars".
    expect(checkNarrativeFigures("Revenue was two million dollars.", { revenue: 2_400_000 }).unmatched).toEqual([]);
  });

  it("an unsupported figure in words is unmatched", () => {
    expect(checkNarrativeFigures("The fee is twenty-five dollars.", data).unmatched).toEqual(["twenty-five dollars"]);
    expect(checkNarrativeFigures("Four in ten banks waive it.", data).unmatched).toEqual(["Four in ten"]);
    expect(checkNarrativeFigures("A quarter of peers charge it.", data).unmatched).toEqual(["A quarter"]);
    expect(checkNarrativeFigures("Fees rose twelve percent.", data).unmatched).toEqual(["twelve percent"]);
    // A share is read as the whole percent it names: three in ten is 30%, not 31%.
    expect(checkNarrativeFigures("Three in ten banks waive it.", { waive_share: 0.31 }).unmatched).toEqual(["Three in ten"]);
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

describe("a hedged share is read as the band the hedge gives; an unhedged one stays strict", () => {
  const check = (text: string, share: number) => checkNarrativeFigures(text, { waive_share: share }).unmatched;

  it("\"about half\" passes against 48% and fails against 40%", () => {
    expect(check("About half of peers waive it.", 0.48)).toEqual([]);
    expect(check("About half of peers waive it.", 0.4)).toEqual(["half"]);
    // Unhedged, 48% is not half.
    expect(check("Half of peers waive it.", 0.48)).toEqual(["Half"]);
  });

  it.each(["about", "around", "roughly", "approximately"])("%s: within 5 points either way", (hedge) => {
    for (const share of [0.45, 0.48, 0.5, 0.52, 0.55]) expect(check(`It is ${hedge} half of peers.`, share), `${hedge} ${share}`).toEqual([]);
    for (const share of [0.44, 0.56]) expect(check(`It is ${hedge} half of peers.`, share), `${hedge} ${share}`).toEqual(["half"]);
  });

  it.each(["nearly", "almost", "close to", "just under", "under", "less than"])("%s: up to 5 points below, never above", (hedge) => {
    for (const share of [0.45, 0.48, 0.5]) expect(check(`It is ${hedge} half of peers.`, share), `${hedge} ${share}`).toEqual([]);
    for (const share of [0.44, 0.51, 0.53]) expect(check(`It is ${hedge} half of peers.`, share), `${hedge} ${share}`).toEqual(["half"]);
  });

  it.each(["more than", "over", "just over"])("%s: up to 5 points above, never below", (hedge) => {
    for (const share of [0.5, 0.52, 0.55]) expect(check(`It is ${hedge} half of peers.`, share), `${hedge} ${share}`).toEqual([]);
    for (const share of [0.47, 0.49, 0.56]) expect(check(`It is ${hedge} half of peers.`, share), `${hedge} ${share}`).toEqual(["half"]);
  });

  it("hedges an \"x in y\" share and a fraction the same way", () => {
    expect(check("Roughly three in ten banks waive it.", 0.33)).toEqual([]);
    expect(check("Three in ten banks waive it.", 0.33)).toEqual(["Three in ten"]);
    expect(check("Nearly a third of credit unions waive it.", 0.3)).toEqual([]);
    expect(check("Nearly a third of credit unions waive it.", 0.35)).toEqual(["a third"]);
    expect(check("More than 1 in 4 peers waive it.", 0.29)).toEqual([]);
    expect(check("More than 1 in 4 peers waive it.", 0.24)).toEqual(["1 in 4"]);
  });

  it("a hedge before a dollar or percent figure does not widen it", () => {
    expect(checkNarrativeFigures("It is about twenty-eight dollars.", { peer_median: 30 }).unmatched).toEqual(["twenty-eight dollars"]);
  });
});

describe("digits with the unit in words", () => {
  it("reads \"25 dollars\", a scale word, \"per cent\" and both ends of a range", () => {
    expect(read("The fee is 25 dollars; revenue was 2.5 million dollars; fees rose 30 per cent.")).toEqual([
      ["usd", 25, "25 dollars"], ["usd", 2.5e6, "2.5 million dollars"], ["pct", 30, "30 per cent"],
    ]);
    expect(read("Fees run 25 to 30 percent higher, or 10 to 20 dollars.")).toEqual([
      ["usd", 10, "10"], ["usd", 20, "20 dollars"], ["pct", 25, "25"], ["pct", 30, "30 percent"],
    ]);
    expect(read("Revenue was 2 to 5 million dollars.")).toEqual([["usd", 2e6, "2"], ["usd", 5e6, "5 million dollars"]]);
  });

  it("uses the digit tolerance: \"12.50 dollars\" is to the cent, \"2.5 million dollars\" to the hundred thousand", () => {
    expect(extractFigures("A 12.50 dollar fee.")[0]).toMatchObject({ value: 12.5, tolerance: expect.closeTo(0.005, 6) });
    expect(checkNarrativeFigures("Revenue was 2.5 million dollars.", { revenue: 2_540_000 }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("The fee is 25 dollars.", { peer_median: 30 }).unmatched).toEqual(["25 dollars"]);
  });

  it("never reads a figure twice: \"$25 dollars\" is $25, \"30% percent\" is 30%", () => {
    expect(read("The fee is $25 dollars.")).toEqual([["usd", 25, "$25"]]);
    expect(read("Fees rose 30% percent.")).toEqual([["pct", 30, "30%"]]);
    expect(read("Fees rose 30 percent.")).toEqual([["pct", 30, "30 percent"]]);
    expect(read("The fee is $ 25 dollars.")).toEqual([["usd", 25, "$ 25"]]);
  });

  it("a year is a basis, not an amount", () => {
    expect(read("Fees are shown in 2025 dollars.")).toEqual([]);
  });
});

describe("a hold replaces exactly the characters of a figure in words", () => {
  it("holdUntracedFindingFigures swaps only the spelled span", () => {
    const text = "Half of peers charge it; the fee is twenty-five dollars, against a thirty dollar median.";
    const out = holdUntracedFindingFigures(text, null, { peer_median: 30 });
    expect(out.held).toEqual(["twenty-five dollars", "Half"]);
    expect(out.text).toBe(`${HELD_FINDING_FIGURE} of peers charge it; the fee is ${HELD_FINDING_FIGURE}, against a thirty dollar median.`);
  });

  it("replaces by position: a traced \"half\" stays when another \"half\" is held", () => {
    const text = "Roughly half of peers waive it; half of banks charge it.";
    const out = holdUntracedFindingFigures(text, null, { waive_share: 0.47 });
    expect(out.held).toEqual(["half"]);
    expect(out.text).toBe(`Roughly half of peers waive it; ${HELD_FINDING_FIGURE} of banks charge it.`);
  });

  it.each([
    ["**twenty-five** dollars is the fee.", `${HELD_FINDING_FIGURE} is the fee.`],
    ["Two **thirds** of banks charge it.", `${HELD_FINDING_FIGURE} of banks charge it.`],
    ["*Half* of peers charge it.", `*${HELD_FINDING_FIGURE}* of peers charge it.`],
    ["The fee is _thirty_ dollars.", `The fee is ${HELD_FINDING_FIGURE}.`],
    ["The fee is __thirty__ dollars, or **$30**.", `The fee is ${HELD_FINDING_FIGURE}, or **${HELD_FINDING_FIGURE}**.`],
  ])("never leaves an unpaired markdown marker: %s", (text, held) => {
    const out = holdUntracedFindingFigures(text, null, { x: 0 });
    expect(out.text).toBe(held);
    for (const mark of ["**", "__", "*", "_"]) expect(out.text.split(mark).length % 2, mark).toBe(1);
  });
});

describe("review of #975: price ratios, ranks and decimals in words", () => {
  it.each([
    "Your fee is half of what peers charge.",
    "At fifteen, it is half the fee peers charge.",
    "Your fee is about half the median of peers.",
    "The waiver covers half of the fee for members.",
    "It is a third of the fee charged by banks nearby.",
    "half the cost of their accounts",
    "Charge half of what the large banks charge.",
    "half of all overdraft fees",
    "Half of all fees are waived.",
    "Half of them charge.",
    "half of the peer median",
    "half of the banks' fees",
    "the fee is one-half of the national median",
    "one in a million accounts",
  ])("a price ratio or a non-group is not a share: %s", (text) => {
    expect(extractFigures(text)).toEqual([]);
  });

  it("a share still reads before a group with one describing word", () => {
    expect(read("Half of the local banks and a third of peer institutions charge it; one in four community banks waives it.")).toEqual([
      ["pct", 50, "Half"], ["pct", 33.33, "a third"], ["pct", 25, "one in four"],
    ]);
    expect(read("Half of the very large banks charge it.")).toEqual([]);
  });

  it.each([
    "Rank 3 in 10 among peers.",
    "It is top 10 in 50 states.",
    "Ranked 2 in 3 categories.",
    "Step 2 in 5.",
    "Day 1 in 30.",
    "Page 1 in 3 banks lists it.",
    "No. 4 in 9 banks.",
    "Nine in ten.",
    "Seven out of ten.",
    "One in five years.",
  ])("a rank, a step or a share of no group is not a share: %s", (text) => {
    expect(extractFigures(text)).toEqual([]);
  });

  it("reads a decimal in words, or nothing, never a wrong value", () => {
    expect(read("Fees rose one point five percent, then twelve point five percent.")).toEqual([
      ["pct", 1.5, "one point five percent"], ["pct", 12.5, "twelve point five percent"],
    ]);
    expect(read("Fees rose two and a half percent; the fee is two and a half dollars.")).toEqual([
      ["usd", 2.5, "two and a half dollars"], ["pct", 2.5, "two and a half percent"],
    ]);
    // A decimal with a scale word is read whole, to its last stated place, and its tail is never read alone.
    expect(read("Revenue was one point five million dollars.")).toEqual([["usd", 1.5e6, "one point five million dollars"]]);
    expect(extractFigures("Revenue was one point five million dollars.")[0].tolerance).toBeCloseTo(50_000, 3);
    expect(checkNarrativeFigures("Fees rose twelve point five percent.", { change_pct: 12.5 }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Fees rose twelve point five percent.", { change_pct: 5 }).unmatched).toEqual(["twelve point five percent"]);
  });

  it("a hyphenated range keeps its first end", () => {
    expect(read("A ten-to-fifteen dollar fee, or ten-to-fifteen dollars.")).toEqual([
      ["usd", 10, "ten"], ["usd", 15, "fifteen dollar"], ["usd", 10, "ten"], ["usd", 15, "fifteen dollars"],
    ]);
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

describe("a decimal said aloud with digits in it is one figure (#975)", () => {
  it.each([
    ["The median is 1 point 5 percent.", "pct", 1.5, "1 point 5 percent"],
    ["The median is 2 point 25 percent.", "pct", 2.25, "2 point 25 percent"],
    ["The median is 1 point 5%.", "pct", 1.5, "1 point 5%"],
    ["The median is 1 point 5 %.", "pct", 1.5, "1 point 5 %"],
    ["The median is one point 5 percent.", "pct", 1.5, "one point 5 percent"],
    ["The median is 1 point five percent.", "pct", 1.5, "1 point five percent"],
    ["The median is 1 and a half percent.", "pct", 1.5, "1 and a half percent"],
    ["The median is 1.5 percent.", "pct", 1.5, "1.5 percent"],
    ["The fee is 35 dollars and 50 cents.", "usd", 35.5, "35 dollars and 50 cents"],
    ["The fee is thirty-five dollars and fifty cents.", "usd", 35.5, "thirty-five dollars and fifty cents"],
    ["The fee is one dollar and five cents.", "usd", 1.05, "one dollar and five cents"],
    ["The fee is 2 and a half dollars.", "usd", 2.5, "2 and a half dollars"],
    ["Fee income was $1 point 5 million.", "usd", 1.5e6, "$1 point 5 million"],
    ["Fee income was 1 point 5 million dollars.", "usd", 1.5e6, "1 point 5 million dollars"],
  ])("%s", (text, kind, value, raw) => {
    expect(read(text)).toEqual([[kind, value, raw]]);
  });

  it("is traced at the precision it states: 1.5% passes against 1.5, not against 5", () => {
    expect(checkNarrativeFigures("Northfield Savings charges 1 point 5 percent.", { foreign_txn_pct: 1.5 }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Northfield Savings charges 1 point 5%.", { foreign_txn_pct: 1.5 }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Northfield Savings charges 1 point 5 percent.", { foreign_txn_pct: 5 }).unmatched).toEqual(["1 point 5 percent"]);
    expect(checkNarrativeFigures("Northfield Savings charges 2 point 25 percent.", { foreign_txn_pct: 2.2 }).unmatched).toEqual(["2 point 25 percent"]);
    expect(checkNarrativeFigures("The fee is 35 dollars and 50 cents.", { peer_median: 35.5 }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("The fee is 35 dollars and 99 cents.", { peer_median: 35 }).unmatched).toEqual(["35 dollars and 99 cents"]);
    expect(checkNarrativeFigures("Fee income was $1 point 5 million.", { fee_income: 1_520_000 }).unmatched).toEqual([]);
  });

  it("a range of decimals said aloud keeps both ends whole", () => {
    expect(read("Fees run from 1 point 5 to 2 point 5 percent, or 1 point 5 to 2 point 5%.")).toEqual([
      ["pct", 1.5, "1 point 5"], ["pct", 2.5, "2 point 5 percent"], ["pct", 1.5, "1 point 5"], ["pct", 2.5, "2 point 5%"],
    ]);
  });

  it("points that are not a decimal stay as they were", () => {
    expect(read("It rose 1 point to 5 percent.")).toEqual([["pct", 5, "5 percent"]]);
    expect(read("It fell 2 points, 5 percent of banks.")).toEqual([["pct", 5, "5 percent"]]);
    expect(read("The fee is 35 dollars and 150 cents.")).toEqual([["usd", 35, "35 dollars"]]);
    expect(read("Revenue was 2 million dollars and 50 cents.")).toEqual([["usd", 2e6, "2 million dollars"]]);
  });

  it("a hold replaces the whole phrase, markdown and all", () => {
    const out = holdUntracedFindingFigures("Northfield Savings charges 1 point 5%; Lakeview Credit Union charges 1 point 5 percent.", null, { x: 0 });
    expect(out.held).toEqual(["1 point 5%", "1 point 5 percent"]);
    expect(out.text).toBe(`Northfield Savings charges ${HELD_FINDING_FIGURE}; Lakeview Credit Union charges ${HELD_FINDING_FIGURE}.`);
    for (const [text, held] of [
      ["It is **1 point 5** percent.", `It is ${HELD_FINDING_FIGURE}.`],
      ["It is 1 point **5%**.", `It is ${HELD_FINDING_FIGURE}.`],
    ]) {
      const marked = holdUntracedFindingFigures(text, null, { x: 0 });
      expect(marked.text, text).toBe(held);
      for (const mark of ["**", "__", "*", "_"]) expect(marked.text.split(mark).length % 2, mark).toBe(1);
    }
  });

  it("the gate passes a correct 1 point 5 percent and holds a wrong one", () => {
    const gate = (text: string, pct: number) => gateAnswer({ surface: "simulate", text, evidence: { kind: "data", data: { foreign_txn_pct: pct } },
      identity: { researchInstitutionId: null, accountInstitutionId: null } });
    expect(gate("Northfield Savings charges 1 point 5 percent on foreign transactions.", 1.5).status).toBe("validated");
    expect(gate("Northfield Savings charges 1 point 5% on foreign transactions.", 1.5).status).toBe("validated");
    expect(gate("Northfield Savings charges 1 point 5 percent on foreign transactions.", 3).status).toBe("held");
  });
});
