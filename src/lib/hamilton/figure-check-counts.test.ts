/**
 * Counts in an answer (#975): "42 banks", "12 of your peers", "3 competitors", "1,204
 * institutions" are traced as figures, and an invented one holds or is cut through the same path
 * as an untraced "$25" or "30%". Years, ranks, dates, ids, citations and ranges stay unread.
 */
import { describe, expect, it } from "vitest";
import { checkAnswerEvidence } from "./answer-gate";
import { countEvidence, extractCountFigures } from "./count-figures";
import { checkNarrativeFigures, extractFigures, untracedFigures } from "./figure-check";
import { gateAnswer } from "./output-gate";
import { HELD_FINDING_FIGURE, holdUntracedFindingFigures } from "./report-finding-claims";

const PROFILE = { institution_name: "First Example Bank", overdraft_fee: 35, peer_count: 8, institution_count: 1204 };
const read = (text: string) => extractCountFigures(text).map((f) => [f.raw, f.value]);

describe("extractCountFigures", () => {
  it("reads a number before a group noun, with one describing word, and N of a group", () => {
    expect(read("42 banks charge less; 12 of your peers waive it; 3 competitors and 1,204 institutions report it.")).toEqual([
      ["42 banks", 42], ["12 of your peers", 12], ["3 competitors", 3], ["1,204 institutions", 1204],
    ]);
    expect(read("It has 14 physical branches and 17 fee complaints, against 9 local credit unions.")).toEqual([
      ["14 physical branches", 14], ["17 fee complaints", 17], ["9 local credit unions", 9],
    ]);
    expect(read("Twelve banks and a dozen credit unions report it; one bank does not.")).toEqual([
      ["Twelve banks", 12], ["a dozen credit unions", 12], ["one bank", 1],
    ]);
  });

  it.each([
    "In 2025 banks raised the fee.",
    "The top 5 banks charge more.",
    "It is the largest 10 banks by assets.",
    "As of Oct 12 banks had filed.",
    "Rank #3 bank in the state.",
    "There are 4 complaints per 100 branches.",
    "First Example Bank (cert 12345 banks list) is listed.",
    "Between 10-15 banks charge it, or 10 to 15 peers.",
    "See [source 12 banks] for the method.",
    "The `count 7 banks` field is internal.",
    "Deming's two branch records show the fee; 3 bank fees rose.",
    "1. Banks charge more.\n2. Credit unions charge less.",
    "It ranked 3rd among 4 quarters, 5 years running.",
    "Fees rose 12.5 banks-worth",
  ])("reads no count in: %s", (text) => {
    // "4 complaints" in "4 complaints per 100 branches" is a count; the 100 is a rate's denominator.
    const counts = extractCountFigures(text).map((f) => f.raw);
    expect(counts.filter((raw) => raw !== "4 complaints")).toEqual([]);
  });

  it("leaves a share to the share reader, and dollar and percent figures to theirs", () => {
    const text = "1 in 4 peers and three in ten banks waive it; $42 and 12% are figures.";
    const amounts = extractFigures(text);
    expect(amounts.map((f) => f.raw)).toEqual(["$42", "1 in 4", "three in ten", "12%"]);
    expect(untracedFigures(text, {}).filter((f) => f.kind === "count")).toEqual([]);
  });

  it("never reads a count from extractFigures, so the fee and filing readers never see one", () => {
    expect(extractFigures("42 banks charge $35.").map((f) => f.kind)).toEqual(["usd"]);
  });
});

