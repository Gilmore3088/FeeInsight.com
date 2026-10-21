import { describe, expect, it } from "vitest";
import { editionStarts, notYetEffective } from "./schedule-edition";

const TODAY = "2026-10-20";

// Materion FCU's fee page (docs 16785, 29942) on prod, Oct 20, 2026: a banner links to the next schedule.
const MATERION_PAGE =
  "Click Here to Review our updated Fee Schedule which will be effective 11/1/2026.\n\nFee Schedule\n\nE-Services\n\neStatements";

describe("a schedule's own edition date", () => {
  it("takes the heading's own date, not a later change the schedule announces", () => {
    const text = "Fee Schedule\nEffective March 1, 2024. Changes effective December 1, 2026 are marked.\nStop Payment | $30.00";
    expect(editionStarts(text)).toBe("2024-03-01");
    expect(notYetEffective(text, TODAY)).toBeNull();
  });

  it("does not hold a current page for a banner that links to the next schedule", () => {
    expect(editionStarts(MATERION_PAGE)).toBeNull();
    expect(notYetEffective(MATERION_PAGE, TODAY)).toBeNull();
    expect(notYetEffective("See our new fee schedule, effective December 1, 2026.\nFees", TODAY)).toBeNull();
  });

  it("still holds a schedule whose own heading is a later date", () => {
    expect(notYetEffective("Fee Schedule\nEffective 1 December 2026\nStop Payment | $30.00", TODAY)).toBe("2026-12-01");
    expect(notYetEffective("Fee Schedule\nEffective Date: 2026-12-01\nStop Payment | $30.00", TODAY)).toBe("2026-12-01");
    expect(notYetEffective("Fee Schedule\nEffective December 2026\nStop Payment | $30.00", TODAY)).toBe("2026-12-01");
    expect(notYetEffective("Fee Schedule\nEffective Dec. 1, 2026\nStop Payment | $30.00", TODAY)).toBe("2026-12-01");
    expect(notYetEffective("This fee schedule will be effective December 1, 2026.\nFees", TODAY)).toBe("2026-12-01");
  });

  it("reads the edition, not the one it supersedes", () => {
    const text = "Fee Schedule\nEffective Dec 1 2026. Supersedes the schedule effective March 2024.\nStop Payment | $30.00";
    expect(editionStarts(text)).toBe("2026-12-01");
    expect(notYetEffective(text, TODAY)).toBe("2026-12-01");
    const reversed = "Fee Schedule\nSupersedes all schedules effective prior to March 1, 2024.\nEffective December 1, 2026\nFees";
    expect(editionStarts(reversed)).toBe("2026-12-01");
  });

  it("treats 'effective immediately' and past dates as in effect", () => {
    expect(notYetEffective("Fee Schedule\nEffective immediately. Changes effective December 1, 2026 are marked.\nFees", TODAY)).toBeNull();
    expect(notYetEffective("Fee Schedule\nEffective March 1, 2024\nFees", TODAY)).toBeNull();
    expect(notYetEffective("Fee Schedule\nEffective 1 March 2024\nFees", TODAY)).toBeNull();
    expect(notYetEffective("Fee Schedule\nEffective 2024-03-01\nFees", TODAY)).toBeNull();
    expect(notYetEffective("Fee Schedule\nEffective October 20, 2026\nFees", TODAY)).toBeNull();
  });

  it("does not take a branch-hours notice in a page banner for the schedule's edition", () => {
    // Land of Lincoln CU's fee pages (docs 34818, 34819) on prod, Oct 20, 2026.
    const banner =
      "Skip to Live Chat\n\nNOTICE: Effective November 14th, 2026, the LLCU Branch located at 2890 N. Oakland Ave in " +
      "Decatur will have reduced drive-up hours on Saturdays of 8:00a.m. - 12:00p.m. To learn more, click here.\n\nFees";
    expect(notYetEffective(banner, TODAY)).toBeNull();
  });

  it("reads a change notice whose heading is its change date as not yet in effect", () => {
    expect(notYetEffective("Notice of Fee Changes\nChanges effective December 1, 2026\nStop Payment | $35.00", TODAY)).toBe("2026-12-01");
  });
});
