// @vitest-environment node
import { describe, expect, it } from "vitest";
import { discontinuedRow } from "@/lib/custom-report/discontinued-rows";
import { suggestAudience } from "@/lib/agents/knox/audience-context";
import { SECTION_PATH_LIVE, sectionMap, sectionPathLive, twoColumnRow, withSectionPath } from "./section-path";
import { AUDIENCE_CASES, RETIRED_CASES, single, spaced } from "./section-path-near-miss.fixtures";

const pathOf = (text: string, line: string) => {
  const lines = text.split("\n");
  return sectionMap(text).pathAt(lines.findIndex((l) => l.trim() === line)).map((h) => `${h.rank}:${h.text}`);
};

describe("section path: structure", () => {
  it("nests a lower rank under a higher one and closes siblings of the same rank", () => {
    const text = spaced(
      "Fee Schedule", "Checking Accounts (Share Drafts)", "Free Checking (CK02) | Free", "Grandfathered Checking Account Types:",
      "Regular Checking (CK03) | $5.00 per month", "Savings Accounts (Share Accounts)", "Closed Account Fee | $10.00",
    );
    expect(pathOf(text, "Regular Checking (CK03) | $5.00 per month")).toEqual(["3:Fee Schedule", "2:Checking Accounts (Share Drafts)", "1:Grandfathered Checking Account Types:"]);
    expect(pathOf(text, "Closed Account Fee | $10.00")).toEqual(["3:Fee Schedule", "2:Savings Accounts (Share Accounts)"]);
  });

  it("ranks a heading over a date line or a scope sentence with the schedule's title", () => {
    const text = single("Business Account(s)", "Effective April 1, 2026", "Credit Union Membership", "New Membership Fee | $15.00");
    expect(pathOf(text, "New Membership Fee | $15.00")).toEqual(["3:Business Account(s)", "2:Credit Union Membership"]);
    const scoped = single("Business Customers", "The following fees apply to business customers only.", "ACCOUNT SERVICING", "NSF Return Item Fee | $35.00");
    const path = sectionMap(scoped).pathAt(3);
    expect(path.map((h) => h.rank)).toEqual([3, 2]);
    expect(path[0].scope).toBe("The following fees apply to business customers only.");
  });

  it("reads a menu of three or more headings as one heading, its last", () => {
    const text = spaced("Personal Banking", "Business Banking", "Loans", "Schedule of Fees", "Account Research | $35.00 per hour");
    expect(pathOf(text, "Account Research | $35.00 per hour")).toEqual(["3:Schedule of Fees"]);
    expect(sectionMap(text).kinds.filter((kind) => kind === "menu")).toHaveLength(3);
  });

  it("reads a repeated accordion title once and a parenthetical note as part of its heading", () => {
    const text = spaced("Other Services Fees", "(applicable to all accounts)", "Service | Fee", "Fax | $1.00", "Business Services", "Business Services", "Positive Pay | $30.00");
    expect(pathOf(text, "Fax | $1.00")).toEqual(["2:Other Services Fees (applicable to all accounts)"]);
    expect(pathOf(text, "Positive Pay | $30.00")).toEqual(["2:Business Services"]);
  });

  it("tells a header row, a table's title row and a column line apart", () => {
    const map = sectionMap(single("Service | Fee", "Business Checking | Fee Amount | Alert Me", "General Business Service Fees | Business Checking Account Fees", "Fully digital account opening | Yes | Yes"));
    expect(map.kinds).toEqual(["header", "titled_header", "columns", "row"]);
  });

  it("reads a name over a price-first line, and a name priced free, as rows", () => {
    const map = sectionMap(single("RDC Monthly Fee", "$40.00 (if average monthly balance below $25,000.00)", "Business eDeposit No fee", "Free Checking (CK02) | Free"));
    expect(map.kinds).toEqual(["row", "row", "row", "row"]);
  });

  it("ends every section at a run of paragraphs", () => {
    const text = single("Business Accounts", "one line of terms that runs on", "and another line of terms", "and a third line of the terms", "and a fourth line of the terms", "Stop Payment | $30.00");
    expect(pathOf(text, "Stop Payment | $30.00")).toEqual([]);
  });

  it("knows a two-column row", () => {
    expect(twoColumnRow("Garnishments and Levies | $100.00 | Domestic Outgoing (branch assisted) | $35.00")).toBe(true);
    expect(twoColumnRow("Check Cashing Fee per item ..... $10.00 | Share Draft ..... $5.00 monthly")).toBe(true);
    expect(twoColumnRow("Stop Payment | $30.00")).toBe(false);
    expect(twoColumnRow("Domestic Outbound Wires (Online/Manual) | $35/$60 | $35/$60")).toBe(false);
  });
});

describe("section path: the switch", () => {
  it("is off by default and every read follows it", () => {
    expect(SECTION_PATH_LIVE).toBe(false);
    expect(sectionPathLive()).toBe(false);
    expect(withSectionPath(true, () => sectionPathLive())).toBe(true);
    expect(sectionPathLive()).toBe(false);
  });

  it("off, the audience reads are main's; on or off, the retired reads are main's", () => {
    for (const c of AUDIENCE_CASES) {
      const input = { documentUrl: null, text: c.text, feeName: c.fee.name, amount: c.fee.amount };
      expect(suggestAudience(input), c.name).toEqual(suggestAudience({ ...input, sectionPath: false }));
      expect(suggestAudience(input)?.source, c.name).not.toBe("section_path");
    }
    for (const c of RETIRED_CASES) {
      expect(withSectionPath(true, () => discontinuedRow(c.text, c.fee.name, c.fee.amount)), c.name).toEqual(discontinuedRow(c.text, c.fee.name, c.fee.amount));
    }
  });
});
