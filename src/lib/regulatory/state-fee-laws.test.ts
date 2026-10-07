import { describe, expect, it } from "vitest";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { STATE_FEE_LAW_COVERAGE, STATE_FEE_LAWS, STATE_FEE_LAWS_REVIEWED, stateFeeLawsFor } from "./state-fee-laws";
import { STATE_REGULATORS } from "./state-regulators";

const FEE_CATEGORIES_LIST = Object.keys(DISPLAY_NAMES);
const JURISDICTIONS = [...STATE_REGULATORS.map((entry) => entry.stateCode), "PR"];

describe("state fee laws", () => {
  it("covers every state, DC and Puerto Rico, once each", () => {
    const codes = STATE_FEE_LAW_COVERAGE.map((entry) => entry.state_code).sort();
    expect(codes).toEqual([...new Set(JURISDICTIONS)].sort());
  });

  it("gives every rule a citation, a date, a one-line summary and known fee categories", () => {
    for (const law of STATE_FEE_LAWS) {
      expect(law.citation.trim(), law.id).not.toBe("");
      expect(law.date.trim(), law.id).not.toBe("");
      expect(law.summary.split(/\s+/).length, law.id).toBeLessThanOrEqual(25);
      expect(law.summary, law.id).not.toMatch(/[;:]/);
      expect(law.summary.trim().endsWith("."), law.id).toBe(true);
      expect(JURISDICTIONS, law.id).toContain(law.state_code);
      if (law.url !== null) expect(law.url, law.id).toMatch(/^https?:\/\//);
      for (const category of law.applies_to) expect(FEE_CATEGORIES_LIST, law.id).toContain(category);
    }
  });

  it("traces every number a summary states to its figures", () => {
    for (const law of STATE_FEE_LAWS) {
      const withoutDates = law.summary.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}\b/g, "");
      const numbers = (withoutDates.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) => Number(value.replace(/,/g, "")));
      const figures = Object.values(law.figures ?? {});
      for (const value of numbers) {
        if (value >= 1900 && value <= 2100) continue; // a year
        expect(figures, `${law.id}: ${value}`).toContain(value);
      }
    }
  });

  it("returns nothing for citation until the laws are reviewed", () => {
    expect(STATE_FEE_LAWS_REVIEWED).toBe(false);
    expect(stateFeeLawsFor({ stateCode: "CA", charterType: "credit_union", charterAgency: "State" })).toEqual([]);
  });

  it("scopes the draft by charter agency and returns only laws in force", () => {
    const stateCu = stateFeeLawsFor({ stateCode: "CA", charterType: "credit_union", charterAgency: "State" }, { includeUnreviewed: true });
    const federalCu = stateFeeLawsFor({ stateCode: "CA", charterType: "credit_union", charterAgency: "NCUA" }, { includeUnreviewed: true });
    const stateBank = stateFeeLawsFor({ stateCode: "CA", charterType: "bank", charterAgency: "State" }, { includeUnreviewed: true });
    expect(stateCu.map((law) => law.id)).toContain("ca_cu_overdraft_nsf_cap");
    expect(stateBank.map((law) => law.id)).not.toContain("ca_cu_overdraft_nsf_cap");
    expect(federalCu.every((law) => law.institutions === "all_depository_institutions")).toBe(true);
    expect(federalCu.length).toBeGreaterThan(0);
    for (const law of [...stateCu, ...federalCu, ...stateBank]) {
      expect(law.status).toBe("in_force");
      expect(law.topic).not.toBe("fee_authority");
    }
  });
});
