import { describe, expect, it } from "vitest";
import { getFeeSourceCitations, getFeeSourceLocations, withFeeSourceCitations } from "./source-line-traces";
import { textSha256 } from "@/lib/source-line-trace";

/** First Example Bank's stored schedule: two PDF pages with footers, joined by a blank line. */
const TEXT = [
  "First Example Bank Schedule of Fees",
  "Overdraft Fee ........ $32.00 per item",
  "Page 1 of 2",
  "",
  "Wire Transfers",
  "Outgoing Domestic Wire ........ $25.00",
  "Page 2 of 2",
].join("\n");

type Row = Record<string, unknown>;

/**
 * A tagged-template double: the catalog read gets `catalog`, the text read gets `texts`, and the
 * `page_starts` column check answers `pageStartsReady`. Fragments (no SELECT) are noted in `fragments`.
 */
function fakeDb(catalog: Row[], texts: Row[], queries: string[] = [], pageStartsReady = false, fragments: string[] = []) {
  return ((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (!query.includes("SELECT")) {
      fragments.push(query);
      return Promise.resolve([]);
    }
    queries.push(query);
    if (query.includes("information_schema.columns")) return Promise.resolve([{ page_starts_column_ready: pageStartsReady }]);
    if (query.includes("FROM published_fee_catalog")) return Promise.resolve(catalog);
    if (query.includes("FROM agent_source_texts")) return Promise.resolve(texts);
    return Promise.resolve([]);
  }) as never;
}

const catalogRow = (id: number, extra: Row = {}): Row => ({
  id, institution_id: 7, source_document_id: 70, amount: "25.00", fee_name: "Outgoing Domestic Wire",
  extraction_note: 'excerpt="Outgoing Domestic Wire ........ $25.00"', conditions: null, trace: null, ...extra,
});
const textRow: Row = { id: 900, institution_id: 7, source_document_id: 70, normalized_text: TEXT, text_hash: textSha256(TEXT) };

