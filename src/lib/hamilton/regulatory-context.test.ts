import { describe, expect, it } from "vitest";
import { buildRegulatoryContext } from "./regulatory-context";
import { checkNarrativeFigures } from "./figure-check";

describe("buildRegulatoryContext", () => {
  it("lists only the rules that touch the institution's own fees, with its state agency and complaint record", () => {
    const result = buildRegulatoryContext({
      institutionName: "Flora Bank",
      stateCode: "IL",
      charterType: "bank",
      fees: [{ fee_category: "overdraft", institution_amount: 35 }, { fee_category: "wire_transfer", institution_amount: 25 }],
      complaintYears: [
        { year: "2025", total_complaints: 40, fee_related_complaints: 12 },
        { year: "2024", total_complaints: 31, fee_related_complaints: 9 },
      ],
    });
    const names = result.data.rules.map((rule) => rule.name);
    expect(names).toContain("Regulation E overdraft opt-in");
    expect(names).toContain("Regulation DD (Truth in Savings) fee disclosure");
    expect(names).not.toContain("FDIC guidance on re-presented items");
    expect(result.data.state_chartering_agency).toBe("Illinois Department of Financial and Professional Regulation");
    expect(result.exhibit?.title).toBe(
      "3 federal rules bear directly on Flora Bank's fees, and the CFPB recorded 40 complaints against Flora Bank in 2025, 12 about fees or low funds",
    );
    expect(result.exhibit?.rows[0][2]).toBe("Overdraft (OD) $35.00");
    // The $10 billion threshold Hamilton may quote traces to the payload.
    expect(checkNarrativeFigures("The rule covered banks over $10 billion.", result.data).unmatched).toEqual([]);
  });

  it("uses the credit union agency and says plainly when no complaints are matched", () => {
    const result = buildRegulatoryContext({
      institutionName: "Prairie CU",
      stateCode: "KS",
      charterType: "credit_union",
      fees: [{ fee_category: "nsf", institution_amount: 30 }],
      complaintYears: [],
    });
    expect(result.data.state_chartering_agency).toBe("Kansas Department of Credit Unions");
    expect(result.data.cfpb_complaints).toBeNull();
    expect(result.exhibit?.title).toContain("no CFPB complaints are matched to Prairie CU");
  });
});
