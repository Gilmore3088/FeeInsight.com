// @vitest-environment node
import { Zip, ZipDeflate, strToU8, zipSync } from "fflate";
import { inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CELL_CHARS, MAX_COLUMNS, MAX_EXPANDED_BYTES, MAX_ROWS, MAX_SHARED_STRINGS, MAX_UPLOAD_BYTES, MAX_XML_BYTES, MAX_ZIP_ENTRIES } from "./limits";
import { parseCsv, readUploadTable, readXlsx } from "./parse";

vi.mock("node:zlib", async (original) => {
  const actual = await original<typeof import("node:zlib")>();
  return { ...actual, inflateRawSync: vi.fn(actual.inflateRawSync) };
});

const sheetName = "xl/worksheets/sheet1.xml";
const sharedName = "xl/sharedStrings.xml";
const sheet = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
const book = (rows: string, strings?: string, extra: Record<string, Uint8Array> = {}, level: 0 | 6 = 6) => Buffer.from(zipSync({
  [sheetName]: strToU8(sheet(rows)),
  ...(strings === undefined ? {} : { [sharedName]: strToU8(strings) }),
  ...extra,
}, { level }));
function directory(buf: Buffer): number[] {
  const end = buf.length - 22;
  const positions: number[] = [];
  let cursor = buf.readUInt32LE(end + 16);
  for (let index = 0; index < buf.readUInt16LE(end + 10); index++) {
    positions.push(cursor);
    cursor += 46 + buf.readUInt16LE(cursor + 28) + buf.readUInt16LE(cursor + 30) + buf.readUInt16LE(cursor + 32);
  }
  return positions;
}
function changeSizes(buf: Buffer, central: number, size: number): void {
  buf.writeUInt32LE(size, central + 24);
  buf.writeUInt32LE(size, buf.readUInt32LE(central + 42) + 22);
}

beforeEach(() => vi.clearAllMocks());

describe("valid financial-table compatibility", () => {
  it("keeps BOM, CRLF, quoted newlines, doubled quotes and zero", () => {
    expect(parseCsv('\uFEFFLabel,Count\r\n"Fee, with ""quote""\nand line",0\r\n')).toEqual([
      ["Label", "Count"], ['Fee, with "quote"\nand line', "0"],
    ]);
  });
  it.each([0, 6] as const)("keeps inline/shared rich text, Unicode entities, sparse cells and cached zero (ZIP level %i)", (level) => {
    const bytes = book('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><r><t>Fee &amp; </t></r><r><t>&#x1F4B5;</t></r></is></c><c r="D1"><f>1-1</f><v>0</v></c><c r="E1"/></row>',
      '<sst><si><r><t>Over</t></r><r><t>draft</t></r><rPh><t>ignored</t></rPh></si></sst>', {}, level);
    expect(readXlsx(bytes)).toEqual([["Overdraft", "", "Fee & 💵", "0", ""]]);
    expect(readUploadTable("download.bin", bytes)).toHaveLength(1);
  });
  it("accepts normal streaming ZIP data descriptors", () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, data) => { if (error) throw error; chunks.push(data); });
    const part = new ZipDeflate(sheetName);
    zip.add(part);
    part.push(strToU8(sheet('<row r="1"><c r="A1"><v>0</v></c></row>')), true);
    zip.end();
    expect(readXlsx(Buffer.concat(chunks))).toEqual([["0"]]);
  });
  it("allows the exact row, width and cell-text boundaries", () => {
    expect(parseCsv("0\n".repeat(MAX_ROWS))).toHaveLength(MAX_ROWS);
    expect(parseCsv(Array(MAX_COLUMNS).fill("0").join(","))[0]).toHaveLength(MAX_COLUMNS);
    expect(parseCsv("a".repeat(MAX_CELL_CHARS))[0][0]).toHaveLength(MAX_CELL_CHARS);
    expect(readXlsx(book('<row r="5000"><c r="DX5000"><v>0</v></c></row>'))[0]).toHaveLength(MAX_COLUMNS);
  });
});

describe("CSV rejects whole tables instead of returning partial financial data", () => {
  it.each([
    ["rows", () => "0\n".repeat(MAX_ROWS + 1), "5,000"],
    ["blank records", () => "\n".repeat(MAX_ROWS + 1), "5,000"],
    ["columns", () => Array(MAX_COLUMNS + 1).fill("0").join(","), "128 columns"],
    ["total cells", () => (Array(MAX_COLUMNS).fill("0").join(",") + "\n").repeat(782), "100,000 cells"],
    ["cell text", () => "a".repeat(MAX_CELL_CHARS + 1), "16,384"],
    ["aggregate text", () => Array(MAX_COLUMNS).fill("a".repeat(16_000)).join(","), "2,000,000 characters"],
    ["input bytes", () => "£".repeat(MAX_UPLOAD_BYTES / 2 + 1), "2 MB"],
  ])("rejects excess %s", (_name, input, message) => {
    expect(() => parseCsv(input())).toThrow(message);
  });
  it.each(['"unclosed', 'Label\n"100"broken', 'Label\n12"3', "a\0b", '"a\0b"'])("rejects malformed CSV %j", (csv) => {
    expect(() => parseCsv(csv)).toThrow("could not be read");
  });
  it("rejects invalid UTF-8 instead of replacing financial text", () => {
    expect(() => readUploadTable("fees.csv", Buffer.from([0xc3, 0x28]))).toThrow("could not be read");
  });
});

