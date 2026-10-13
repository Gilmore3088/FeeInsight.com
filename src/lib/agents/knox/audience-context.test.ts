import { describe, expect, it } from "vitest";
import { hasBusinessFees, suggestAudience } from "./audience-context";

const suggest = (documentUrl: string | null, text: string, feeName: string, amount: number | null = 30) =>
  suggestAudience({ documentUrl, text, feeName, amount });

describe("Knox audience suggestion from context (#1059)", () => {
  it("lets the fee's own name decide first", () => {
    expect(suggest(null, "Fees\nReturned Deposit Items (Commercial Accounts Only) $10", "Returned Deposit Items (Commercial Accounts Only)", 10))
      .toMatchObject({ audience: "business", source: "fee_name" });
  });

  it("reads the schedule's address", () => {
    expect(suggest("https://www.tabbank.com/uploads/TAB-Business-Checking-Fee-Schedule.pdf", "Stop Payment $30", "Stop Payment"))
      .toMatchObject({ audience: "business", source: "document_url" });
    expect(suggest("https://bank.example/personal/fee-schedule", "Stop Payment $30", "Stop Payment"))
      .toMatchObject({ audience: "consumer", source: "document_url" });
    // An address that names both says nothing.
    expect(suggest("https://bank.example/personal-and-business-fees", "Business Accounts\nStop Payment $30", "Stop Payment")?.source)
      .not.toBe("document_url");
  });

  it("reads a section heading above the fee, and ignores menus, bank names and business days", () => {
    const text = ["Business Online Sign In", "Commercial Bank of Ozark", "Personal Accounts", "Overdraft Fee $30", "Business Accounts", "Overdraft Fee $35"].join("\n");
    expect(suggest(null, text, "Overdraft Fee", 30)).toMatchObject({ audience: "consumer", source: "section_heading", evidence: "Personal Accounts" });
    expect(suggest(null, text, "Overdraft Fee", 35)).toMatchObject({ audience: "business", source: "section_heading", evidence: "Business Accounts" });
    // A line that only says "business days" is no heading.
    expect(suggest(null, "Funds are available in 2 business days.\nWire Transfer $25", "Wire Transfer", 25)?.source).not.toBe("section_heading");
  });

  it("counts a schedule with no business fees as consumer, even when its menu says Business", () => {
    // Stored page text keeps a site's menu as links.
    const site = ["* [Business Banking](https://bank.example/business)", "* [About Us](https://bank.example/about)", "Fee Schedule", "Stop Payment $30", "Overdraft $32"].join("\n");
    expect(hasBusinessFees(site.split("\n"))).toBe(false);
    expect(suggest(null, site, "Stop Payment")).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    // A menu word whose next heading names another audience owns no prices.
    expect(hasBusinessFees(["Business Banking", "Personal Banking", "Stop Payment $30"])).toBe(false);
    // A business heading with prices under it is business fees, so no default.
    const mixed = ["Fees", "Stop Payment $30", "Business Services", "Lockbox $50"].join("\n");
    expect(hasBusinessFees(mixed.split("\n"))).toBe(true);
    expect(suggest(null, mixed, "Stop Payment")).toBeNull();
  });
});
