import { describe, expect, it } from "vitest";
import { normalizeInstitutionName } from "./custom-report-market";

describe("normalizeInstitutionName", () => {
  it("folds case, punctuation, a leading The and legal suffixes", () => {
    expect(normalizeInstitutionName("The First National Bank of Elk City, N.A.")).toBe("first national bank of elk city");
    expect(normalizeInstitutionName("first national bank of elk city")).toBe("first national bank of elk city");
    expect(normalizeInstitutionName("Smith & Sons Bank, Inc.")).toBe("smith and sons bank");
  });

  it("expands credit union abbreviations", () => {
    expect(normalizeInstitutionName("Elk City FCU")).toBe("elk city federal credit union");
    expect(normalizeInstitutionName("Elk City Federal Credit Union")).toBe("elk city federal credit union");
    expect(normalizeInstitutionName("Navy CU")).toBe("navy credit union");
  });

  it("keeps a name that is only a suffix-like word", () => {
    expect(normalizeInstitutionName("Co")).toBe("co");
  });
});
