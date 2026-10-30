import { describe, expect, it } from "vitest";
import { complaintCount, complaintYearLabel, complaintYearPhrase, isPartialComplaintYear } from "./complaint-year";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("complaint year labels (A5)", () => {
  it("marks only the calendar year still being counted", () => {
    expect(isPartialComplaintYear("2026", NOW)).toBe(true);
    expect(isPartialComplaintYear(2026, NOW)).toBe(true);
    expect(isPartialComplaintYear("2025", NOW)).toBe(false);
  });
  it("labels and phrases a part year so it is never read as a full year", () => {
    expect(complaintYearLabel("2026", NOW)).toBe("2026 to date");
    expect(complaintYearLabel("2025", NOW)).toBe("2025");
    expect(complaintYearPhrase("2026", NOW)).toBe("so far in 2026");
    expect(complaintYearPhrase("2025", NOW)).toBe("in 2025");
  });
  it("counts complaints with a singular noun for one", () => {
    expect(complaintCount(1)).toBe("1 complaint");
    expect(complaintCount(0)).toBe("0 complaints");
    expect(complaintCount(2345)).toBe("2,345 complaints");
  });
  it("puts a qualifier between the number and the noun, still singular for one", () => {
    expect(complaintCount(1, "CFPB fee")).toBe("1 CFPB fee complaint");
    expect(complaintCount(6, "CFPB fee")).toBe("6 CFPB fee complaints");
    expect(complaintCount(1, "CFPB")).toBe("1 CFPB complaint");
  });
});
