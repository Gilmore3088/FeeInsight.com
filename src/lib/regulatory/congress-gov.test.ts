import { describe, expect, it } from "vitest";

import { congressOrdinal, currentCongress, federalBillStage, parseCongressBill } from "./congress-gov";

describe("Congress.gov client", () => {
  it("knows the current Congress", () => {
    expect(currentCongress(new Date("2026-10-07T00:00:00Z"))).toBe(119);
    expect(currentCongress(new Date("2027-02-01T00:00:00Z"))).toBe(120);
    expect([119, 121, 122, 123, 111].map(congressOrdinal)).toEqual(["119th", "121st", "122nd", "123rd", "111th"]);
  });

  it("reads a bill's stage from its latest action", () => {
    expect(federalBillStage("Introduced in House")).toBe("introduced");
    expect(federalBillStage("Referred to the Committee on Banking, Housing, and Urban Affairs.")).toBe("in_committee");
    expect(federalBillStage("Passed/agreed to in House: On passage Passed by recorded vote: 220 - 210.")).toBe("passed_chamber");
    expect(federalBillStage("Presented to President.")).toBe("passed_legislature");
    expect(federalBillStage("Became Public Law No: 119-12.")).toBe("signed");
    expect(federalBillStage("Vetoed by President.")).toBe("vetoed");
  });

  it("keeps bank fee bills only", () => {
    expect(parseCongressBill({ congress: 119, number: 5, type: "S", title: "Stop Overdraft Profiteering Act" })).toMatchObject({
      id: "119-s-5",
      identifier: "S. 5",
      topics: ["overdraft_nsf"],
    });
    expect(parseCongressBill({ congress: 119, number: 6, type: "S", title: "Airline junk fee act" })).toBeNull();
  });
});
