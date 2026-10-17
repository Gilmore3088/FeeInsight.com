import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { distributionRow, groupLending, medianOrNull, summarizeCounties, withLenderShares } from "./cra-aggregates";

describe("cra aggregates helpers", () => {
  it("holds back a median below the minimum institution count", () => {
    expect(medianOrNull([1, 2, 3])).toBeNull();
    expect(medianOrNull([1, 2, 3, 4, 5, 6])).toBe(3.5);
  });

  it("builds a rating distribution with shares and the count behind the median", () => {
    const row = distributionRow("TX", { 1: 2, 2: 7, 3: 1 }, [100, 200, 300, 400, 500]);
    expect(row).toMatchObject({ institutions: 10, outstanding: 2, needsToImprove: 1, outstandingShare: 0.2, belowSatisfactoryShare: 0.1, medianExamAgeDays: 300, examAgeInstitutions: 5 });
    expect(distributionRow(null, {}, []).outstandingShare).toBeNull();
  });

  it("gives each lender its share of the county", () => {
    const { totalLoans, shares } = withLenderShares([
      { agencyCode: "3", respondentId: "1", institutionId: 1, name: "A", loans: 30, amountThousands: 3000, loansRevUnder1m: null },
      { agencyCode: "1", respondentId: "2", institutionId: null, name: "B", loans: 10, amountThousands: 1000, loansRevUnder1m: 5 },
    ]);
    expect(totalLoans).toBe(40);
    expect(shares[0]).toMatchObject({ name: "A", loanShare: 0.75, amountShare: 0.75 });
  });

  it("summarizes counties with concentration", () => {
    const [county] = summarizeCounties([
      { stateFips: "48", countyFips: "201", loans: 10, amountThousands: 500 },
      { stateFips: "48", countyFips: "201", loans: 10, amountThousands: 500 },
    ]);
    expect(county).toMatchObject({ lenders: 2, totalLoans: 20, topLenderAmountShare: 0.5, hhi: 5000, medianLenderLoans: null });
  });

  it("groups per-institution lending with counts", () => {
    const rows = groupLending(Array.from({ length: 5 }, (_, i) => ({ group: "11", loans: i + 1, amountThousands: (i + 1) * 100 })));
    expect(rows[0]).toMatchObject({ group: "11", institutions: 5, medianLoans: 3, medianAmountThousands: 300, totalLoans: 15 });
  });
});
