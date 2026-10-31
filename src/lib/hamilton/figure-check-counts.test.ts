/**
 * Counts in an answer (#975): "42 banks", "12 of your peers", "3 competitors", "1,204
 * institutions" are traced, and an invented one is recorded as `untraced_count`: never held, never
 * cut, never replaced in a report, until its shadow rate is measured. An untraced "$25" still
 * holds exactly as before. Years, ranks, dates, ids, citations and ranges stay unread.
 */
import { describe, expect, it } from "vitest";
import { checkAnswerEvidence } from "./answer-gate";
import { enforceStreamedDecision, enforcedOutcome } from "./output-gate-enforce";
import { gateShadowRecord, tallyGateShadow } from "./output-gate-shadow";
import { countEvidence, extractCountFigures } from "./count-figures";
import { checkNarrativeFigures, extractFigures, untracedFigures } from "./figure-check";
import { gateAnswer } from "./output-gate";
import { HELD_FINDING_FIGURE, holdUntracedFindingFigures } from "./report-finding-claims";

const PROFILE = { institution_name: "First Example Bank", overdraft_fee: 35, peer_count: 8, institution_count: 1204 };
const read = (text: string) => extractCountFigures(text).map((f) => [f.raw, f.value]);
/** Every untraced figure, dollars and percentages first, then counts. */
const untraced = (text: string, data: unknown, options?: Parameters<typeof checkNarrativeFigures>[2]) => {
  const result = checkNarrativeFigures(text, data, options);
  return [...result.unmatched, ...(result.untracedCounts ?? [])];
};

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
    "Between 10—15 banks and 10–15 peers charge it.",
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
  it("went unread before this change and is recorded now: invented counts beside a traced fee", () => {
    const text = "First Example Bank charges $35. 42 banks in your market charge less, and 12 of your peers waive it; 1,204 institutions report the fee.";
    // `checked` and `unmatched` read dollars and percentages only, exactly as before counts were traced.
    expect(checkNarrativeFigures(text, PROFILE)).toEqual({ checked: 1, unmatched: [], untracedCounts: ["42 banks", "12 of your peers"] });
    expect(checkNarrativeFigures("First Example Bank charges $35 across 1,204 institutions.", PROFILE)).toEqual({ checked: 1, unmatched: [] });
  });

  it("traces a count to a count field, never to a fee of the same amount", () => {
    expect(untraced("The index covers 1,204 institutions; 8 peers are in the set.", PROFILE)).toEqual([]);
    expect(untraced("35 banks charge it.", PROFILE)).toEqual(["35 banks"]);
    expect(untraced("35 banks charge it.", { median_amount: 35, overdraft_pct: 35 })).toEqual(["35 banks"]);
  });

  it("traces to the length of an array a tool returned, and to a count of some of its rows", () => {
    const competitors = [
      { institution_name: "Second Example Bank", overdraft_fee: 30 },
      { institution_name: "Third Example Credit Union", overdraft_fee: 36 },
      { institution_name: "Fourth Example Bank", overdraft_fee: 38 },
    ];
    const data = { competitors };
    expect(untraced("Its 3 local competitors charge $30 to $38.", data)).toEqual([]);
    // Two of the three rows charge $36 or more: a count of rows the answer filtered.
    expect(untraced("2 competitors charge $36 or more.", data)).toEqual([]);
    expect(untraced("5 competitors charge $36 or more.", data)).toEqual(["5 competitors"]);
    // Rows of institutions are not rows of branches or complaints.
    expect(untraced("They have 2 branches and 3 complaints.", data)).toEqual(["2 branches"]);
  });

  it("does not read a fee category's bank_count rows as rows of banks", () => {
    const index = { categories: [{ fee_category: "overdraft", median_amount: 35, bank_count: 800 }, { fee_category: "nsf", median_amount: 32, bank_count: 750 }] };
    expect(untraced("800 banks report an overdraft fee.", index)).toEqual([]);
    expect(untraced("40 banks report it.", index)).toEqual(["40 banks"]);
  });

  it("traces a sum or difference of two counts", () => {
    const data = { bank_count: 12, cu_count: 8 };
    expect(untraced("20 institutions report it, 4 more banks than credit unions.", data)).toEqual([]);
    expect(untraced("21 institutions report it.", data)).toEqual(["21 institutions"]);
  });

  it("traces a count the reader's own question states", () => {
    expect(untraced("Of your 15 peers, the median is $35.", PROFILE, { question: "How do I compare to my 15 peers?" })).toEqual([]);
    expect(untraced("Of your 15 peers, the median is $35.", PROFILE)).toEqual(["15 peers"]);
  });

  it("reads a hedge as a floor, a ceiling, or one unit either way", () => {
    expect(untraced("About 1,200 institutions report it.", PROFILE)).toEqual([]);
    expect(untraced("More than 1,200 institutions report it.", PROFILE)).toEqual([]);
    expect(untraced("Fewer than 1,100 institutions report it.", PROFILE)).toEqual(["1,100 institutions"]);
    expect(untraced("1,200 institutions report it.", PROFILE)).toEqual(["1,200 institutions"]);
    // A floor holds for any count at or above it, however far.
    expect(untraced("More than 1,000 institutions publish an overdraft fee.", { institution_count: 3912 })).toEqual([]);
    expect(untraced("At least 40 banks publish it.", { bank_count: 41 })).toEqual([]);
    expect(untraced("At least 40 banks publish it.", { bank_count: 39 })).toEqual(["40 banks"]);
    // A ceiling holds only below it, within two units of its last place.
    expect(untraced("Fewer than 1,000 banks publish it.", { bank_count: 3912 })).toEqual(["1,000 banks"]);
    expect(untraced("Fewer than 1,000 banks publish it.", { bank_count: 950 })).toEqual([]);
    expect(untraced("Under 1,100 banks publish it.", { bank_count: 8 })).toEqual(["1,100 banks"]);
  });

  it("never reads a rule's threshold as a count of the evidence", () => {
    const three = { competitors: [
      { institution_name: "Second Example Bank", overdraft_fee: 30 },
      { institution_name: "Third Example Credit Union", overdraft_fee: 36 },
      { institution_name: "Fourth Example Bank", overdraft_fee: 38 },
    ] };
    expect(untraced("A local median needs at least five competitors stating the fee; your market has 3.", three)).toEqual([]);
    expect(untraced("A peer median needs at least 5 local competitors, or 10 peers for any other group.", {})).toEqual([]);
    expect(untraced("A median requires 10 peers or more.", {})).toEqual([]);
    // The thin-peer repair line asks for the peers by name: a count of them still traces to their rows.
    expect(untraced("Its 3 local competitors are too few for a median: they charge $30, $36 and $38.", three)).toEqual([]);
    expect(untraced("Its 4 local competitors are too few for a median.", three)).toEqual(["4 local competitors"]);
  });

  it("backs a count with a search tool's total beside its rows, and reads its { id, name } rows as institutions", () => {
    // The shape of the research searchInstitutions tool.
    const search = { total: 412, page: 1, page_size: 25, data: [
      { id: 101, name: "First Example Credit Union", state: "TX", charter_type: "credit_union", fee_count: 12 },
      { id: 102, name: "Second Example Credit Union", state: "TX", charter_type: "credit_union", fee_count: 9 },
    ] };
    expect(untraced("Texas has 412 credit unions with fee data.", search)).toEqual([]);
    expect(untraced("2 credit unions in the list publish it.", search)).toEqual([]);
    expect(untraced("Texas has 25 credit unions with fee data.", search)).toEqual(["25 credit unions"]);
    // A total under a dollar field, with its own unit, is money.
    expect(untraced("500 banks report it.", { service_charges: { total: 500, unit: "thousands_dollars" } })).toEqual(["500 banks"]);
  });

  it("traces a count a tool's own text states", () => {
    const data = { beige_book: "Contacts at 12 banks reported softer demand. A survey of 300 community banks found the same." };
    expect(untraced("Contacts at 12 banks reported softer demand, as did 300 community banks.", data)).toEqual([]);
    expect(untraced("Contacts at 14 banks reported softer demand.", data)).toEqual(["14 banks"]);
  });

  it("does not sum or subtract counts from different records", () => {
    const index = { categories: [
      { fee_category: "overdraft", institution_count: 800, bank_count: 500, cu_count: 300 },
      { fee_category: "nsf", institution_count: 700, bank_count: 450, cu_count: 250 },
    ] };
    // 500 - 300 in one record.
    expect(untraced("200 more banks than credit unions, 200 banks in all.", index)).toEqual([]);
    // 800 - 700 and 800 + 450 cross records.
    expect(untraced("100 banks dropped it.", index)).toEqual(["100 banks"]);
    expect(untraced("1,250 banks charge it.", index)).toEqual(["1,250 banks"]);
    // With 300 count numbers in one search result, cross-record pairing let nearly any count through.
    const many = { categories: Array.from({ length: 300 }, (_, i) => ({ fee_category: `example_${i}`, institution_count: 3 * i + 1 })) };
    expect(untraced("437 banks charge it.", many)).toEqual(["437 banks"]);
  });

  it("never reads a fee price as a count", () => {
    const data = {
      your_fees: { overdraft: 35 },
      competitors: [{ institution_name: "Second Example Bank", fees: { nsf: 30 }, counted_as: { institution_id: 7, charters: 2 } }],
      overdraft: 33,
    };
    expect(untraced("35 banks charge it.", data)).toEqual(["35 banks"]);
    expect(untraced("30 banks charge it.", data)).toEqual(["30 banks"]);
    expect(untraced("33 banks charge it.", data)).toEqual(["33 banks"]);
    expect(countEvidence(data).exact.has(2)).toBe(false);
  });

  it("reads a count inside markdown emphasis and returns its original characters", () => {
    expect(untraced("**42** banks charge less.", PROFILE)).toEqual(["**42** banks"]);
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

describe("counts from the research tools' own shapes (second review)", () => {
  it("counts with_* fields from the state and district statistics", () => {
    const stats = { with_fees: 412, institution_count: 612, bank_count: 380, cu_count: 232, total_fees: 9120, fee_categories: 48 };
    expect(untraced("In Texas, 412 institutions publish at least one fee, out of 612 active institutions.", stats)).toEqual([]);
  });

  it("reads ranked institution rows by charter, and counts each charter's rows", () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => ({ institution: `Example Bank ${i + 1}`, state: "TX", charter_type: "bank", asset_tier: "community", matching_fees: 9 - i, total_fees: 30, pct: 0.3 })),
      ...Array.from({ length: 3 }, (_, i) => ({ institution: `Example Credit Union ${i + 1}`, state: "TX", charter_type: "credit_union", asset_tier: "community", matching_fees: 3, total_fees: 25, pct: 0.12 })),
    ];
    const ranked = { metric: "above_p75", rows };
    expect(untraced("Seven banks and three credit unions make the list.", ranked)).toEqual([]);
    expect(untraced("Three credit unions appear among the 10 institutions with the most fees above the 75th percentile.", ranked)).toEqual([]);
    expect(untraced("Five credit unions make the list.", ranked)).toEqual(["Five credit unions"]);
    // Rows that do not name a charter never hold a count of banks or credit unions within them.
    const unnamed = { competitors: rows.map(({ charter_type: _c, ...row }) => ({ ...row, institution_name: row.institution })) };
    expect(untraced("Five credit unions make the list.", unnamed)).toEqual([]);
  });

  it("checks a count beside \"must\", which is not a rule about a statistic", () => {
    expect(untraced("More than 9,000 banks must disclose overdraft fees under Regulation DD.", { bank_count: 4236 })).toEqual(["9,000 banks"]);
    expect(untraced("More than 9,000 banks must disclose overdraft fees under Regulation DD.", { bank_count: 9100 })).toEqual([]);
  });

  it("never reads an exhibit's display position or order as a count", () => {
    const memo = { storyline: { exhibits: [{ number: 3, position: 4, index: 5, order: 6, rank: 7, title: "Example exhibit" }] } };
    for (const n of [3, 4, 5, 6, 7]) expect(countEvidence(memo).exact.has(n)).toBe(false);
  });

  it("carries a hedge along a list of counts", () => {
    const data = { peer_count: 214, bank_count: 148, cu_count: 61 };
    expect(untraced("Over 200 peers report it; about 150 banks and 60 credit unions.", data)).toEqual([]);
    expect(read("About 150 banks, 60 credit unions and 9 thrifts.").length).toBe(3);
    expect(extractCountFigures("About 150 banks, 60 credit unions and 9 thrifts.").every((f) => f.hedge === "about")).toBe(true);
  });
});

