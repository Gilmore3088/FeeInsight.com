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

/** A tagged-template double: the catalog read gets `catalog`, the text read gets `texts`. */
function fakeDb(catalog: Row[], texts: Row[], queries: string[] = []) {
  return ((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
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
    expect(queries).toHaveLength(2);
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
    expect(textRead.indexOf("text_length <=")).toBeLessThan(textRead.indexOf("DISTINCT ON"));
    expect(textRead).not.toMatch(/WHERE[\s\S]*length\(ast\.normalized_text\) <=/);
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
    expect([...citations]).toEqual([[11, "page 2, line 2 of the stored text"]]);
    const rows = await withFeeSourceCitations([{ id: 11, feeName: "Outgoing Domestic Wire" }, { id: 12, feeName: "Other" }], db);
    expect(rows).toEqual([
      { id: 11, feeName: "Outgoing Domestic Wire", sourceLocation: "page 2, line 2 of the stored text" },
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
