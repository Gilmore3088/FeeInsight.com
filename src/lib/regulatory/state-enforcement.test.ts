import { describe, expect, it } from "vitest";
import {
  actionTypeOf,
  dateIn,
  enforcementAgencyLabel,
  enforcementAgencyList,
  isBankParty,
  mapColumns,
  parseOrderLinks,
  parseOrderTables,
  stateOrderKey,
} from "./state-enforcement";

describe("state enforcement readers", () => {
  it("reads a table by its headers, keeps bank rows only, and resolves the order link", () => {
    const html = `<table>
      <tr><th>Institution</th><th>City</th><th>Action</th><th>Effective Date</th><th>Termination Date</th></tr>
      <tr><td>Union County Savings Bank</td><td>Elizabeth</td><td><a href="/dobi/orders/ucsb.pdf">Consent Order</a></td><td>02/17/2026</td><td></td></tr>
      <tr><td>Acme Mortgage LLC</td><td>Newark</td><td>Consent Order</td><td>01/05/2026</td><td></td></tr>
      <tr><td>GSL Savings Bank</td><td>Guttenberg</td><td>Consent Order</td><td>August 18, 2025</td><td>March 1, 2026</td></tr>
    </table>`;
    expect(parseOrderTables(html, "https://www.nj.gov/dobi/division_banking/bankdivenforce.html")).toEqual([
      { party_name: "Union County Savings Bank", party_city: "Elizabeth", action_type: "Consent order", start_date: "2026-02-17", termination_date: null, document_url: "https://www.nj.gov/dobi/orders/ucsb.pdf" },
      { party_name: "GSL Savings Bank", party_city: "Guttenberg", action_type: "Consent order", start_date: "2025-08-18", termination_date: "2026-03-01", document_url: null },
    ]);
  });

  it("skips layout tables with no party column", () => {
    expect(parseOrderTables("<table><tr><td>Home</td><td>Contact</td></tr><tr><td>First Bank</td><td>x</td></tr></table>", "https://x.gov/")).toEqual([]);
  });

  it("reads a list of order links, with the date from the text or the URL", () => {
    const html = `<ul>
      <li><a href="/system/files/documents/2024/02/ea20240223_piermont_bank.pdf">Piermont Bank - Consent Order</a></li>
      <li><a href="/reports/annual.pdf">Annual report</a></li>
      <li><a href="/x/shinhan.pdf">Consent Order, Shinhan Bank America (September 29, 2023)</a></li>
      <li><a href="/x/lender.pdf">Best Payday Loans - Consent Order</a></li>
    </ul>`;
    expect(parseOrderLinks(html, "https://www.dfs.ny.gov/industry_guidance/enforcement_actions")).toEqual([
      { party_name: "Piermont Bank", party_city: null, action_type: "Consent order", start_date: "2024-02-23", termination_date: null, document_url: "https://www.dfs.ny.gov/system/files/documents/2024/02/ea20240223_piermont_bank.pdf" },
      { party_name: "Shinhan Bank America", party_city: null, action_type: "Consent order", start_date: "2023-09-29", termination_date: null, document_url: "https://www.dfs.ny.gov/x/shinhan.pdf" },
    ]);
  });

  it("tells banks from other licensees and finds the order type", () => {
    expect(isBankParty("Lamont Bank of St. John")).toBe(true);
    expect(isBankParty("First Bancorp")).toBe(true);
    expect(isBankParty("Quick Cash Money Transmitter")).toBe(false);
    expect(isBankParty("Bank Street Mortgage Co")).toBe(false);
    expect(actionTypeOf("Order to Cease and Desist")).toBe("Order to cease");
    expect(actionTypeOf("Written Agreement")).toBe("Written agreement");
    expect(dateIn("order_2025-01-10.pdf")).toBe("2025-01-10");
    expect(dateIn("phone 2125551234")).toBeNull();
  });

  it("maps headers without letting a termination column take the start date", () => {
    expect(mapColumns(["Bank Name", "Date Terminated", "Date Issued", "Type of Action"])).toEqual({ party: 0, end: 1, date: 2, type: 3 });
  });

  it("keys an order by state, party, date and type, and names state agencies", () => {
    const order = { party_name: "Lamont Bank of St. John", party_city: null, action_type: "Consent order", start_date: "2025-01-10", termination_date: null, document_url: null };
    expect(stateOrderKey("WA", order)).toBe("STATE_WA|lamont bank of st john|2025-01-10|consent order");
    expect(enforcementAgencyLabel("STATE_NJ")).toMatch(/New Jersey/);
    expect(enforcementAgencyLabel("FRB")).toBe("Federal Reserve");
    expect(enforcementAgencyList(["OCC", "FRB"])).toBe("OCC and Federal Reserve");
    expect(enforcementAgencyList(["OCC", "FRB", "STATE_NJ", "STATE_NY"])).toBe("OCC, Federal Reserve and 2 state banking departments");
  });
});
