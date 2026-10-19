import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  applicationLines,
  buildInstitutionIndex,
  cleaningReport,
  commentSubmitter,
  CsvStreamParser,
  eventDate,
  exactNameKey,
  fetchPublishedList,
  findDataLinks,
  h2ReleaseDates,
  idValue,
  looksLikeInstitution,
  mapTable,
  matchInstitution,
  moneyValue,
  NCUA_LIQUIDATION_SPEC,
  parseSecFeeFacts,
  readXlsxTable,
  SbaAggregator,
  scanSecFilingText,
  yearValue,
} from "./industry-events";

describe("value readers", () => {
  it("never turns a blank into zero", () => {
    expect(moneyValue("$1,234.50")).toBe(1234.5);
    expect(moneyValue("(1,000)")).toBe(-1000);
    expect(moneyValue("")).toBeNull();
    expect(moneyValue("n/a")).toBeNull();
    expect(idValue("0")).toBeNull();
    expect(idValue("628.0")).toBe("628");
  });

  it("reads the date shapes lists use", () => {
    expect(eventDate("2026-03-31")).toBe("2026-03-31");
    expect(eventDate("3/1/2026")).toBe("2026-03-01");
    expect(eventDate("March 1, 2026")).toBe("2026-03-01");
    expect(eventDate("45658")).toBe("2025-01-01");
    expect(eventDate("soon")).toBeNull();
    expect(yearValue("FY2024")).toBe(2024);
    expect(yearValue("Round 3")).toBeNull();
  });

  it("keys names by case and punctuation only", () => {
    expect(exactNameKey("Wells Fargo Bank, N.A.")).toBe(exactNameKey("WELLS FARGO BANK NA"));
    expect(exactNameKey("A&B Bank")).toBe("a and b bank");
    expect(exactNameKey("Wells Fargo Bank, National Association")).not.toBe(exactNameKey("Wells Fargo Bank NA"));
  });
});

describe("institution matching", () => {
  const index = buildInstitutionIndex([
    { id: 1, source: "fdic", cert_number: "628", rssd_id: "852218", institution_name: "JPMorgan Chase Bank, N.A.", state_code: "OH" },
    { id: 2, source: "ncua", cert_number: "5536", rssd_id: null, institution_name: "Navy Federal Credit Union", state_code: "VA" },
    { id: 3, source: "fdic", cert_number: "1", rssd_id: null, institution_name: "First State Bank", state_code: "TX" },
    { id: 4, source: "fdic", cert_number: "2", rssd_id: null, institution_name: "First State Bank", state_code: "TX" },
  ]);

  it("matches on keys first, then a name only one institution carries", () => {
    expect(matchInstitution(index, { fdicCert: "00628" })).toMatchObject({ institutionId: 1, method: "fdic_cert" });
    expect(matchInstitution(index, { ncuaCharter: "5536" })).toMatchObject({ institutionId: 2, method: "ncua_charter" });
    expect(matchInstitution(index, { rssd: "852218" })).toMatchObject({ institutionId: 1, method: "rssd" });
    expect(matchInstitution(index, { name: "NAVY FEDERAL CREDIT UNION", state: "va" })).toMatchObject({ institutionId: 2 });
    expect(matchInstitution(index, { name: "Navy Federal Credit Union" }).institutionId).toBeNull();
    expect(matchInstitution(index, { name: "Navy Federal Credit Union", nameWithoutState: true }).institutionId).toBe(2);
  });

  it("leaves a shared name unmatched and says so", () => {
    expect(matchInstitution(index, { name: "First State Bank", state: "TX" })).toEqual({ institutionId: null, method: null, ambiguous: true });
  });
});