describe("XLSX coordinate, shared-string and XML budgets", () => {
  it.each(["ZZZZ1", "DY1", "AAAAAAAAAAAAAAAAAAAA1"])("refuses sparse column %s before padding", (ref) => {
    expect(() => readXlsx(book(`<row r="1"><c r="${ref}"><v>1</v></c></row>`))).toThrow("128 columns");
  });
  it("counts empty sparse slots toward the aggregate cell budget", () => {
    const rows = Array.from({ length: 782 }, (_, index) => `<row r="${index + 1}"><c r="DX${index + 1}"><v>0</v></c></row>`).join("");
    expect(() => readXlsx(book(rows))).toThrow("100,000 cells");
  });
  it("rejects row references above the limit and additional records", () => {
    expect(() => readXlsx(book('<row r="5001"><c r="A5001"><v>1</v></c></row>'))).toThrow("5,000");
    expect(() => readXlsx(book('<row><c><v>1</v></c></row>'.repeat(MAX_ROWS + 1)))).toThrow("5,000");
  });
  it.each([
    ['<row r="1"><c r="A2"><v>1</v></c></row>', undefined],
    ['<row r="1"><c r="A1"/><c r="A1"/></row>', undefined],
    ['<row r="1"><c r="A1" t="s"><v>1</v></c></row>', '<sst><si><t>one</t></si></sst>'],
    ['<row r="1"><c r="A1" t="s"><v>-1</v></c></row>', '<sst/>'],
    ['<row r="1"><c r="A1" t="s"><v>1.0</v></c></row>', '<sst/>'],
  ])("rejects invalid or conflicting cell references", (rows, strings) => {
    expect(() => readXlsx(book(rows, strings))).toThrow("could not be read");
  });
  it("limits cell text before joining inline runs", () => {
    expect(() => readXlsx(book(`<row><c t="inlineStr"><is><r><t>${"a".repeat(MAX_CELL_CHARS)}</t></r><r><t>b</t></r></is></c></row>`))).toThrow("16,384");
  });
  it("limits shared-string count even when strings are empty or unused", () => {
    expect(() => readXlsx(book("", `<sst>${"<si/>".repeat(MAX_SHARED_STRINGS + 1)}</sst>`))).toThrow("expanded workbook");
  });
  it("limits per-string and total dictionary text before retaining it", () => {
    expect(() => readXlsx(book("", `<sst><si><t>${"a".repeat(MAX_CELL_CHARS + 1)}</t></si></sst>`))).toThrow("16,384");
    expect(() => readXlsx(book("", `<sst>${`<si><t>${"a".repeat(1001)}</t></si>`.repeat(1000)}</sst>`))).toThrow("expanded workbook");
  });
  it("counts repeated shared-string values in the table text budget", () => {
    const cells = '<c t="s"><v>0</v></c>'.repeat(123);
    expect(() => readXlsx(book(`<row>${cells}</row>`, `<sst><si><t>${"a".repeat(MAX_CELL_CHARS)}</t></si></sst>`))).toThrow("2,000,000 characters");
  });
  it.each([
    '<worksheet><sheetData><row></sheetData></worksheet>',
    '<worksheet><sheetData/></worksheet></extra>',
    '<worksheet><sheetData><row>',
    '<!DOCTYPE worksheet [<!ENTITY data "123">]><worksheet><sheetData/></worksheet>',
    '<worksheet><sheetData/><sheetData/></worksheet>',
    '<worksheet><sheetData><row r=1/></sheetData></worksheet>',
    '<worksheet><sheetData><row r="1"r="2"/></sheetData></worksheet>',
    '<worksheet><sheetData><row><c><v><x>12</x></v></c></row></sheetData></worksheet>',
    '<worksheet><sheetData><row><c t="inlineStr"><is><t>&undefined;</t></is></c></row></sheetData></worksheet>',
    '<worksheet><sheetData><row><c t="inlineStr"><is><t>&#0;</t></is></c></row></sheetData></worksheet>',
  ])("rejects malformed/unsupported XML rather than a partial table", (xml) => {
    const bytes = Buffer.from(zipSync({ [sheetName]: strToU8(xml) }));
    expect(() => readXlsx(bytes)).toThrow("could not be read");
  });
  it("bounds XML nesting and attribute counts", () => {
    for (const xml of [sheet("<x>".repeat(64) + "</x>".repeat(64)), `<worksheet ${Array.from({ length: 65 }, (_, i) => `a${i}="x"`).join(" ")}><sheetData/></worksheet>`]) {
      expect(() => readXlsx(Buffer.from(zipSync({ [sheetName]: strToU8(xml) })))).toThrow("expanded workbook");
    }
  });
});

