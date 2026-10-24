import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractPdfDocumentText } from "./pdf-document-text";
import { compareReadings, readerPairs, streamPageText } from "./pdf-reader-agreement";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "test-fixtures", name)));

describe("Rosetta read.pdf_reader_agreement", () => {
  it("pairs a name with a price on its own line or the line under it", () => {
    const pairs = readerPairs([
      "Stop Payment Fee | $35.00 per request",
      "Wire Transfer Incoming",
      "• $15.00 per wire",
      "Overdraft Fee | Stop Payment Fee",
      "• $140.00 Maximum. $35.00 per item",
    ].join("\n"));
    expect(pairs.get("stop payment fee")?.prices).toEqual([35]);
    expect(pairs.get("wire transfer incoming")?.prices).toEqual([15]);
    // A row of two names pairs neither with the price under it.
    expect(pairs.get("overdraft fee")).toBeUndefined();
  });

  it("does not pair a column of names with the prices drawn after it", () => {
    const pairs = readerPairs("Overdraft fee\nStop payment\nReturned item\n$35.00\n$30.00\n$25.00");
    expect(pairs.get("stop payment")).toBeUndefined();
    expect(pairs.get("returned item")).toBeUndefined();
  });

  it("joins items in drawing order with the line ends the file marks", () => {
    const item = (str: string, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, 0, 0], width: 10, height: 10, hasEOL });
    expect(streamPageText([item("Wire "), item("Transfer", true), item("$15.00", true)])).toBe("Wire Transfer\n$15.00\n");
  });

  it("flags the stored Oakwood text whose columns moved three prices (#2219)", async () => {
    // The text Rosetta stored before layout version 5, against the drawing order of the same bytes.
    const { pages } = await extractPdfDocumentText(fixture("oakwood-fees.pdf"));
    const stored = readFileSync(join(__dirname, "test-fixtures", "oakwood-interleaved.txt"), "utf8");
    const pdfjs = await import("unpdf");
    const pdf = await pdfjs.getDocumentProxy(fixture("oakwood-fees.pdf"));
    const streams: string[] = [];
    for (let page = 1; page <= pdf.numPages; page += 1) {
      streams.push(streamPageText((await (await pdf.getPage(page)).getTextContent()).items.filter((item) => "str" in item)));
    }
    // The stored text is one document; compare it with every page's drawing order at once.
    const result = compareReadings([stored], [streams.join("\n")]);
    const byLabel = Object.fromEntries(result.disagreements.map((entry) => [entry.label, entry]));
    expect(byLabel["Account Reconciliation"]).toMatchObject({ layout: [15], stream: [35] });
    expect(byLabel["Wire Transfer Outgoing"]).toMatchObject({ layout: [35], stream: [30] });
    expect(byLabel["ATM/Debit Card Replacement"]).toMatchObject({ layout: [30], stream: [15] });
    expect(pages?.length).toBe(streams.length);
  });

  it.each(["oakwood-fees.pdf", "northern-trust-fees.pdf", "first-united-opt-in.pdf"])(
    "finds no disagreement in today's reading of %s",
    async (name) => {
      const { readerAgreement } = await extractPdfDocumentText(fixture(name));
      expect(readerAgreement?.disagreements).toEqual([]);
      expect(readerAgreement?.version).toBe(1);
    },
  );

  it("reports Oakwood's pairs as compared, not only its disagreements", async () => {
    const { readerAgreement } = await extractPdfDocumentText(fixture("oakwood-fees.pdf"));
    expect(readerAgreement?.compared).toBeGreaterThan(5);
  });
});
