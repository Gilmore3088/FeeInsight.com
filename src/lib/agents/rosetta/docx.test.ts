import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DocxReadError, extractDocxText } from "./docx";

function docxBytes(body: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(xml) });
}

const paragraph = (...runs: string[]) => `<w:p><w:pPr><w:jc w:val="left"/></w:pPr>${runs.join("")}</w:p>`;
const run = (text: string) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const cell = (text: string) => `<w:tc><w:tcPr/>${paragraph(run(text))}</w:tc>`;

describe("Rosetta read.docx_text", () => {
  it("reads paragraphs, tab-separated prices and table rows", () => {
    const body = [
      paragraph(run("Schedule of Fees &amp; Charges")),
      paragraph(run("Overdraft fee"), "<w:r><w:tab/></w:r>", run("$35.00")),
      `<w:tbl><w:tblPr/><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell("Service")}${cell("Fee")}</w:tr>`,
      `<w:tr>${cell("Stop payment")}${cell("$30.00")}</w:tr><w:tr>${cell("Coin counting")}${cell("75¢")}</w:tr></w:tbl>`,
      paragraph(run("Effective January 1, 2026")),
    ].join("");

    const extracted = extractDocxText(docxBytes(body));

    expect(extracted.text.split("\n")).toEqual([
      "Schedule of Fees & Charges",
      "Overdraft fee | $35.00",
      "Service | Fee",
      "Stop payment | $30.00",
      "Coin counting | 75¢",
      "Effective January 1, 2026",
    ]);
    expect(extracted.rows).toEqual([
      { table: 0, page: null, cells: ["Service", "Fee"], header: true, origin: "docx_table" },
      { table: 0, page: null, cells: ["Stop payment", "$30.00"], header: false, origin: "docx_table" },
      { table: 0, page: null, cells: ["Coin counting", "75¢"], header: false, origin: "docx_table" },
    ]);
  });

  it("reports a legacy .doc or a broken file as not a .docx", () => {
    const legacyDoc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => extractDocxText(legacyDoc)).toThrow(DocxReadError);
    expect(() => extractDocxText(zipSync({ "other.xml": strToU8("<x/>") }))).toThrow(/word\/document\.xml/);
  });
});
