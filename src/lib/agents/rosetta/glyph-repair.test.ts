import { describe, expect, it } from "vitest";
import {
  decodeTextBytes,
  declaredCharset,
  DROPPED_LIGATURE_DUE_PATTERN,
  DROPPED_LIGATURE_WORDS,
  expandUnicodeLigatures,
  FEE_TEXT_LIGATURE_WORDS,
  GLYPH_REPAIR_DUE_PATTERN,
  LIGATURE_CANDIDATES,
  MIN_DROPPED_LIGATURE_WORDS,
  repairUnmappedGlyphs,
  restoreDroppedLigatures,
} from "./glyph-repair";
import { extractPdfDocumentText } from "./pdf-document-text";

const G = "\uFFFD";
const repaired = (text: string, documentText?: string) => repairUnmappedGlyphs(text, documentText).text;

/**
 * A one-page PDF whose Helvetica text maps "X" to U+FFFD through its ToUnicode CMap, the way
 * Word's export maps its "ti" ligature glyph (#2598): pdf.js reads "Interna\uFFFDonal".
 */
function pdfWithUnmappedGlyph(line: string): Uint8Array {
  const cmap = [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def /CMapType 2 def",
    "1 begincodespacerange <00> <FF> endcodespacerange",
    "1 beginbfrange <20> <7E> <0020> endbfrange",
    "1 beginbfchar <58> <FFFD> endbfchar",
    "endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
  const content = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("repairUnmappedGlyphs (#2598)", () => {
  it("restores the words Word's ligature glyphs broke in live fee names", () => {
    expect(repaired(`Wire Interna${G}onal Transfer-Remote Outgoing ..$70.00*`)).toBe("Wire International Transfer-Remote Outgoing ..$70.00*");
    expect(repaired(`Wire transfer - Outgoing (domes${G}c only)`)).toBe("Wire transfer - Outgoing (domestic only)");
    expect(repaired(`automa${G}c transfers per month) | Cashier's Check Stop Payment Fee | $25/check`))
      .toBe("automatic transfers per month) | Cashier's Check Stop Payment Fee | $25/check");
    expect(repaired(`Account Reconcilia${G}on Fee | $25/hour`)).toBe("Account Reconciliation Fee | $25/hour");
  });

  it("tries every ligature Word draws, not only ti", () => {
    expect(repaired(`Overdra${G} Fee from Savings`)).toBe("Overdraft Fee from Savings");
    expect(repaired(`$1.50 a${G}er 6/month`)).toBe("$1.50 after 6/month");
    expect(repaired(`Share Dra${G} Photocopies`)).toBe("Share Draft Photocopies");
    expect(repaired(`Visa Gi${G} Cards`)).toBe("Visa Gift Cards");
    expect(repaired(`submi${G}ng`)).toBe("submitting");
    expect(repaired(`the di${G}erence`)).toBe("the difference");
    expect(repaired(`our o${G}ce`)).toBe("our office");
    expect(repaired(`speci${G}cally`)).toBe("specifically");
    expect(repaired(`not-for-pro${G}it`)).toBe("not-for-profit");
    expect(repaired(`WIRE INTERNA${G}ONAL`)).toBe("WIRE INTERNATIONAL");
    expect(repaired(`our compe${G}${G}veness`)).toBe(`our compe${G}${G}veness`);
    expect(repaired(`Compe${G}${G}on`)).toBe("Competition");
    // A lone f only before i or l: "o\uFFFDf" is not read as "off".
    expect(repaired(`o${G}f the`)).toBe(`o${G}f the`);
  });

  it("restores a decimal point between a dollar amount and its cents", () => {
    expect(repaired(`Out of Network ATMs $2${G}00/Transaction`)).toBe("Out of Network ATMs $2.00/Transaction");
    expect(repaired(`Research $143${G}56`)).toBe("Research $143.56");
    // Cents above the dollar figure could be a range ("$5-10"): restored only where the document
    // writes the glyph as its decimal elsewhere and never between two dollar figures.
    expect(repaired(`Copies $5${G}10 per page`)).toBe(`Copies $5${G}10 per page`);
    expect(repaired(`Bill Pay Overnight Check ${G}${G}${G} $14${G}95 each`)).toBe(`Bill Pay Overnight Check ${G}${G}${G} $14${G}95 each`);
    expect(repaired(`Bill Pay Overnight Check $14${G}95 each\nStop Payment $30${G}00`)).toBe("Bill Pay Overnight Check $14.95 each\nStop Payment $30.00");
    expect(repaired(`Copies $5${G}10 per page\nStop Payment $30${G}00\nResearch $5${G}$10`)).toBe(`Copies $5${G}10 per page\nStop Payment $30.00\nResearch $5${G}$10`);
    // Without a dollar sign, or with more than two digits after it, the glyph is not provably a point.
    expect(repaired(`Account Closed Early Fee 30${G}89`)).toBe(`Account Closed Early Fee 30${G}89`);
    expect(repaired(`$1${G}000`)).toBe(`$1${G}000`);
  });

  it("leaves dot leaders, bullets and words with no single reading as they are", () => {
    for (const text of [
      `Bill Pay${G}${G}${G}${G}${G}Free`,
      `${G} Checks and ACH withdrawals`,
      `${G}inancial cooperative`,
      `ch${G}ck usi${G}g w${G}h`,
      `this account${G} The fee`,
      `o${G} the schedule`,
    ]) {
      expect(repaired(text)).toBe(text);
    }
  });

  it("does not read a broken full stop after a word the text prints as a ligature", () => {
    // "an" is printed on its own, so "an\uFFFD" is "an." and not "anti".
    const text = `This is an account. You pay an${G} Fees are set by us`;
    expect(repaired(text)).toBe(text);
    // "the" + "ft" is "theft", but "the" ends sentences, so its glyph is never read as one.
    expect(repaired(`Fees are set by the${G}`)).toBe(`Fees are set by the${G}`);
  });

  it("leaves a word when two spellings are known", () => {
    // The text prints "otter", so "o\uFFFDer" could be "offer" or "otter".
    const document = `Otter Creek branch. We o${G}er checking.`;
    expect(repaired(document)).toBe(document);
    expect(repaired(`We o${G}er checking.`)).toBe("We offer checking.");
  });

  it("learns rare words from the same document", () => {
    expect(repaired(`Pa${G}nder branch`)).toBe(`Pa${G}nder branch`);
    expect(repaired(`Pa${G}nder branch`, `Pa${G}nder branch. Mail to Pattnder, NE.`)).toBe("Pattnder branch");
  });

  it("counts what it restored and what it left", () => {
    expect(repairUnmappedGlyphs(`Interna${G}onal ${G}${G} $5${G}00`)).toEqual({ text: `International ${G}${G} $5.00`, restored: 2, left: 2 });
    expect(repairUnmappedGlyphs("No glyphs here")).toEqual({ text: "No glyphs here", restored: 0, left: 0 });
  });

  it("writes Unicode ligatures as their letters", () => {
    expect(expandUnicodeLigatures("\uFB01nancial \uFB02at \uFB00 \uFB03ce \uFB04e")).toBe("financial flat ff ffice ffle");
    expect(repaired("Certi\uFB01ed check")).toBe("Certified check");
  });

  it("keeps its word list to words with a ligature's letters", () => {
    for (const word of FEE_TEXT_LIGATURE_WORDS) expect(word).toMatch(/^[a-z]+$/);
    for (const word of FEE_TEXT_LIGATURE_WORDS) expect(word).toMatch(/ti|ft|tt|ff|fi|fl/);
    expect(LIGATURE_CANDIDATES).toContain("ti");
    expect(new RegExp(GLYPH_REPAIR_DUE_PATTERN).test(`a${G}b`)).toBe(true);
    expect(new RegExp(GLYPH_REPAIR_DUE_PATTERN).test("\uFB01")).toBe(true);
    expect(new RegExp(GLYPH_REPAIR_DUE_PATTERN).test("plain")).toBe(false);
  });
});

describe("the PDF reader restores glyphs its ToUnicode map leaves unknown", () => {
  it("reads International where the PDF maps the ligature glyph to U+FFFD", async () => {
    const extracted = await extractPdfDocumentText(pdfWithUnmappedGlyph("Wire InternaXonal Transfer $70.00"));
    expect(extracted.text).toBe("Wire International Transfer $70.00");
  });
});

describe("restoreDroppedLigatures (#1513 follow-up)", () => {
  // Stored text 6266 (Bay Area CU, document 3092), lines verbatim: the font drops its ti and ft
  // ligatures with no character left, so live fee 42754 was filed as a domestic wire.
  const bayArea = [
    "Account Research/Reconciliaon (per hour/1hr min.).................25.00",
    "ACH Overdra...............................................................................30.00",
    "Non-Sufficient Funds (NSF)...........................................................30.00",
    "Inacve Checking (per mo. aer 2 consecuve months)..............10.00",
    "Wire Transfer Outgoing (Domesc)...............................................25.00",
    "Wire Transfer Outgoing (Internaonal).........................................50.00",
    "Deposit Verificaons.......................................................................5.00",
  ].join("\n");
  const restored = (text: string, documentText?: string) => restoreDroppedLigatures(text, documentText).text;

  it("restores the fee words a font's dropped ligatures broke", () => {
    expect(restoreDroppedLigatures(bayArea)).toEqual({
      text: [
        "Account Research/Reconciliation (per hour/1hr min.).................25.00",
        "ACH Overdraft...............................................................................30.00",
        "Non-Sufficient Funds (NSF)...........................................................30.00",
        // "aer" is too short to tell from a real word and stays.
        "Inactive Checking (per mo. aer 2 consecutive months)..............10.00",
        "Wire Transfer Outgoing (Domestic)...............................................25.00",
        "Wire Transfer Outgoing (International).........................................50.00",
        "Deposit Verifications.......................................................................5.00",
      ].join("\n"),
      restored: 7,
    });
  });

  it("restores a page from the evidence of the whole document", () => {
    expect(restored("Wire Transfer Outgoing (Internaonal) 50.00", bayArea)).toBe("Wire Transfer Outgoing (International) 50.00");
  });

  it("needs two different broken words in the document before it restores any", () => {
    // Stored text 2451's kind of slip: one broken word in a text that prints the rest whole.
    expect(restored("- Overdra\nwill be available | overdraft")).toBe("- Overdra\nwill be available | overdraft");
    // A plural counts with its singular (stored text 13094 holds only these two).
    expect(restored("Overdra Fee $30 and overdras")).toBe("Overdra Fee $30 and overdras");
    expect(restored("Overdra Fee $30 and Domesc wire")).toBe("Overdraft Fee $30 and Domestic wire");
  });

  it("never rewrites a word inside a web address", () => {
    expect(restored("See https://bank.com/forms/Domesc.pdf | Domesc wire | Internaonal wire"))
      .toBe("See https://bank.com/forms/Domesc.pdf | Domestic wire | International wire");
    expect(restored("www.bank.com/internaonal | Research/Reconciliaon | Domesc"))
      .toBe("www.bank.com/internaonal | Research/Reconciliation | Domestic");
  });

  it("keeps case and reads a ligature left as a space", () => {
    expect(restored("WIRE (INTERNAONAL) | DOMESC WIRE")).toBe("WIRE (INTERNATIONAL) | DOMESTIC WIRE");
    expect(restored("Interna onal wire | Transac on fee")).toBe("International wire | Transaction fee");
    // A gap leaving one letter beside it ("Domes c") is too doubtful to read.
    expect(restored("Domes c | Interna onal | Transac on")).toBe("Domes c | International | Transaction");
  });

  it("never touches a real word, a word inside another, or a glyph written as another character", () => {
    const evidence = "Domesc and Internaonal wires";
    expect(restored("social security", evidence)).toBe("social security");
    expect(restored("Socially and officially", evidence)).toBe("Socially and officially");
    // A font's ligature letter (Knox reads it), U+FFFD (glyph repair), or a stand-in glyph.
    for (const text of ["OverdraŌ Fee", "Overdra� Fee", "overdra*s", "Overdra( Fee", "transac5on", "Overdra (NSF)"]) {
      expect(restored(text, evidence)).toBe(text);
    }
  });

  it("lists only words with a ligature's letters, and no broken spelling is a word it knows", () => {
    for (const word of DROPPED_LIGATURE_WORDS) expect(word).toMatch(/^[a-z]+$/);
    for (const word of DROPPED_LIGATURE_WORDS) expect(word).toMatch(/ti|ft|tt|ff|fi|fl/);
    expect(MIN_DROPPED_LIGATURE_WORDS).toBe(2);
    for (const word of [...DROPPED_LIGATURE_WORDS, ...FEE_TEXT_LIGATURE_WORDS]) {
      expect(restored(`${word} ${word}`, bayArea)).toBe(`${word} ${word}`);
    }
  });

  it("gives Postgres one lowercase pattern for broken fee words, apart from the glyph test", () => {
    expect(GLYPH_REPAIR_DUE_PATTERN).toBe("[\uFFFD\uFB00-\uFB06]");
    expect(new RegExp(GLYPH_REPAIR_DUE_PATTERN).test("ACH Overdra Fee")).toBe(false);
    const alternation = DROPPED_LIGATURE_DUE_PATTERN.slice(3, -3);
    expect(alternation).toMatch(/^[a-z |]+$/);
    expect(DROPPED_LIGATURE_DUE_PATTERN.startsWith("\\m(")).toBe(true);
    expect(DROPPED_LIGATURE_DUE_PATTERN.endsWith(")\\M")).toBe(true);
    // Read as JavaScript with \b for Postgres's word edges, case-insensitively as `~*` reads it.
    const due = new RegExp(DROPPED_LIGATURE_DUE_PATTERN.replace(/\\[mM]/g, "\\b"), "i");
    expect(due.test("Wire Transfer Outgoing (Internaonal)")).toBe(true);
    expect(due.test("ACH OVERDRA....30.00")).toBe(true);
    expect(due.test("Wire Transfer Outgoing (International) social")).toBe(false);
  });

  it("is applied by the PDF reader to every page", async () => {
    const extracted = await extractPdfDocumentText(pdfWithUnmappedGlyph("Wire Outgoing (Domesc) $25.00 (Internaonal) $50.00"));
    expect(extracted.text).toBe("Wire Outgoing (Domestic) $25.00 (International) $50.00");
  });
});

describe("decodeTextBytes (#2598)", () => {
  const latin1 = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

  it("reads a Latin-1 page in Latin-1 instead of writing U+FFFD", () => {
    expect(decodeTextBytes(latin1("Zelle\u00AE"), "text/html;charset=ISO-8859-1")).toBe("Zelle\u00AE");
    // Served as UTF-8 but sent as Latin-1: bytes that are not UTF-8 fall back to Windows-1252.
    expect(decodeTextBytes(latin1("\u00A9 2026 FNB"), "text/html; charset=UTF-8")).toBe("\u00A9 2026 FNB");
    expect(decodeTextBytes(Uint8Array.from([0x93, 0x51, 0x94]), null)).toBe("\u201CQ\u201D");
  });

  it("keeps valid UTF-8 as UTF-8 whatever the page declares", () => {
    const bytes = new TextEncoder().encode("Zelle\u00AE \u2014 $5.00");
    expect(decodeTextBytes(bytes, "text/html;charset=ISO-8859-1")).toBe("Zelle\u00AE \u2014 $5.00");
  });

  it("keeps a UTF-8 page's characters when one byte on it is Latin-1 (#2649 review)", () => {
    const utf8 = (text: string) => Array.from(new TextEncoder().encode(text));
    const mixed = Uint8Array.from([...utf8("Zelle\u00AE fee \u2013 $5 Cashier\u2019s "), 0xa0, ...utf8("ok")]);
    expect(decodeTextBytes(mixed, "text/html; charset=utf-8")).toBe("Zelle\u00AE fee \u2013 $5 Cashier\u2019s \u00A0ok");
    // The Kasasa footer: a UTF-8 page whose copyright sign is a raw 0xA9 byte.
    const kasasa = Uint8Array.from([...utf8("NSF \u2013 Nonsufficient Funds Fee $30.00\nCopyright "), 0xa9, ...utf8(" Kasasa, Ltd.")]);
    expect(decodeTextBytes(kasasa, "text/html; charset=UTF-8")).toBe("NSF \u2013 Nonsufficient Funds Fee $30.00\nCopyright \u00A9 Kasasa, Ltd.");
    expect(decodeTextBytes(kasasa, null)).not.toMatch(/\u00E2|\uFFFD/);
    // A truncated or overlong sequence is not UTF-8: each of its bytes is read as Windows-1252.
    expect(decodeTextBytes(Uint8Array.from([0x41, 0xe2, 0x80, 0x41]), null)).toBe("A\u00E2\u20ACA");
    expect(decodeTextBytes(Uint8Array.from([0xc0, 0xaf, 0x93]), null)).toBe("\u00C0\u00AF\u201C");
  });

  it("reads the charset a page declares in its own meta tag", () => {
    const page = latin1('<html><head><meta charset="iso-8859-2"></head><body>\u00B1</body></html>');
    expect(declaredCharset(page, "text/html")).toBe("iso-8859-2");
    expect(decodeTextBytes(page, "text/html")).toContain("\u0105");
  });
});
