import { describe, expect, it } from "vitest";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { COVERAGE_HEADLINE_FEES, coverageWords, readCoverage, type InstitutionCoverage } from "./coverage-line";

/** Synthetic institution; no claim about a real one. */
const base: InstitutionCoverage = {
  institutionId: 9701940,
  institutionName: "Harbor Ridge Test Bank",
  readAt: "2026-10-27T15:00:00Z",
  fees: 41,
  categories: COVERAGE_HEADLINE_FEES.filter((k) => !["cashiers_check", "paper_statement", "minimum_balance"].includes(k)).concat(["coin_counting"]),
  documents: [{ id: 5001, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true }],
  lastVerifiedAt: "2026-10-24T01:20:46Z",
  peer: { label: "Texas banks with $1B to $10B in assets", institutions: 38 },
};

const AGENT_NAMES = /\b(Atlas|Magellan|Rosetta|Knox|Darwin|Hoovie|Deming)\b|Hamilton Pro/;

describe("coverageWords (#1891, V5 §4A)", () => {
  it("measures against the same 15 headline fee types the report rule uses", () => {
    expect([...COVERAGE_HEADLINE_FEES].sort()).toEqual([...HEADLINE_FEE_KEYS].sort());
  });

  it("says fees on file, schedule date, last verified, peer set and size, and what is missing", () => {
    const words = coverageWords(base);
    expect(words.sentences[0]).toBe("41 published fees on file across 13 fee types, read from its fee schedule dated Aug 1, 2026.");
    expect(words.sentences[1]).toBe("Last verified against its schedule on Oct 24, 2026.");
    expect(words.sentences[2]).toBe("Peer set: Texas banks with $1B to $10B in assets, 38 institutions with published fees on file.");
    expect(words.sentences[3]).toMatch(/^3 of the 15 headline fee types have no published fee on file: .+, .+ and .+\.$/);
    expect(words.source).toBe("Bank Fee Index live published fees and the fee schedules behind them, as of Oct 27, 2026.");
  });

  it("never uses an em dash or a pipeline agent's name", () => {
    const text = [...coverageWords(base).sentences, coverageWords(base).source].join(" ");
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(AGENT_NAMES);
  });

  it("says all headline fee types are on file when none is missing", () => {
    const words = coverageWords({ ...base, categories: [...COVERAGE_HEADLINE_FEES] });
    expect(words.sentences.at(-1)).toBe("All 15 headline fee types are on file.");
  });

  it("gives a date range for several dated documents, and counts the undated ones", () => {
    const ranged = coverageWords({ ...base, documents: [
      { id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
      { id: 2, statedDate: "2024-03-01", statedBasis: "printed_date", statedRead: true },
    ] });
    expect(ranged.sentences[0]).toContain("read from 2 schedule documents dated Mar 1, 2024 to Aug 1, 2026");
    const same = coverageWords({ ...base, documents: [
      { id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
      { id: 2, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
    ] });
    expect(same.sentences[0]).toContain("read from 2 schedule documents, each dated Aug 1, 2026");
    const partial = coverageWords({ ...base, documents: [
      { id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
      { id: 2, statedDate: null, statedBasis: "none", statedRead: true },
    ] });
    expect(partial.sentences[0]).toContain("read from 2 schedule documents; the newest stated date is Aug 1, 2026, and 1 document states no date.");
  });

  it("a single schedule: dated, states no date at the current reading, or not read yet", () => {
    expect(coverageWords({ ...base, documents: [{ id: 1, statedDate: null, statedBasis: "none", statedRead: true }] }).sentences[0])
      .toBe("41 published fees on file across 13 fee types, read from its fee schedule, which states no date.");
    expect(coverageWords({ ...base, documents: [{ id: 1, statedDate: null, statedBasis: null, statedRead: false }] }).sentences[0])
      .toBe("41 published fees on file across 13 fee types, read from its fee schedule, whose date has not been read yet.");
    expect(coverageWords({ ...base, lastVerifiedAt: null }).sentences[1]).toBe("No verification date is recorded for these fees.");
  });

  it("a year from the web address is never the schedule's date and stays out of the range", () => {
    expect(coverageWords({ ...base, documents: [{ id: 1, statedDate: "2026-01-01", statedBasis: "url_year", statedRead: true }] }).sentences[0])
      .toContain("read from its fee schedule, which states no date (its web address names 2026).");
    const mixed = coverageWords({ ...base, documents: [
      { id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
      { id: 2, statedDate: "2021-01-01", statedBasis: "url_year", statedRead: true },
    ] }).sentences[0];
    expect(mixed).toContain("read from 2 schedule documents; the newest stated date is Aug 1, 2026, and 1 document states no date.");
    expect(mixed).not.toContain("2021");
    const twoDated = coverageWords({ ...base, documents: [
      { id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
      { id: 2, statedDate: "2025-03-01", statedBasis: "printed_date", statedRead: true },
      { id: 3, statedDate: "2019-01-01", statedBasis: "url_year", statedRead: true },
    ] }).sentences[0];
    expect(twoDated).toContain("the newest stated date is Aug 1, 2026");
    expect(twoDated).not.toContain("2019");
  });

  it("several documents never claim none states a date while any is unread", () => {
    expect(coverageWords({ ...base, documents: [{ id: 1, statedDate: null, statedBasis: "none", statedRead: true }, { id: 2, statedDate: "2024-01-01", statedBasis: "url_year", statedRead: true }] }).sentences[0])
      .toContain("read from 2 schedule documents, none of which states a date.");
    const oneUnread = coverageWords({ ...base, documents: [{ id: 1, statedDate: null, statedBasis: "none", statedRead: true }, { id: 2, statedDate: null, statedBasis: null, statedRead: false }] }).sentences[0];
    expect(oneUnread).not.toContain("none of which");
    expect(oneUnread).toContain("read from 2 schedule documents; 1 document states no date and 1 document has not had its date read yet.");
    expect(coverageWords({ ...base, documents: [{ id: 1, statedDate: null, statedBasis: null, statedRead: false }, { id: 2, statedDate: null, statedBasis: null, statedRead: false }] }).sentences[0])
      .toContain("read from 2 schedule documents whose dates have not been read yet.");
    expect(coverageWords({ ...base, documents: [
      { id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
      { id: 2, statedDate: null, statedBasis: null, statedRead: false },
      { id: 3, statedDate: null, statedBasis: null, statedRead: false },
    ] }).sentences[0]).toContain("the newest stated date is Aug 1, 2026, and 2 documents have not had their dates read yet.");
  });

  it("names a single missing fee type in the singular", () => {
    const words = coverageWords({ ...base, categories: COVERAGE_HEADLINE_FEES.filter((k) => k !== "cashiers_check") });
    expect(words.sentences.at(-1)).toMatch(/^1 of the 15 headline fee types has no published fee on file: [^,]+\.$/);
  });

  it("gives only the peer set's size where the page already names it", () => {
    expect(coverageWords(base, { peerLabelShown: true }).sentences[2]).toBe("The peer baseline has 38 institutions with published fees on file.");
    expect(coverageWords({ ...base, peer: null }).sentences.some((s) => s.includes("Peer"))).toBe(false);
  });

  it("names up to five missing fee types and counts the rest", () => {
    const words = coverageWords({ ...base, categories: ["overdraft"] });
    expect(words.sentences.at(-1)).toMatch(/^14 of the 15 headline fee types have no published fee on file: [^,]+, [^,]+, [^,]+, [^,]+ and 10 others\.$/);
  });

  it("with no fee on file, says so and claims nothing missing or verified", () => {
    const words = coverageWords({ ...base, fees: 0, categories: [], documents: [], lastVerifiedAt: null, peer: null });
    expect(words.sentences).toEqual(["No published fee for Harbor Ridge Test Bank is on file yet."]);
  });
});

describe("readCoverage", () => {
  it("reads a saved record back and refuses anything else", () => {
    expect(readCoverage(JSON.parse(JSON.stringify(base)))).toEqual(base);
    expect(readCoverage(null)).toBeNull();
    expect(readCoverage({ institutionId: "9" })).toBeNull();
    expect(readCoverage({ ...base, peer: { label: 3 } })).toEqual({ ...base, peer: null });
  });

  it("a saved document with no read flag counts as read only when it carries a date", () => {
    const saved = { ...base, documents: [{ id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement" }, { id: 2, statedDate: null, statedBasis: "none" }] };
    expect(readCoverage(saved)?.documents).toEqual([
      { id: 1, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true },
      { id: 2, statedDate: null, statedBasis: null, statedRead: false },
    ]);
  });
});