describe("ZIP validation precedes expansion", () => {
  it.each(["directory offset", "directory length", "local offset", "name length", "encrypted", "compression", "multidisk"])("rejects forged %s without inflating", (kind) => {
    const bytes = book("");
    const central = directory(bytes)[0];
    const end = bytes.length - 22;
    if (kind === "directory offset") bytes.writeUInt32LE(0xffffffff, end + 16);
    if (kind === "directory length") bytes.writeUInt32LE(0xffffffff, end + 12);
    if (kind === "local offset") bytes.writeUInt32LE(0xffffffff, central + 42);
    if (kind === "name length") bytes.writeUInt16LE(0xffff, central + 28);
    if (kind === "encrypted") bytes.writeUInt16LE(1, central + 8);
    if (kind === "compression") bytes.writeUInt16LE(99, central + 10);
    if (kind === "multidisk") bytes.writeUInt16LE(1, end + 4);
    expect(() => readXlsx(bytes)).toThrow("could not be read");
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
  it("checks declared entry and aggregate sizes before expansion, including ignored parts", () => {
    const bytes = book("", undefined, { "ignore1.xml": strToU8("1"), "ignore2.xml": strToU8("2") });
    const positions = directory(bytes);
    changeSizes(bytes, positions[2], MAX_XML_BYTES + 1);
    expect(() => readXlsx(bytes)).toThrow("expanded workbook");
    for (const position of positions) changeSizes(bytes, position, Math.floor(MAX_EXPANDED_BYTES / 3) + 1);
    expect(() => readXlsx(bytes)).toThrow("expanded workbook");
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
  it("bounds ZIP entry count before constructing entries", () => {
    const parts = Object.fromEntries(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => [`part${i}`, new Uint8Array()]));
    expect(() => readXlsx(Buffer.from(zipSync(parts)))).toThrow("expanded workbook");
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
  it("bounds actual inflation to the declared length when the archive lies", () => {
    const bytes = book(`<row><c t="inlineStr"><is><t>${"x".repeat(2_000_000)}</t></is></c></row>`);
    changeSizes(bytes, directory(bytes)[0], 100);
    expect(() => readXlsx(bytes)).toThrow("could not be read");
    expect(inflateRawSync).toHaveBeenCalledWith(expect.any(Buffer), { maxOutputLength: 100 });
  });
  it("rejects duplicate names and overlapping local ranges before expansion", () => {
    const duplicate = book("", undefined, { "xl/worksheets/sheet2.xml": strToU8(sheet("")) });
    const second = directory(duplicate)[1];
    const local = duplicate.readUInt32LE(second + 42);
    Buffer.from(sheetName).copy(duplicate, second + 46);
    Buffer.from(sheetName).copy(duplicate, local + 30);
    expect(() => readXlsx(duplicate)).toThrow("could not be read");
    const overlapping = book("", undefined, { "xl/worksheets/sheet2.xml": strToU8(sheet("")) });
    const [first, next] = directory(overlapping);
    const start = 30 + overlapping.readUInt16LE(26) + overlapping.readUInt16LE(28);
    const size = overlapping.readUInt32LE(next + 42) + 1 - start;
    overlapping.writeUInt32LE(size, first + 20);
    overlapping.writeUInt32LE(size, 18);
    expect(() => readXlsx(overlapping)).toThrow("could not be read");
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
  it("checks local header bounds and the ZIP64 size sentinel before expansion", () => {
    const localBounds = book("");
    localBounds.writeUInt16LE(0xffff, 28);
    expect(() => readXlsx(localBounds)).toThrow("could not be read");
    const zip64 = book("", undefined, {}, 6);
    const central = directory(zip64)[0];
    zip64.writeUInt32LE(0xffffffff, central + 24);
    expect(() => readXlsx(zip64)).toThrow("expanded workbook");
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
  it("rejects mismatched actual length and CRC", () => {
    const wrongSize = book("");
    const position = directory(wrongSize)[0];
    changeSizes(wrongSize, position, wrongSize.readUInt32LE(position + 24) + 1);
    expect(() => readXlsx(wrongSize)).toThrow("could not be read");
    const wrongCrc = book("");
    const central = directory(wrongCrc)[0];
    wrongCrc.writeUInt32LE(1, central + 16);
    wrongCrc.writeUInt32LE(1, wrongCrc.readUInt32LE(central + 42) + 14);
    expect(() => readXlsx(wrongCrc)).toThrow("could not be read");
  });
  it.each([Buffer.alloc(0), Buffer.from("PK"), Buffer.alloc(21)])("rejects short archives safely", (bytes) => {
    expect(() => readXlsx(bytes)).toThrow("could not be read");
    expect(inflateRawSync).not.toHaveBeenCalled();
  });
});