describe("checkNarrativeFigures traces counts", () => {
  it("passed before this change and holds now: invented counts beside a traced fee", () => {
    const text = "First Example Bank charges $35. 42 banks in your market charge less, and 12 of your peers waive it; 1,204 institutions report the fee.";
    expect(checkNarrativeFigures(text, PROFILE)).toEqual({ checked: 4, unmatched: ["42 banks", "12 of your peers"] });
  });

  it("traces a count to a count field, never to a fee of the same amount", () => {
    expect(checkNarrativeFigures("The index covers 1,204 institutions; 8 peers are in the set.", PROFILE).unmatched).toEqual([]);
    expect(checkNarrativeFigures("35 banks charge it.", PROFILE).unmatched).toEqual(["35 banks"]);
    expect(checkNarrativeFigures("35 banks charge it.", { median_amount: 35, overdraft_pct: 35 }).unmatched).toEqual(["35 banks"]);
  });

  it("traces to the length of an array a tool returned, and to a count of some of its rows", () => {
    const competitors = [
      { institution_name: "Second Example Bank", overdraft_fee: 30 },
      { institution_name: "Third Example Credit Union", overdraft_fee: 36 },
      { institution_name: "Fourth Example Bank", overdraft_fee: 38 },
    ];
    const data = { competitors };
    expect(checkNarrativeFigures("Its 3 local competitors charge $30 to $38.", data).unmatched).toEqual([]);
    // Two of the three rows charge $36 or more: a count of rows the answer filtered.
    expect(checkNarrativeFigures("2 competitors charge $36 or more.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("5 competitors charge $36 or more.", data).unmatched).toEqual(["5 competitors"]);
    // Rows of institutions are not rows of branches or complaints.
    expect(checkNarrativeFigures("They have 2 branches and 3 complaints.", data).unmatched).toEqual(["2 branches"]);
  });

  it("does not read a fee category's bank_count rows as rows of banks", () => {
    const index = { categories: [{ fee_category: "overdraft", median_amount: 35, bank_count: 800 }, { fee_category: "nsf", median_amount: 32, bank_count: 750 }] };
    expect(checkNarrativeFigures("800 banks report an overdraft fee.", index).unmatched).toEqual([]);
    expect(checkNarrativeFigures("40 banks report it.", index).unmatched).toEqual(["40 banks"]);
  });

  it("traces a sum or difference of two counts", () => {
    const data = { bank_count: 12, cu_count: 8 };
    expect(checkNarrativeFigures("20 institutions report it, 4 more banks than credit unions.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("21 institutions report it.", data).unmatched).toEqual(["21 institutions"]);
  });

  it("traces a count the reader's own question states", () => {
    expect(checkNarrativeFigures("Of your 15 peers, the median is $35.", PROFILE, { question: "How do I compare to my 15 peers?" }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Of your 15 peers, the median is $35.", PROFILE).unmatched).toEqual(["15 peers"]);
  });

  it("widens a hedged count by one unit of its last place, in its own direction", () => {
    expect(checkNarrativeFigures("About 1,200 institutions report it.", PROFILE).unmatched).toEqual([]);
    expect(checkNarrativeFigures("More than 1,200 institutions report it.", PROFILE).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Fewer than 1,100 institutions report it.", PROFILE).unmatched).toEqual(["1,100 institutions"]);
    expect(checkNarrativeFigures("1,200 institutions report it.", PROFILE).unmatched).toEqual(["1,200 institutions"]);
  });

  it("reads a count inside markdown emphasis and returns its original characters", () => {
    expect(checkNarrativeFigures("**42** banks charge less.", PROFILE).unmatched).toEqual(["**42** banks"]);
  });

  it("collects counts from count units, metrics, arrays and nested JSON text", () => {
    const evidence = countEvidence({
      facts: [{ metric: "branch_count", value: 14 }, { unit: "count", value: 6 }, { value: 99, unit: "USD" }],
      tool: JSON.stringify({ total_complaints: 17 }),
      ids: { institution_id: 4321, year: 2025, cert: 98765 },
    });
    expect([14, 6, 17, 3].every((n) => evidence.exact.has(n))).toBe(true);
    expect([99, 4321, 2025, 98765].some((n) => evidence.exact.has(n))).toBe(false);
  });
});

describe("an untraced count holds or is cut by the figure path", () => {
  it("the shared gate names it as an untraced figure", () => {
    const check = checkAnswerEvidence("First Example Bank charges $35, below 42 banks.", PROFILE);
    expect(check.passed).toBe(false);
    expect(check.problems).toEqual(["These figures are not in DATA: 42 banks."]);
  });

  it("the one output gate holds it as untraced_figure, and validates a traced count", () => {
    const gate = (text: string) => gateAnswer({ surface: "simulate", text, evidence: { kind: "data", data: PROFILE },
      identity: { researchInstitutionId: null, accountInstitutionId: null } });
    const held = gate("First Example Bank charges $35. 42 banks charge less.");
    expect(held.status).toBe("held");
    expect(held.failures.map((f) => [f.code, f.critical])).toEqual([["untraced_figure", true]]);
    expect(gate("First Example Bank charges $35, and 8 peers are in its set.").status).toBe("validated");
  });

  it("a report finding holds just the count, where it stands", () => {
    const out = holdUntracedFindingFigures("First Example Bank charges $35, more than 8 peers and 42 banks.", null, PROFILE);
    expect(out.held).toEqual(["42 banks"]);
    expect(out.text).toBe(`First Example Bank charges $35, more than 8 peers and ${HELD_FINDING_FIGURE}.`);
  });
});
