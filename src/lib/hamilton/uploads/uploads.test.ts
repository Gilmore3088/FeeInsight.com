import { zipSync, strToU8 } from "fflate";
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

/** Invented workbook parts, using a real CRC-valid ZIP writer. */
function xlsx(sheetXml: string, strings: string[]): Buffer {
  return Buffer.from(zipSync({
    "xl/sharedStrings.xml": strToU8(`<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`),
  }));
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
