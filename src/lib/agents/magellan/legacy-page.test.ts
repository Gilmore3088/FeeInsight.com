import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { openingRejection, validateFeeCandidate } from "./find-validate";
import { legacyAddress, legacyLinkWords, legacyOpening } from "./legacy-page";
import { classifyCompanionLink } from "./second-document";

describe("Magellan's legacy page check (#2070)", () => {
  it("reads link words and addresses that name a legacy or discontinued accounts page", () => {
    for (const words of ["Legacy Accounts Fee Schedule", "discontinued products", "Grandfathered Checking Accounts", "Retired Account Types", "Accounts No Longer Offered", "previously offered products"]) {
      expect([words, legacyLinkWords(words)]).toEqual([words, true]);
    }
    expect(legacyAddress("https://bank.example/docs/legacy-accounts-fee-schedule.pdf")).toBe(true);
    expect(legacyAddress("https://bank.example/disclosures/accounts_no_longer_offered.pdf")).toBe(true);
    expect(legacyAddress("https://bank.example/docs/Discontinued%20Products.pdf")).toBe(true);
  });

  it("never reads a bank, an IRA or a military account as a legacy page", () => {
    for (const words of ["Legacy Bank fee schedule", "Retirement Accounts", "Retired Military Accounts", "fee schedule", "Checking accounts no longer require a minimum balance"]) {
      expect([words, legacyLinkWords(words)]).toEqual([words, false]);
    }
    expect(legacyAddress("https://legacybank.example/fee-schedule.pdf")).toBe(false);
    expect(legacyAddress("https://bank.example/personal/retirement-accounts")).toBe(false);
  });

  it("reads \"legacy\" and \"retired\" as old accounts only in the plural or beside \"no longer offered\" (#2070 review)", () => {
    // A current product named Legacy (a 50+ account) and a bank named Legacy are kept.
    for (const words of ["Legacy Checking Account", "Legacy Savings Account fee schedule", "Legacy Account Agreement and Fee Schedule", "Retired Product"]) {
      expect([words, legacyLinkWords(words)]).toEqual([words, false]);
    }
    expect(legacyAddress("https://bank.example/personal/legacy-checking-account")).toBe(false);
    expect(legacyAddress("https://legacybank.example/docs/legacy-account-agreement-and-fee-schedule.pdf")).toBe(false);
    expect(legacyOpening("Legacy Checking Account\nMonthly Fee | $5.00")).toBe(false);
    // The plural, or a singular one marked no longer offered, is still a legacy page.
    expect(legacyAddress("https://www.blackhawkbank.com/-legacy-checking-accounts/")).toBe(true);
    expect(legacyLinkWords("Legacy Checking Account - no longer offered")).toBe(true);
    expect(legacyLinkWords("Discontinued Checking Account")).toBe(true);
    expect(legacyOpening("Legacy Checking Accounts\nMonthly Fee | $5.00")).toBe(true);
  });

  it("reads the page's own title, not a legacy section further down", () => {
    expect(legacyOpening("Accounts No Longer Offered\nGold Checking\nMonthly Fee | $15.00")).toBe(true);
    expect(legacyOpening("Fee Schedule - Legacy Accounts\nGold Checking | $15.00")).toBe(true);
    expect(legacyOpening("First Bank\nDiscontinued Checking Products\nMonthly Fee $10.00")).toBe(true);
    expect(legacyOpening("Fee Schedule\nEffective January 1, 2026\nLegacy Accounts\nGold Checking | $15.00")).toBe(false);
    expect(legacyOpening("Legacy Accounts are served by our team. Call us for details.\nFees")).toBe(false);
    expect(legacyOpening("Retired Military Accounts\nStop Payment $30.00")).toBe(false);
    expect(legacyOpening(null)).toBe(false);
  });

  it("refuses a legacy page before it is stored: by its opening, its address and its companion link", async () => {
    expect(openingRejection("Accounts No Longer Offered\nMonthly Fee | $15.00", 200, 0.9)?.verdict).toBe("legacy_page");
    expect(openingRejection("Fee Schedule\nMonthly Fee | $15.00", 200, 0.9)).toBeNull();
    const fetchImpl = vi.fn();
    const validation = await validateFeeCandidate({ url: "https://bank.example/docs/legacy-accounts-fee-schedule.pdf", score: 0.95, reasons: [] }, fetchImpl as never);
    expect(validation).toMatchObject({ ok: false, verdict: "legacy_page" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const site = new URL("https://bank.example");
    expect(classifyCompanionLink({ url: "https://bank.example/docs/legacy-accounts-fee-schedule.pdf", label: "Legacy Accounts Fee Schedule" } as never, site)).toBeNull();
    expect(classifyCompanionLink({ url: "https://bank.example/docs/fee-schedule.pdf", label: "Fee Schedule" } as never, site)?.kind).toBe("fee_document");
  });
});