describe("tables", () => {
  it("parses CSV split across chunks, including quotes and CRLF", () => {
    const rows: string[][] = [];
    const parser = new CsvStreamParser((r) => rows.push(r));
    for (const chunk of ['a,"b ""x', '""",c\r', "\n1,2,3\r\n", '4,"5,', '6",7']) parser.push(chunk);
    parser.end();
    expect(rows).toEqual([["a", 'b "x"', "c"], ["1", "2", "3"], ["4", "5,6", "7"]]);
  });

  it("reads an XLSX worksheet without a row cap", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Acme &amp; Co</t></is></c><c r="C2"><v>12</v></c></row>
    </sheetData></worksheet>`;
    const bytes = zipSync({
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Name</t></si><si><r><t>Am</t></r><r><t>ount</t></r></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    });
    expect(readXlsxTable(bytes)).toEqual([["Name", "", "Amount"], ["Acme & Co", "", "12"]]);
  });

  it("finds the header row and reports missing and unexpected columns", () => {
    const table = mapTable(
      [["Credit Union Liquidations"], ["Credit Union Name", "Charter Number", "State", "Liquidation Date", "Notes"], ["Acme FCU", "123", "OH", "1/5/2025", "x"]],
      NCUA_LIQUIDATION_SPEC,
      ["name", "date"],
    )!;
    expect(table.headerRow).toBe(1);
    expect(table.rows[0].fields).toMatchObject({ name: "Acme FCU", charter: "123", state: "OH", date: "1/5/2025", city: null });
    expect(table.missingFields).toEqual(expect.arrayContaining(["city", "type", "acquirerName"]));
    expect(table.unexpectedHeaders).toEqual(["Notes"]);
    expect(table.rows[0].raw.Notes).toBe("x");
  });

  it("lists data links that match, resolved against the page", () => {
    const html = '<a href="/files/members-2026q2.xlsx">FHLBank members Q2</a><a href="/other.xlsx">Budget</a><a href="x.pdf">Member report</a>';
    expect(findDataLinks(html, "https://www.fhfa.gov/data/fhlb-membership", /member/i)).toEqual([
      { url: "https://www.fhfa.gov/files/members-2026q2.xlsx", text: "FHLBank members Q2", kind: "xlsx" },
      { url: "https://www.fhfa.gov/data/x.pdf", text: "Member report", kind: "pdf" },
    ]);
  });

  it("downloads at most maxFiles data files from a page", async () => {
    const page = '<a href="/a/insurance-report-activity-mar-2026.zip">March 2026</a><a href="/a/insurance-report-activity-dec-2025.zip">December 2025</a>';
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith(".zip") ? new Response(zipSync({ "notes.pdf": new Uint8Array([1]) }), { status: 200 }) : new Response(page, { status: 200 }),
    ) as unknown as typeof fetch;
    const list = await fetchPublishedList(["https://ncua.gov/x"], /insurance-report-activity/i, NCUA_LIQUIDATION_SPEC, ["name", "date"], { fetchImpl, backoffMs: 0 }, 1);
    expect(list.candidates).toHaveLength(2);
    expect(vi.mocked(fetchImpl).mock.calls.map((c) => String(c[0]))).toEqual(["https://ncua.gov/x", "https://ncua.gov/a/insurance-report-activity-mar-2026.zip"]);
  });

  it("falls back to an HTML table on the page and reports PDF-only pages", async () => {
    const page = "<table><tr><th>Credit Union</th><th>Date</th></tr><tr><td>Acme FCU</td><td>2025-01-05</td></tr></table>";
    const fetchImpl = vi.fn(async () => new Response(page, { status: 200 })) as unknown as typeof fetch;
    const list = await fetchPublishedList(["https://ncua.gov/x"], /liquidat/i, NCUA_LIQUIDATION_SPEC, ["name", "date"], { fetchImpl, backoffMs: 0 });
    expect(list.table?.rows).toHaveLength(1);
    const pdfOnly = vi.fn(async () => new Response('<a href="liquidations.pdf">Liquidations</a>', { status: 200 })) as unknown as typeof fetch;
    const none = await fetchPublishedList(["https://ncua.gov/x"], /liquidat/i, NCUA_LIQUIDATION_SPEC, ["name", "date"], { fetchImpl: pdfOnly, backoffMs: 0 });
    expect(none.table).toBeNull();
    expect(none.reason).toMatch(/only PDF files linked/);
  });
});

describe("SBA aggregation", () => {
  it("sums per lender, state and year and keeps blank amounts null", () => {
    const agg = new SbaAggregator("7a");
    agg.row(["BankName", "BankFDICNumber", "BankState", "ProjectState", "ApprovalFiscalYear", "GrossApproval", "SBAGuaranteedApproval", "Extra"]);
    agg.row(["Acme Bank", "628", "OH", "OH", "2025", "100000", "75000", "x"]);
    agg.row(["Acme Bank", "628", "OH", "OH", "2025", "50000", "", "x"]);
    agg.row(["Acme Bank", "0", "OH", "KY", "2025", "", "", "x"]);
    agg.row(["", "", "", "OH", "2025", "1", "", ""]);
    const r = agg.result();
    expect(r).toMatchObject({ rowsRead: 4, rowsWithoutLender: 1, rowsWithoutAmount: 1 });
    expect(r.missingFields).toEqual(["BankCity", "BankNCUANumber"]);
    expect(r.unexpectedHeaders).toEqual(["Extra"]);
    const oh = r.groups.find((g) => g.projectState === "OH")!;
    expect(oh).toMatchObject({ fdicCert: "628", loans: 2, loansWithAmount: 2, grossApproval: 150000, sbaGuaranteed: 75000 });
    const ky = r.groups.find((g) => g.projectState === "KY")!;
    expect(ky).toMatchObject({ fdicCert: null, loans: 1, grossApproval: null, sbaGuaranteed: null });
  });
});

describe("SEC", () => {
  it("finds a merger agreement under item 1.01 and fee passages in a 10-K", () => {
    const eightK = "Item 1.01 Entry into a Material Definitive Agreement. On May 1, Acme Bancorp entered into an Agreement and Plan of Merger with Beta Bank. Item 9.01 Exhibits.";
    const scan = scanSecFilingText("8-K", eightK);
    expect(scan).toMatchObject({ items: ["1.01", "9.01"], mergerAgreement: true, mergerCompletion: false });
    expect(scan.passages[0].text).toContain("Agreement and Plan of Merger");
    const words = "the company reported results for the year with several changes in its retail deposit products and pricing across all markets it serves today";
    const tenK = `${words}. Service charges on deposit accounts decreased $4.1 million, mainly from lower overdraft fees after the program change. ${words}.`;
    const fee = scanSecFilingText("10-K", tenK);
    expect(fee.passages).toHaveLength(1);
    expect(fee.passages[0].kind).toBe("fee_income");
  });

  it("keeps annual calendar-frame values of fee concepts only", () => {
    const facts = parseSecFeeFacts({
      facts: {
        "us-gaap": {
          FeesAndCommissionsDepositorAccounts: {
            label: "Fees and Commissions, Depositor Accounts",
            units: { USD: [{ end: "2025-12-31", start: "2025-01-01", val: 9, frame: "CY2025" }, { end: "2025-09-30", val: 2, frame: "CY2025Q3" }] },
          },
          Assets: { label: "Assets", units: { USD: [{ end: "2025-12-31", val: 1, frame: "CY2025Q4I" }] } },
        },
      },
    });
    expect(facts).toEqual([expect.objectContaining({ concept: "FeesAndCommissionsDepositorAccounts", frame: "CY2025", value: 9 })]);
  });
});

describe("rule comments", () => {
  it("reads the commenter from a regulations.gov title", () => {
    expect(commentSubmitter("Comment from Navy Federal Credit Union")).toBe("Navy Federal Credit Union");
    expect(looksLikeInstitution("Navy Federal Credit Union")).toBe(true);
    expect(looksLikeInstitution("Jane Doe")).toBe(false);
  });
});

describe("early warning", () => {
  it("lists H.2 releases newest first and keeps application lines under their heading", () => {
    expect(h2ReleaseDates('<a href="/releases/h2/20261002/">x</a><a href="/releases/h2/20261009/">y</a>')).toEqual(["20261009", "20261002"]);
    expect(h2ReleaseDates('<a href="20261010">Oct 10</a><a href="20261003/default.htm">Oct 3</a><a href="https://www.federalreserve.gov/releases/h2/20200103/default.htm">2020</a>')).toEqual(["20261010", "20261003", "20200103"]);
    expect(h2ReleaseDates('<a href="/releases/h2/current/">current</a><a href="123456789">x</a><a href="99999999">y</a>')).toEqual([]);
    const text = "Bank Holding Companies\nAcme Bancorp, Springfield, Illinois -- to acquire Beta Bank, Peoria, Illinois.\nOther business of the board was conducted today in session.";
    const lines = applicationLines(text, "20261009", "2026-10-09", "https://x", "h2");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ section: "Bank Holding Companies", institutionName: "Acme Bancorp", releaseDate: "2026-10-09" });
  });
});

describe("cleaning pass", () => {
  it("reports duplicates, gaps, impossible dates and negatives without changing rows", () => {
    const rows = [
      { key: "a", institutionId: 1, fields: { state: "OH" }, dates: { d: "2025-01-01" }, amounts: { amount: 5 } },
      { key: "a", institutionId: null, ambiguous: true, fields: { state: null }, dates: { d: "2099-01-01" }, amounts: { amount: -1 } },
    ];
    const report = cleaningReport(rows, new Date("2026-10-17T00:00:00Z"));
    expect(report).toMatchObject({ rows: 2, unmatched: 1, ambiguousNames: 1, duplicateKeys: 1, missingByField: { state: 1 } });
    expect(report.impossibleDates).toEqual([{ key: "a", field: "d", value: "2099-01-01" }]);
    expect(report.amountFlags[0]).toMatchObject({ key: "amount", negatives: 1 });
    expect(rows[1].amounts.amount).toBe(-1);
  });
});
