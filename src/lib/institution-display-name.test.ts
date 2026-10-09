import { describe, expect, it } from "vitest";
import { institutionDisplayName } from "./institution-display-name";

describe("institutionDisplayName", () => {
  it("shows the name an institution trades under", () => {
    expect(institutionDisplayName("Denver Community Cu D.B.A. Zing Cu Federal Credit Union")).toBe("Zing Credit Union");
    expect(institutionDisplayName("Sooper Cu Dba Climb Cu Federal Credit Union")).toBe("Climb Credit Union");
    expect(institutionDisplayName("Oregon Pacific Banking Company dba Oregon Pacific Bank")).toBe("Oregon Pacific Bank");
    expect(institutionDisplayName("Story Bank DBA Story Financial Partners")).toBe("Story Financial Partners");
    // A bare acronym says less than the legal name.
    expect(institutionDisplayName("The Home Savings and Loan Company of Kenton, Ohio, DBA HSLC")).toBe("The Home Savings and Loan Company of Kenton, Ohio");
  });

  it("spells out a mid-name CU and drops the repeated charter words", () => {
    expect(institutionDisplayName("Metro Cu Federal Credit Union")).toBe("Metro Credit Union");
    expect(institutionDisplayName("Community Cu Of New Milford, Inc. Federal Credit Union")).toBe("Community Credit Union of New Milford");
    expect(institutionDisplayName("Greater Kentucky Cu, Inc. Federal Credit Union")).toBe("Greater Kentucky Credit Union");
    expect(institutionDisplayName("Municipal Emps Cu Of Oklahoma City Federal Credit Union")).toBe("Municipal Employees Credit Union of Oklahoma City");
    expect(institutionDisplayName("Wnc Community  Cu Federal Credit Union")).toBe("Wnc Community Credit Union");
    expect(institutionDisplayName("Post Office Cu Of Md, Inc. Federal Credit Union")).toBe("Post Office Credit Union of Md");
  });

  it("leaves other names as they are", () => {
    expect(institutionDisplayName("Cu Hawaii Federal Credit Union")).toBe("Cu Hawaii Federal Credit Union");
    expect(institutionDisplayName("Westerra Federal Credit Union")).toBe("Westerra Federal Credit Union");
    expect(institutionDisplayName("JPMorgan Chase Bank")).toBe("JPMorgan Chase Bank");
    expect(institutionDisplayName("Bank of the West")).toBe("Bank of the West");
    expect(institutionDisplayName(null)).toBeNull();
  });
});
