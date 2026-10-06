import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { mapUploadTable, uploadFacts } from "./map";
import { parseCsv, readUploadTable, readXlsx } from "./parse";

// Invented figures for the tests; not any bank's data.
const CSV = `GL description,Month,Item count,Fee income ($),Items waived
Overdraft fees - consumer,2026-01,1000,"32,000",100
Overdraft fees - consumer,2026-02,1100,"35,200",90
NSF / returned item,2026-01,200,"6,400",20
NSF / returned item,2026-02,220,"7,040",30
Interchange income,2026-01,,"50,000",
`;

/** A minimal XLSX: a zip with deflated parts, built by hand for the test. */
function xlsx(sheetXml: string, strings: string[]): Buffer {
  const files: [string, string][] = [
    ["xl/sharedStrings.xml", `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`],
    ["xl/worksheets/sheet1.xml", `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`],
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = deflateRawSync(Buffer.from(text));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(text.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}

describe("reading uploads", () => {
  it("reads CSV with quoted commas", () => {
    const table = parseCsv(CSV);
    expect(table[0]).toEqual(["GL description", "Month", "Item count", "Fee income ($)", "Items waived"]);
    expect(table[1][3]).toBe("32,000");
    expect(table).toHaveLength(6);
  });

  it("reads the first worksheet of an XLSX, shared strings and numbers", () => {
    const sheet =
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1250</v></c></row>';
    const table = readXlsx(xlsx(sheet, ["Fee name", "Count", "Overdraft"]));
    expect(table).toEqual([["Fee name", "Count"], ["Overdraft", "", "1250"]]);
    expect(readUploadTable("fees.xlsx", xlsx(sheet, ["Fee name", "Count", "Overdraft"]))).toEqual(table);
  });

  it("refuses other file types", () => {
    expect(() => readUploadTable("fees.pdf", Buffer.from("%PDF"))).toThrow("CSV or XLSX");
  });
});

describe("mapping an upload to fees", () => {
  const preview = mapUploadTable(parseCsv(CSV));

  it("names the columns it read and the periods", () => {
    expect(preview.columns).toEqual({ label: "GL description", period: "Month", items: "Item count", income: "Fee income ($)", waived: "Items waived" });
    expect(preview.periods).toBe(2);
    expect(preview.problem).toBeNull();
  });

  it("sums each fee's rows, scales to a year and works out the waiver share", () => {
    const overdraft = preview.fees.find((f) => f.feeCategory === "overdraft");
    expect(overdraft).toMatchObject({
      feeName: "Overdraft",
      labels: ["Overdraft fees - consumer"],
      annualItems: 12_600,
      annualIncome: 403_200,
      waiverRate: 0.09,
      notes: ["Scaled from 2 periods to a year."],
    });
    expect(preview.fees.find((f) => f.feeCategory === "nsf")).toMatchObject({ annualItems: 2_520, waiverRate: 0.119 });
  });

  it("lists rows it could not match instead of guessing", () => {
    expect(preview.unmatched).toEqual([{ label: "Interchange income", rows: 1 }]);
  });

  it("turns the applied fees into memory facts", () => {
    expect(uploadFacts(preview, ["nsf"])).toEqual([
      { fieldKey: "fee.nsf.annual_items", value: 2_520 },
      { fieldKey: "fee.nsf.waiver_rate", value: 0.119 },
      { fieldKey: "fee.nsf.annual_income", value: 80_640 },
    ]);
  });

  it("says why when nothing can be read", () => {
    expect(mapUploadTable([["a", "b"], ["1", "2"]]).problem).toBe("No column names the fee or GL line.");
    expect(mapUploadTable([["Fee name", "Notes"], ["Overdraft", "x"]]).problem).toBe("No column of item counts, income or waivers was found.");
  });
});
