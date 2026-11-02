import { describe, expect, it } from "vitest";
import { getFeeSourceCitations, getFeeSourceLocations, withFeeSourceCitations } from "./source-line-traces";
import { textSha256 } from "@/lib/source-line-trace";

/** First Example Bank's stored schedule, two printed pages with footers. */
const TEXT = [
  "First Example Bank Schedule of Fees",
  "Overdraft Fee ........ $32.00 per item",
  "Page 1 of 2",
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
    expect(found.get(11)).toMatchObject({ miss: null, location: { page: 2, pageLine: 2, textLine: 5, textId: 900, textSha256: textSha256(TEXT) } });
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

  it("looks up Darwin's traced line first", async () => {
    const trace = { quote: "Outgoing Domestic Wire ........ $25.00", text_sha256: textSha256(TEXT), text_id: 900 };
    const found = await getFeeSourceLocations([11], fakeDb([catalogRow(11, { extraction_note: null, trace })], [textRow]));
    expect(found.get(11)?.location?.basis).toBe("traced_line");
  });
});

describe("citations", () => {
  it("gives the citation words of found rows only", async () => {
    const db = fakeDb([catalogRow(11), catalogRow(12, { source_document_id: 71 })], [textRow]);
    const citations = await getFeeSourceCitations([11, 12], db);
    expect([...citations]).toEqual([[11, "page 2, line 2 of the stored schedule"]]);
    const rows = await withFeeSourceCitations([{ id: 11, feeName: "Outgoing Domestic Wire" }, { id: 12, feeName: "Other" }], db);
    expect(rows).toEqual([
      { id: 11, feeName: "Outgoing Domestic Wire", sourceLocation: "page 2, line 2 of the stored schedule" },
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