describe("an untraced count is recorded, never held (rollout, #975)", () => {
  const gate = (text: string, data: unknown = PROFILE) => gateAnswer({ surface: "simulate", text, evidence: { kind: "data", data },
    identity: { researchInstitutionId: null, accountInstitutionId: null } });

  it("the shared gate passes it and records its own line", () => {
    const check = checkAnswerEvidence("First Example Bank charges $35, below 42 banks.", PROFILE);
    expect(check.passed).toBe(true);
    expect(check.problems).toEqual([]);
    expect(check.countProblems).toEqual(["These counts are not in DATA: 42 banks."]);
  });

  it("the one output gate records untraced_count, non-critical, and the status stays validated", () => {
    const verdict = gate("First Example Bank charges $35. 42 banks charge less.");
    expect(verdict.status).toBe("validated");
    expect(verdict.repairable).toBe(false);
    expect(verdict.failures).toEqual([{ code: "untraced_count", critical: false, source: "check", message: "These counts are not in DATA: 42 banks." }]);
    expect(gate("First Example Bank charges $35, and 8 peers are in its set.").failures).toEqual([]);
  });

  it("the enforced gate shows it on every surface, and the shadow record and tally count it", () => {
    const verdict = gate("First Example Bank charges $35. 42 banks charge less.");
    expect(enforcedOutcome(verdict, false)).toBe("validated");
    expect(enforceStreamedDecision(verdict, { held: false, shownText: "x" }, true)).toEqual({ held: false, shownText: "x" });
    const record = gateShadowRecord(verdict, "shown", { path: "written_streaming", mode: "analyze" });
    expect(record).toMatchObject({ unified: "validated", agrees: true, codes: ["untraced_count"], critical: [] });
    expect(tallyGateShadow([record]).untracedCounts).toBe(1);
  });

  it("an untraced dollar figure still holds, with the count recorded beside it", () => {
    const verdict = gate("First Example Bank charges $25. 42 banks charge less.");
    expect(verdict.status).toBe("held");
    expect(verdict.failures.map((f) => [f.code, f.critical])).toEqual([["untraced_figure", true], ["untraced_count", false]]);
    expect(verdict.check.problems).toEqual(["These figures are not in DATA: $25."]);
  });

  it("a ready_partial verdict on a partial surface is not held for a count beside a cut sentence", () => {
    const verdict = gate("First Example Bank charges $35. 42 banks charge less. It is cheaper than peers.");
    expect(verdict.failures.map((f) => f.code)).toEqual(["house_wording", "untraced_count"]);
    expect(verdict.status).toBe("ready_partial");
  });

  it("a report finding never replaces a count; it still holds an untraced dollar figure", () => {
    const out = holdUntracedFindingFigures("First Example Bank charges $25, more than 8 peers and 42 banks.", null, PROFILE);
    expect(out.held).toEqual(["$25"]);
    expect(out.text).toBe(`First Example Bank charges ${HELD_FINDING_FIGURE}, more than 8 peers and 42 banks.`);
  });
});
