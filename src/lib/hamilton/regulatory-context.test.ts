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

  it("passes public enforcement actions only for the lists checked, and says when none cover the institution", () => {
    const base = {
      institutionName: "Flora Bank",
      stateCode: "IL",
      charterType: "bank",
      fees: [{ fee_category: "overdraft", institution_amount: 35 }],
      complaintYears: [],
    };
    const withRecord = buildRegulatoryContext({
      ...base,
      enforcement: {
        agenciesChecked: ["OCC"],
        active: [{ agency: "OCC", party_name: "Flora Bank, N.A.", against_holding_company: false, action_type: "Formal Agreement", subject: null, start_date: "2025-03-01", termination_date: null, penalty_amount: null, document_url: null }],
        terminated: [],
        terminatedCount: 2,
        asOf: "2026-10-07",
      },
    });
    expect(withRecord.data.enforcement_actions).toEqual({
      lists_checked: ["OCC enforcement actions"],
      as_of: "2026-10-07",
      active: [{ agency: "OCC", against: "Flora Bank, N.A.", type: "Formal Agreement", start_date: "2025-03-01", termination_date: null, penalty_amount: null }],
      terminated_count: 2,
      latest_terminated: [],
    });
    expect(withRecord.data.limits).toContain("FDIC and NCUA orders are not loaded");
    expect(withRecord.data.limits).not.toContain("no source of enforcement");
    expect(withRecord.sources.map((s) => s.label)).toContain("Federal enforcement actions");

    const without = buildRegulatoryContext(base);
    expect(without.data.enforcement_actions).toBeNull();
    expect(without.data.limits).toContain("Do not state whether it has enforcement actions");
  });
});
