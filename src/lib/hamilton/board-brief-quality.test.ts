/**
 * Gate G9 (Oct 30): a board brief built from a real saved storyline answer with a written memo
 * printed no answer on page 1, labelled call report and fee figures it could trace as untied,
 * stacked limits that contradicted each other, explained a verdict its table never showed, and left
 * out every exhibit the answer carried. Invented fixture data only (overdraftResearch); no live data.
 */
import { describe, expect, it } from "vitest";
import { boardBriefFromAnalysis, readerLimitation } from "./board-brief";
import { COMPETITOR_FEE_SOURCE, storyExhibitTable } from "./brief-exhibits";
import { PEER_LIST_MISSING } from "./peer-list-words";
import type { StoryExhibit } from "./workspace/storyline-types";
import { withMemo } from "./workspace/analysis-record";
import { CLAIM_BINDING_LIMITATION, OWN_AGGREGATE_LIMITATION, STORED_SNAPSHOT_LIMITATION, type HamiltonEvidenceFact } from "./evidence-contract";
import { READING_ONLY_LEAD } from "./written-answer-binding";
import { INTERPRETATION_LIMITATION } from "./narrative-bound";
import { COMMENTARY_LIMIT, COMMENTARY_NOTE } from "./storyline-trace";
import { BOARD, MARKET, SUMMARY, memoAnswer, saved, storyline } from "./board-brief-quality.fixture";

const edits = { title: "", teamNote: "", includeEvidence: true };

describe("board brief from a storyline answer with a memo (gate G9)", () => {
  it("leads page 1 with the answer's governing thought, not the reading-only warning (problem 1)", () => {
    const report = boardBriefFromAnalysis(memoAnswer(), "saved", edits);
    expect(report.answer?.headline).toBe(storyline.governingThought);
    expect(report.answer?.headline).not.toBe(READING_ONLY_LEAD);
    expect(report.executiveSummary).toEqual([storyline.governingThought]);
    expect(JSON.stringify(report)).not.toContain(READING_ONLY_LEAD);
  });

  it("keeps a memo's supported summary as the brief's opening paragraph", () => {
    const answer = memoAnswer();
    const supported = "Your fee sits above the peer median.";
    const memo = { ...answer.memo!, summary: supported, narrativeBinding: { ...answer.memo!.narrativeBinding!, supported: [{ text: supported, factIds: [] }], interpretation: [...BOARD, ...MARKET] } };
    const report = boardBriefFromAnalysis(withMemo(saved, memo), "saved", edits);
    expect(report.answer?.headline).toBe(storyline.governingThought);
    expect(report.strategicRationale.startsWith(supported)).toBe(true);
  });

  it("keeps the headline of an answer without a storyline as before", () => {
    const report = boardBriefFromAnalysis({ ...saved, storyline: undefined }, "saved", edits);
    expect(report.answer?.headline).toBe(saved.hamiltonView);
  });
});

describe("records table footnote (gate G9 problem 4)", () => {
  const records = (analysis: ReturnType<typeof memoAnswer>) =>
    boardBriefFromAnalysis(analysis, "saved", edits).exhibits?.find((e) => e.id === "evidence_records");

  it("explains only the verdicts its rows show", () => {
    const answer = memoAnswer();
    // As in the saved answer: the one record has no frequency, so its row reads incomplete.
    answer.factEvidence = { ...answer.factEvidence!, facts: answer.factEvidence!.facts.map((f) => ({ ...f, frequency: null })), derivations: [] };
    const table = records(answer)!;
    expect(table.rows.map((r) => r[3]).every((check) => check.startsWith("Incomplete record"))).toBe(true);
    expect(table.note).not.toContain("Matches the stored source");
    expect(table.note).toContain("not re-check");
  });

  it("explains \"Matches the stored source\" when a row reads it", () => {
    const answer = memoAnswer();
    const complete: HamiltonEvidenceFact = {
      id: "fee:published:501", kind: "observed", value: 32, unit: "usd", currency: "USD", frequency: "per item", conditions: null, status: "published",
      scope: { institutionId: 2, feeCategory: "overdraft", product: "Fixture checking", reportingDate: null, effectiveDate: null, accountApplicability: "consumer" },
      source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: 501, sourceDocumentIds: [1501], urls: ["https://fixture.invalid/2"], asOf: "2026-09-12", documentContentHash: "abcdef1234567890", verificationEventId: null },
    };
    answer.factEvidence = { ...answer.factEvidence!, facts: [complete], derivations: [] };
    const table = records(answer)!;
    expect(table.rows.some((r) => r[3] === "Matches the stored source")).toBe(true);
    expect(table.note).toContain("\"Matches the stored source\" means");
  });
});