describe("getFeeSourceLocations", () => {
  it("locates each live row in its document's newest stored text", async () => {
    const queries: string[] = [];
    const found = await getFeeSourceLocations([11, 11, -1], fakeDb([catalogRow(11)], [textRow], queries));
    expect(found.get(11)).toMatchObject({ miss: null, location: { page: 2, pageLine: 2, textLine: 6, textId: 900, textSha256: textSha256(TEXT) } });
    // The page_starts column check, the catalog read and the text read.
    expect(queries).toHaveLength(3);
  });

  it("names the page from the page starts Rosetta recorded, once the column exists", async () => {
    // No printed page numbers: only the recorded starts can name the page.
    const pageOne = "First Example Bank Schedule of Fees\nOverdraft Fee ........ $32.00 per item";
    const text = `${pageOne}\n\nWire Transfers\nOutgoing Domestic Wire ........ $25.00`;
    const row = { ...textRow, normalized_text: text, text_hash: textSha256(text), page_starts: [0, Array.from(pageOne).length + 2] };
    const fragments: string[] = [];
    const queries: string[] = [];
    const found = await getFeeSourceLocations([11], fakeDb([catalogRow(11)], [row], queries, true, fragments));
    expect(found.get(11)).toMatchObject({ miss: null, location: { page: 2, pageLine: 2, textLine: 5 } });
    expect(queries.find((q) => q.includes("FROM agent_source_texts"))).toContain("ast.page_starts AS page_starts");
    // No nested fragment: inside a savepoint scope a fragment ran as its own query (CI, PR #2930).
    expect(fragments).toEqual([]);
  });

  it("selects no page starts before the column exists, and names the line alone", async () => {
    const pageOne = "First Example Bank Schedule of Fees\nOverdraft Fee ........ $32.00 per item";
    const text = `${pageOne}\n\nWire Transfers\nOutgoing Domestic Wire ........ $25.00`;
    const fragments: string[] = [];
    const queries: string[] = [];
    const found = await getFeeSourceLocations([11], fakeDb([catalogRow(11)], [{ ...textRow, normalized_text: text, text_hash: textSha256(text), page_starts: null }], queries, false, fragments));
    expect(found.get(11)).toMatchObject({ miss: null, location: { page: null, textLine: 5 } });
    const textQuery = queries.find((q) => q.includes("FROM agent_source_texts")) ?? "";
    expect(textQuery).toContain("NULL::int[] AS page_starts");
    expect(textQuery).not.toContain("ast.page_starts");
    expect(fragments).toEqual([]);
  });

  it("says why a row has no location, and names none", async () => {
    const found = await getFeeSourceLocations([11, 12], fakeDb(
      [catalogRow(11, { source_document_id: 71 }), catalogRow(12, { fee_name: "Stop Payment", extraction_note: 'excerpt="Stop Payment $30.00"', amount: "30.00" })],
      [textRow],
    ));
    expect(found.get(11)).toEqual({ location: null, miss: "no_text" });
    expect(found.get(12)).toEqual({ location: null, miss: "not_found" });
  });

  it("does not read a text whose stored digest disagrees with its characters", async () => {
    const found = await getFeeSourceLocations([11], fakeDb([catalogRow(11)], [{ ...textRow, text_hash: "0".repeat(64) }]));
    expect(found.get(11)).toEqual({ location: null, miss: "no_text" });
  });

  it("checks length after choosing the newest text, so a too-long newest text names no older copy's line (review repro)", async () => {
    const queries: string[] = [];
    const found = await getFeeSourceLocations([11], fakeDb([catalogRow(11)], [{ ...textRow, normalized_text: null, text_hash: "f".repeat(64) }], queries));
    expect(found.get(11)).toEqual({ location: null, miss: "no_text" });
    const textRead = queries.find((query) => query.includes("FROM agent_source_texts"))!;
    expect(textRead.indexOf("DISTINCT ON")).toBeGreaterThan(-1);
    // Length is measured in the outer query, on the newest text only, never in the WHERE or the DISTINCT ON list.
    expect(textRead.indexOf("length(newest.normalized_text) <=")).toBeGreaterThan(-1);
    expect(textRead.indexOf("length(newest.normalized_text) <=")).toBeLessThan(textRead.indexOf("DISTINCT ON"));
    expect(textRead).not.toMatch(/length\(ast\./);
  });

  it("looks up Darwin's traced line first, and a bad trace row spoils only its own fee", async () => {
    const trace = { quote: "Outgoing Domestic Wire ........ $25.00", text_sha256: textSha256(TEXT), text_id: 900 };
    const found = await getFeeSourceLocations([11, 12], fakeDb([
      catalogRow(11, { extraction_note: null, trace }),
      catalogRow(12, { trace: "{not json", fee_name: "Overdraft Fee", amount: "32.00", extraction_note: 'excerpt="Overdraft Fee ........ $32.00 per item"' }),
    ], [textRow]));
    expect(found.get(11)?.location?.basis).toBe("traced_line");
    expect(found.get(12)?.location).toMatchObject({ basis: "excerpt", page: 1, textLine: 2 });
  });

  it("reads no further document once the deadline has passed", async () => {
    let clock = 0;
    const second = "Second Example Bank\nMoney Order $5.00";
    const found = await getFeeSourceLocations([11, 21], fakeDb(
      [catalogRow(11), catalogRow(21, { source_document_id: 80, fee_name: "Money Order", amount: "5.00", extraction_note: 'excerpt="Money Order $5.00"' })],
      [textRow, { id: 901, institution_id: 7, source_document_id: 80, normalized_text: second, text_hash: null }],
    ), { deadlineAt: 1, now: () => clock++ });
    expect(found.has(11)).toBe(true);
    expect(found.has(21)).toBe(false);
  });
});

describe("citations", () => {
  it("gives the citation words of found rows only", async () => {
    const db = fakeDb([catalogRow(11), catalogRow(12, { source_document_id: 71 })], [textRow]);
    const citations = await getFeeSourceCitations([11, 12], db);
    expect([...citations]).toEqual([[11, "page 2, line 2 of our stored copy of the bank's fee schedule"]]);
    const rows = await withFeeSourceCitations([{ id: 11, feeName: "Outgoing Domestic Wire" }, { id: 12, feeName: "Other" }], db);
    expect(rows).toEqual([
      { id: 11, feeName: "Outgoing Domestic Wire", sourceLocation: "page 2, line 2 of our stored copy of the bank's fee schedule" },
      { id: 12, feeName: "Other" },
    ]);
  });

  it("names no place when the read fails", async () => {
    const failing = (() => Promise.reject(new Error("statement timeout"))) as never;
    const original = console.error;
    console.error = () => undefined;
    try {
      expect((await getFeeSourceCitations([11], failing)).size).toBe(0);
    } finally {
      console.error = original;
    }
  });
});
