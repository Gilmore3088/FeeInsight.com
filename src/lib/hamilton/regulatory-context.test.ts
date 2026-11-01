import { describe, expect, it } from "vitest";
import { buildRegulatoryContext, REGULATORY_REPORT_RULES, REGULATORY_RULES, ruleStatusLabel, withdrawnLine } from "./regulatory-context";
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
    expect(names).not.toContain("FDIC guidance on re-presented NSF items");
    expect(result.data.state_chartering_agency).toBe("Illinois Department of Financial and Professional Regulation");
    expect(result.exhibit?.title).toBe(
      "1 federal rule bears directly on Flora Bank's fees, and the CFPB recorded 40 complaints against Flora Bank in 2025, 12 about fees or low funds",
    );
    expect(result.exhibit?.columns).toEqual(["Rule", "Citation", "Status", "Your fees it touches", "What it says"]);
    expect(result.exhibit?.rows[0][2]).toBe("Binding law");
    expect(result.exhibit?.rows[0][3]).toBe("Overdraft (OD) $35.00");
    // The $10 billion threshold Hamilton may quote traces to the payload.
    expect(checkNarrativeFigures("The rule covered banks over $10 billion.", result.data).unmatched).toEqual([]);
  });

  it("says the latest complaint year is still being counted when it is the current year (A5)", () => {
    const result = buildRegulatoryContext({
      institutionName: "Flora Bank",
      stateCode: "IL",
      charterType: "bank",
      fees: [{ fee_category: "overdraft", institution_amount: 35 }],
      complaintYears: [
        { year: "2026", total_complaints: 28, fee_related_complaints: 7 },
        { year: "2025", total_complaints: 40, fee_related_complaints: 12 },
      ],
      now: new Date("2026-10-27T00:00:00Z"),
    });
    expect(result.data.cfpb_complaints).toMatchObject({ year: "2026", year_to_date: true, prior_year: "2025" });
    expect(result.exhibit?.title).toContain("the CFPB recorded 28 complaints against Flora Bank so far in 2026, 7 about fees or low funds");
    expect(result.exhibit?.note).toBe("CFPB: 28 complaints in 2026 to date against 40 complaints in 2025.");
    const lastYear = buildRegulatoryContext({
      institutionName: "Flora Bank",
      stateCode: "IL",
      charterType: "bank",
      fees: [{ fee_category: "overdraft", institution_amount: 35 }],
      complaintYears: [
        { year: "2025", total_complaints: 40, fee_related_complaints: 12 },
        { year: "2024", total_complaints: 31, fee_related_complaints: 9 },
      ],
      now: new Date("2026-10-27T00:00:00Z"),
    });
    expect(lastYear.data.cfpb_complaints?.year_to_date).toBe(false);
    expect(lastYear.exhibit?.note).toBe("CFPB: 40 complaints in 2025 against 31 complaints in 2024.");
  });

  it("says one complaint, not \"1 complaints\", in the title and the note", () => {
    const result = buildRegulatoryContext({
      institutionName: "Flora Bank",
      stateCode: "IL",
      charterType: "bank",
      fees: [{ fee_category: "overdraft", institution_amount: 35 }],
      complaintYears: [
        { year: "2025", total_complaints: 1, fee_related_complaints: 1 },
        { year: "2024", total_complaints: 1, fee_related_complaints: 0 },
      ],
      now: new Date("2026-10-27T00:00:00Z"),
    });
    expect(result.exhibit?.title).toContain("the CFPB recorded 1 complaint against Flora Bank in 2025, 1 about fees or low funds");
    expect(result.exhibit?.note).toBe("CFPB: 1 complaint in 2025 against 1 complaint in 2024.");
    expect(`${result.exhibit?.title} ${result.exhibit?.note}`).not.toMatch(/\b1 complaints\b/);
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
        open: [{ agency: "OCC", party_name: "Flora Bank, N.A.", against_holding_company: false, action_type: "Formal Agreement", subject: null, start_date: "2025-03-01", termination_date: null, penalty_amount: null, document_url: null }],
        past: [],
        pastCount: 2,
        asOf: "2026-10-07",
      },
    });
    expect(withRecord.data.enforcement_actions).toEqual({
      lists_checked: ["OCC enforcement actions"],
      as_of: "2026-10-07",
      no_end_date_on_file: [{ agency: "OCC", against: "Flora Bank, N.A.", type: "Formal Agreement", start_date: "2025-03-01", termination_date: null, penalty_amount: null }],
      past_count: 2,
      latest_past: [],
    });
    expect(withRecord.data.limits).toContain("FDIC and NCUA orders are not loaded");
    expect(withRecord.data.limits).not.toContain("no source of enforcement");
    expect(withRecord.sources.map((s) => s.label)).toContain("Federal enforcement actions");

    const without = buildRegulatoryContext(base);
    expect(without.data.enforcement_actions).toBeNull();
    expect(without.data.limits).toContain("Do not state whether it has enforcement actions");
  });

  it("labels withdrawn and rescinded guidance as history wherever a rule is printed or handed to the writer (#2525)", () => {
    const result = buildRegulatoryContext({
      institutionName: "Flora Bank",
      stateCode: "IL",
      charterType: "bank",
      fees: [{ fee_category: "overdraft", institution_amount: 35 }, { fee_category: "nsf", institution_amount: 30 }],
      complaintYears: [],
    });
    const byCitation = new Map(result.data.rules.map((r) => [r.citation, r]));
    const circular = byCitation.get("CFPB Circular 2022-06")!;
    expect(circular).toMatchObject({ status: "withdrawn", status_label: "Withdrawn on May 12, 2025; history only, not a current rule" });
    expect(circular.summary).toMatch(/^It said /);
    const fdic = byCitation.get("FDIC FIL-40-2022")!;
    expect(fdic.status).toBe("withdrawn");
    expect(fdic.status_label).toBe(
      "Rescinded on June 16, 2023 and replaced by FDIC FIL-32-2023, itself rescinded effective April 10, 2026 (FDIC FIL-15-2026); history only, not a current rule",
    );
    expect(byCitation.get("12 CFR 1005.17")?.status).toBe("binding_law");
    expect(result.data.rules.find((r) => r.status === "best_practice")?.status_label).toBe("Prudent practice, not a legal requirement");

    // The exhibit row, the source line and the payload all carry the status; no withdrawn row reads as a requirement.
    for (const row of result.exhibit!.rows.filter((r) => /2022-06|FIL-40-2022/.test(String(r[1])))) {
      expect(String(row[2])).toMatch(/history only, not a current rule/);
      expect(String(row[4])).toMatch(/^It said /);
    }
    expect(result.sources.find((s) => s.detail.startsWith("CFPB Circular 2022-06"))?.detail).toBe(
      "CFPB Circular 2022-06, October 2022. Withdrawn on May 12, 2025; history only, not a current rule.",
    );
    // Only binding law counts as bearing on the fees: Reg E for overdraft; nothing in force for NSF.
    expect(result.exhibit?.title).toMatch(/^1 federal rule bears directly on Flora Bank's fees/);
  });

  it("tells the writer withdrawn guidance is history and never makes a fee lawful (#2525)", () => {
    expect(REGULATORY_REPORT_RULES).toMatch(/A "withdrawn" item is history/);
    expect(REGULATORY_REPORT_RULES).toMatch(/does not make any fee lawful/);
    expect(REGULATORY_REPORT_RULES).toMatch(/Never say a fee is legal or illegal/);
    expect(REGULATORY_REPORT_RULES).toMatch(/FDIC guidance covered FDIC-supervised institutions/);
  });

  it("gives every reviewed rule a status, and every withdrawn one its change date (#2525)", () => {
    for (const rule of REGULATORY_RULES) {
      expect(["binding_law", "current_guidance", "withdrawn", "best_practice"]).toContain(rule.status);
      if (rule.status === "withdrawn") {
        expect(rule.statusChangedOn).toBeTruthy();
        expect(withdrawnLine(rule)).toMatch(/it is history, not a current rule\.$/);
        expect(rule.summary).not.toMatch(/\b(risks|is an unfair|can be an unfair)\b/);
      } else {
        expect(withdrawnLine(rule)).toBeNull();
      }
    }
    // A withdrawn item with no date on file still says it is history, without inventing a date.
    expect(ruleStatusLabel({ status: "withdrawn" })).toBe("Withdrawn; history only, not a current rule");
    const text = JSON.stringify(REGULATORY_RULES);
    expect(text).not.toContain("\u2014");
    expect(text).not.toMatch(/Hamilton Pro|Magellan|Rosetta|Knox|Darwin|Deming|Hoovie|Atlas/);
  });
});