describe("the answer's exhibits (gate G9 problem 5)", () => {
  it("prints every storyline exhibit as a table, in reading order, before the evidence tables", () => {
    const report = boardBriefFromAnalysis(memoAnswer(), "saved", edits);
    const tables = report.exhibits!.filter((e) => e.id === "answer_exhibit");
    expect(tables.map((t) => t.title)).toEqual(storyline.exhibits.map((e) => e.actionTitle));
    expect(report.exhibits!.findIndex((e) => e.id !== "answer_exhibit")).toBe(tables.length);
    for (const t of tables) {
      expect(t.rows.length).toBeGreaterThan(0);
      for (const row of t.rows) expect(row).toHaveLength(t.columns.length);
      expect(t.subtitle).toContain("Source: ");
    }
    // The position exhibit carries the bank, the peer median and middle half, as saved.
    const position = tables[0];
    const own = storyline.exhibits[0].exhibit.kind === "fee_position" ? storyline.exhibits[0].exhibit.ownLabel : "";
    expect(position.rows).toEqual(expect.arrayContaining([[own, "$32", "1"], ["Peer median", "$29.50", "16"], ["Peers' middle half", "$25.75 to $32", "16"]]));
  });

  it("does not repeat an exhibit's title as a paragraph", () => {
    const report = boardBriefFromAnalysis(memoAnswer(), "saved", edits);
    for (const e of storyline.exhibits) expect(report.strategicRationale).not.toContain(e.actionTitle);
  });

  it("keeps the answer's exhibits when the evidence tables are left out", () => {
    const report = boardBriefFromAnalysis(memoAnswer(), "saved", { ...edits, includeEvidence: false });
    expect(report.exhibits!.map((e) => e.id)).toEqual(storyline.exhibits.map(() => "answer_exhibit"));
  });
});

describe("Hamilton's reading whose numbers the exhibits hold (gate G9 problem 2)", () => {
  /** A memo whose reading is exactly these sentences. */
  function readingOf(sentences: string[]) {
    const answer = memoAnswer();
    answer.memo!.narrativeBinding!.interpretation = sentences;
    answer.hamiltonView = "";
    answer.whatThisMeans = sentences.join(" ");
    return boardBriefFromAnalysis(answer, "saved", edits);
  }

  it("labels the box as commentary on the exhibits when every number in it appears there", () => {
    const report = readingOf([...SUMMARY, ...BOARD]);
    expect(report.boardBrief?.reading).toEqual([...SUMMARY, ...BOARD]);
    expect(report.boardBrief?.readingInExhibits).toBe(true);
    expect(report.recommendation).toContain(COMMENTARY_LIMIT);
    expect(report.recommendation).not.toContain(INTERPRETATION_LIMITATION);
  });

  it("keeps the whole box as untied reading when any number is not in the exhibits", () => {
    const report = boardBriefFromAnalysis(memoAnswer(), "saved", edits);
    expect(report.boardBrief?.reading).toEqual(expect.arrayContaining([...MARKET, ...BOARD]));
    expect(report.boardBrief?.readingInExhibits).toBeUndefined();
    expect(report.recommendation).toContain("not tied to a fee record");
    expect(report.recommendation).not.toContain(COMMENTARY_LIMIT);
  });

  // Review probes: each number is in the answer, but the sentence is false. None may ever carry a source line.
  // Shared with the PDF test.
  const PROBES = [
    "Your bank charges $29.50 for an overdraft.",
    "The peer median is $32.",
    "Fee income fell 4.2% to $209 thousand.",
    "16 competitors charge $32 or more.",
  ];

  it("never prints a per-sentence source, even for sentences whose numbers all appear", () => {
    const report = readingOf(PROBES);
    expect(report.boardBrief?.reading).toEqual(PROBES);
    for (const line of report.boardBrief?.reading ?? []) expect(line).not.toMatch(/source/i);
    expect(report.boardBrief).not.toHaveProperty("tracedReading");
    // The note claims only that the figures appear in the exhibits; the sentences stay Hamilton's reading.
    expect(COMMENTARY_NOTE).toContain("the sentences themselves are Hamilton's reading");
    expect(COMMENTARY_LIMIT).toMatch(/institution, fee, period or direction/);
  });
});

