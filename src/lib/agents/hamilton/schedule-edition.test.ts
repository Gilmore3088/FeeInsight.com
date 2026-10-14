import { describe, expect, it } from "vitest";
import { effectiveDate, mayBeSameSchedule, sameSchedule, scheduleAudience } from "./schedule-edition";

// URL and text shapes from the 13 movements held on prod, Oct 7-9, 2026 (short excerpts).
const UMASS_OLD = "Levy Compliance | $30.00\nWire Transfer – Outgoing Domestic | $20.00\nFees Effective September 1, 2023";
const UMASS_NEW = "Levy Compliance | $40.00\nWire Transfer – Outgoing Domestic | $25.00\nService Prices Effective January 1, 2026";

describe("schedule edition", () => {
  it("reads the effective date a schedule states", () => {
    expect(effectiveDate("Effective Date: April 10, 2026\nThe fees appearing")).toBe("2026-04-10");
    expect(effectiveDate(UMASS_OLD)).toBe("2023-09-01");
    expect(effectiveDate("Non-Member Notary | $10.00 ea.\nEffective as of 8/1/2026")).toBe("2026-08-01");
    expect(effectiveDate("The fees highlighted below have been adjusted and will be effective on August 1, 2026.")).toBe("2026-08-01");
    expect(effectiveDate("Stop Payment | $30.00")).toBeNull();
  });

  it("reads the audience a schedule's URL names", () => {
    expect(scheduleAudience("https://www.hoosierhills.com/files/Schedule-of-Fees/HOOS030BW-Commercial.pdf")).toBe("business");
    expect(scheduleAudience("https://www.mcclainbank.com/personal/checking-and-money-market")).toBe("consumer");
    expect(scheduleAudience("https://www.ffl.bank/wp-content/uploads/2026/02/FFL-24-101-RET-Fee-Schedule-Flyer.pdf")).toBe("consumer");
    expect(scheduleAudience("https://www.tyndall.org/fee-schedule?print=1")).toBeNull();
  });

  it("takes a moved page as the same schedule only for a newer dated edition", () => {
    // UMassFive moved its business fee page and published a 2026 edition: a real change.
    expect(
      sameSchedule({
        oldUrl: "https://umassfive.coop/business-fees",
        newUrl: "https://www.umassfive.coop/business/helpful-links/business-banking-fees-and-service-prices",
        oldText: UMASS_OLD,
        newText: UMASS_NEW,
      }),
    ).toBe("new_edition");
    // Tyndall: two pages that both state April 10, 2026 are two schedules.
    expect(
      sameSchedule({
        oldUrl: "https://www.tyndall.org/learn/documents/fee-schedule",
        newUrl: "https://www.tyndall.org/fee-schedule?print=1",
        oldText: "Inactive Account fee (savings): | $2.00\nEffective Date: April 10, 2026",
        newText: "Inactive Account fee (savings): | $5.00\nEffective Date: April 10, 2026",
      }),
    ).toBeNull();
    // A business schedule against the consumer one, whatever the dates.
    expect(
      sameSchedule({
        oldUrl: "https://directionscu.org/wp-content/uploads/Rates/Business-Fee-Schedule.pdf",
        newUrl: "https://directionscu.org/wp-content/uploads/Rates/Consumer-Fee-Schedule.pdf",
        oldText: "Effective January 1, 2024",
        newText: "Effective January 1, 2026",
      }),
    ).toBeNull();
    // Undated pages stay two lines.
    expect(sameSchedule({ oldUrl: "https://a.com/fees", newUrl: "https://a.com/other-fees", oldText: "x", newText: "y" })).toBeNull();
  });

  it("treats a dated or versioned copy of one page as the same page", () => {
    expect(
      sameSchedule({ oldUrl: "https://a.com/Fee-Schedule-Oct-2024.pdf", newUrl: "https://a.com/Fee-Schedule-08.15.2026-final.pdf", oldText: null, newText: null }),
    ).toBe("same_page");
  });

  it("leaves a same-audience page move for the pairing pass when a change is recorded", () => {
    expect(mayBeSameSchedule("https://a.com/fee-schedule", "https://a.com/fee-schedule-2026.pdf")).toBe(true);
    expect(mayBeSameSchedule("https://a.com/business-fees", "https://a.com/business/fees-and-prices")).toBeNull();
    expect(mayBeSameSchedule("https://a.com/business-fees", "https://a.com/personal-fees")).toBe(false);
    expect(mayBeSameSchedule(null, "https://a.com/fees")).toBe(false);
  });
});
