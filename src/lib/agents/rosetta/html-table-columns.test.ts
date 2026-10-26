import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reproducibleFees } from "@/lib/agents/hamilton/rules-recheck";

import { extractHtmlDomText } from "./html-dom";
import { rowsInText } from "./table-rows";

/** #1912: an empty table cell keeps its column. */

const CAPITAL_CITY = readFileSync(join(__dirname, "test-fixtures", "capital-city-savings-compare.html"), "utf8");
const FEES_ROW_V1 = "Fees/Penalties | Early withdrawal penalty | $50 fee to close prior to maturity";
const FEES_ROW_V2 = "Fees/Penalties | Early withdrawal penalty (CD) | $50 fee to close prior to maturity (ira)";

function lines(html: string): string[] {
  return extractHtmlDomText(html)
    .text.split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalized(html: string): string {
  return lines(html).join("\n");
}

describe("Rosetta html_dom table columns (#1912)", () => {
  it("writes Capital City's IRA closing fee under its own column, not the CD's", () => {
    expect(lines(CAPITAL_CITY)).toEqual([
      "Minor Savings+ | money market | CD | ira | premium money market",
      "Opening deposit requirement | $50 | $4,000 | $1,000 | Varies by type | $25,000",
      "Monthly service charge | FREE | No monthly service charge if meeting minimum daily balance requirement; otherwise, $15 | FREE | FREE | No monthly service charge if meeting minimum daily balance requirement; otherwise, $15",
      FEES_ROW_V2,
    ]);
    const { rows } = extractHtmlDomText(CAPITAL_CITY);
    expect(rows[0]).toMatchObject({ header: true, columns: ["", "Minor Savings+", "money market", "CD", "ira", "premium money market"] });
    expect(rows[0].line).toBeUndefined();
    expect(rows[3]).toEqual({
      table: 0,
      page: null,
      cells: ["Fees/Penalties", "Early withdrawal penalty", "$50 fee to close prior to maturity"],
      columns: ["Fees/Penalties", "", "", "Early withdrawal penalty", "$50 fee to close prior to maturity", ""],
      line: FEES_ROW_V2,
      header: false,
      origin: "html_table",
    });
    // Every row, the rewritten one included, is still a line of the stored text.
    expect(rowsInText(rows, normalized(CAPITAL_CITY))).toHaveLength(4);
  });

  it("Knox's free reading does not file the IRA's $50 as a CD early closure", () => {
    const page = (row: string) => `Compare Accounts\n${normalized(CAPITAL_CITY).replace(FEES_ROW_V2, row)}`;
    const fees = reproducibleFees(page(FEES_ROW_V2));
    expect(fees.has("early_closure:5000")).toBe(false);
    // The new line reads no fee the old line did not.
    const before = reproducibleFees(page(FEES_ROW_V1));
    expect([...fees].filter((fee) => !before.has(fee))).toEqual([]);
  });

  it("keeps a full row, trailing empty cells and a row with no header byte-identical", () => {
    const html = `
      <table>
        <thead><tr><th>Service</th><th>Basic</th><th>Plus</th></tr></thead>
        <tr><td>Overdraft fee</td><td>$35.00</td><td>$30.00</td></tr>
        <tr><td>Stop payment</td><td>$30.00</td><td></td></tr>
      </table>
      <table>
        <tr><td>Wire, outgoing</td><td></td><td>$25.00</td></tr>
        <tr><td>Wire, incoming</td><td>$15.00</td><td>$10.00</td></tr>
      </table>`;
    expect(lines(html)).toEqual([
      "Service | Basic | Plus",
      "Overdraft fee | $35.00 | $30.00",
      "Stop payment | $30.00",
      "Wire, outgoing | $25.00",
      "Wire, incoming | $15.00 | $10.00",
    ]);
    const rows = extractHtmlDomText(html).rows;
    expect(rows.map((row) => row.columns)).toEqual([
      ["Service", "Basic", "Plus"],
      ["Overdraft fee", "$35.00", "$30.00"],
      ["Stop payment", "$30.00", ""],
      ["Wire, outgoing", "", "$25.00"],
      ["Wire, incoming", "$15.00", "$10.00"],
    ]);
    expect(rows.every((row) => row.line === undefined)).toBe(true);
  });

  it("expands colspan and holds a rowspan's column without rewriting the text", () => {
    const html = `
      <table>
        <thead><tr><th>Service</th><th>Type</th><th>Basic</th><th>Plus</th></tr></thead>
        <tr><td rowspan="2">Wire</td><td>Domestic</td><td>$25.00</td><td>$20.00</td></tr>
        <tr><td>International</td><td>$45.00</td><td>$40.00</td></tr>
        <tr><td>Paper statement</td><td colspan="3">FREE</td></tr>
      </table>`;
    expect(lines(html)).toEqual([
      "Service | Type | Basic | Plus",
      "Wire | Domestic | $25.00 | $20.00",
      "International | $45.00 | $40.00",
      "Paper statement | FREE",
    ]);
    expect(extractHtmlDomText(html).rows.map((row) => row.columns)).toEqual([
      ["Service", "Type", "Basic", "Plus"],
      ["Wire", "Domestic", "$25.00", "$20.00"],
      ["", "International", "$45.00", "$40.00"],
      ["Paper statement", "FREE", "", ""],
    ]);
  });

  it("names a displaced cell only by a short header without a figure", () => {
    const html = `
      <table>
        <thead><tr><th>Service</th><th>Basic</th><th>Interest Checking (balance $1,500)</th><th>Premier (Plus)</th></tr></thead>
        <tr><td>Overdraft fee</td><td></td><td>$30.00</td><td>$25.00</td></tr>
      </table>`;
    expect(lines(html)).toEqual([
      "Service | Basic | Interest Checking (balance $1,500) | Premier (Plus)",
      "Overdraft fee | $30.00 | $25.00 (Premier Plus)",
    ]);
  });

  it("writes the column name after the value, where Knox's free reading still reads the same fee", () => {
    const html = `
      <table>
        <thead><tr><th>Service</th><th>Basic Checking</th><th>Premier Checking</th></tr></thead>
        <tr><td>Overdraft fee</td><td>$35.00</td><td>$30.00</td></tr>
        <tr><td>Stop payment</td><td></td><td>$25.00</td></tr>
        <tr><td>Paper statement</td><td></td><td>$3.00 per month</td></tr>
        <tr><td>Monthly maintenance fee</td><td></td><td>$10.00</td></tr>
      </table>`;
    expect(lines(html).slice(2)).toEqual([
      "Stop payment | $25.00 (Premier Checking)",
      "Paper statement | $3.00 per month (Premier Checking)",
      "Monthly maintenance fee | $10.00 (Premier Checking)",
    ]);
    // "Premier Checking: $25.00" lost three of these four fees from the free reading.
    const v1 = "Service | Basic Checking | Premier Checking\nOverdraft fee | $35.00 | $30.00\nStop payment | $25.00\nPaper statement | $3.00 per month\nMonthly maintenance fee | $10.00";
    expect(reproducibleFees(normalized(html))).toEqual(reproducibleFees(v1));
    expect(reproducibleFees(v1).size).toBe(4);
  });
});