describe("evidence limits that agree with each other (gate G9 problem 3)", () => {
  it("never says every figure is tied to a source beside sentences whose figures are not", () => {
    const report = boardBriefFromAnalysis(memoAnswer(), "saved", edits);
    expect(report.boardBrief?.reading?.length).toBeGreaterThan(0);
    expect(report.boardBrief?.readingInExhibits).toBeUndefined();
    expect(report.recommendation).toContain("not tied to a fee record");
    expect(report.recommendation).not.toMatch(/\bEach figure (is tied|matches)\b/);
  });

  it("scopes the stored-record and own-fee limits to the saved records", () => {
    expect(readerLimitation(STORED_SNAPSHOT_LIMITATION)).toMatch(/^Each saved record\b/);
    expect(readerLimitation(STORED_SNAPSHOT_LIMITATION)).toContain("not re-checked against the bank's current live schedule");
    expect(readerLimitation(CLAIM_BINDING_LIMITATION)).toMatch(/^Each saved record\b/);
    expect(readerLimitation(CLAIM_BINDING_LIMITATION)).toContain("not checked one by one");
    // The stored limit names incomplete or untraceable rows too, not only rows that differ.
    expect(readerLimitation(OWN_AGGREGATE_LIMITATION)).toMatch(/incomplete/);
  });
});

describe("exhibit tables name each figure's own source (gate G9 review)", () => {
  const item = (exhibit: unknown, actionTitle = "Point") => ({ id: "x", actionTitle, exhibit }) as unknown as StoryExhibit;

  it("gives competitor fees their fee-schedule source and labels the Summary of Deposits as the market", () => {
    const table = storyExhibitTable(item({
      kind: "competitor_range", title: "Local fees", unit: "dollars", own: 35, ownLabel: "Fixture Bank",
      items: [{ name: "Peer Bank", amount: 10, url: null, deposits: 2_000_000 }],
      sources: [{ label: "FDIC Summary of Deposits, branch deposits by county", asOf: "2026" }],
    }))!;
    expect(table.subtitle).toContain(`Source: Fees: ${COMPETITOR_FEE_SOURCE}; Market and local deposits: FDIC Summary of Deposits`);
    expect(table.subtitle).not.toMatch(/Source: FDIC Summary of Deposits/);
  });

  it("words a peer list's missing fees as the answer screen does and counts the peers not shown", () => {
    const row = (status: string, amount: number | null) => ({ institutionId: 1, institutionName: `Bank ${status}`, stateCode: "TN", totalAssets: null, amount, status, documentUrl: null, publishedAt: null });
    const table = storyExhibitTable(item({
      kind: "peer_list", title: "Peers", feeLabel: "Overdraft fee", unlisted: 3, sources: [],
      rows: [row("published", 30), row("not_counted", 25), row("not_on_schedule", null), row("no_schedule", null)],
    }))!;
    expect(table.rows.map((r) => r[1])).toEqual(["$30", PEER_LIST_MISSING.not_counted, PEER_LIST_MISSING.not_on_schedule, PEER_LIST_MISSING.no_schedule]);
    expect(table.note).toContain("3 more peers in this group are not shown.");
  });

  it("rounds a percentage trend to one decimal", () => {
    const table = storyExhibitTable(item({ kind: "trend", title: "Share", unit: "percent", sources: [], series: [{ label: "Share", points: [{ date: "2026-06-30", value: 44.23456 }] }] }))!;
    expect(table.rows[0][2]).toBe("44.2%");
  });
});
