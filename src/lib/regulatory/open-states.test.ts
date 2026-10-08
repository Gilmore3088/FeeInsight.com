import { describe, expect, it } from "vitest";

import { billStage, openStatesJurisdictionId, openStatesUrl, parseOpenStatesBill, STATE_BILL_JURISDICTIONS } from "./open-states";

describe("Open States client", () => {
  it("covers the 50 states, DC and Puerto Rico", () => {
    expect(STATE_BILL_JURISDICTIONS).toHaveLength(52);
    expect(STATE_BILL_JURISDICTIONS).toEqual(expect.arrayContaining(["DC", "PR", "WY"]));
    expect(openStatesJurisdictionId("DC")).toBe("ocd-jurisdiction/country:us/district:dc/government");
    expect(openStatesJurisdictionId("PR")).toBe("ocd-jurisdiction/country:us/territory:pr/government");
  });

  it("builds a search URL with no key in it", () => {
    const url = new URL(openStatesUrl("TX", "overdraft", "2025-09-02"));
    expect(url.searchParams.get("jurisdiction")).toBe("ocd-jurisdiction/country:us/state:tx/government");
    expect(url.searchParams.getAll("include")).toEqual(["actions", "abstracts"]);
    expect(url.searchParams.get("apikey")).toBeNull();
  });

  it("works out a bill's stage from its actions", () => {
    const lower = { classification: "lower" };
    const upper = { classification: "upper" };
    expect(billStage([]).stage).toBe("introduced");
    expect(billStage([{ date: "2026-01-01", classification: ["introduction"] }, { date: "2026-01-09", classification: ["referral-committee"] }])).toEqual({
      stage: "in_committee",
      date: "2026-01-09",
    });
    expect(
      billStage([
        { date: "2026-03-01", classification: ["passage"], organization: lower },
        { date: "2026-04-01", classification: ["passage"], organization: upper },
      ]).stage,
    ).toBe("passed_legislature");
    expect(billStage([{ date: "2026-05-01T00:00:00", classification: ["executive-signature"] }])).toEqual({ stage: "signed", date: "2026-05-01" });
    expect(billStage([{ date: "2026-05-01", classification: ["executive-veto"] }]).stage).toBe("vetoed");
  });

  it("keeps bank fee bills and drops other junk fee bills", () => {
    const base = { id: "x", identifier: "HB 1", openstates_url: "https://openstates.org/x" };
    expect(parseOpenStatesBill({ ...base, title: "Concerning nonsufficient funds fees" }, "co")).toMatchObject({ state_code: "CO", topics: ["fees", "overdraft_nsf"] });
    expect(parseOpenStatesBill({ ...base, title: "Ticket resale junk fees" }, "co")).toBeNull();
  });

  it("does not read groundwater overdraft as an overdraft fee (CA AB 1520, prod 2026-10-08)", () => {
    const base = { id: "x", identifier: "AB 1520", openstates_url: "https://openstates.org/x" };
    for (const abstract of [
      "Requires a groundwater sustainability agency in a critically overdrafted basin to report pumping.",
      "Addresses overdraft conditions and groundwater overdraft in the subbasin.",
      "Prevents overdraft of the aquifer.",
    ]) {
      expect(parseOpenStatesBill({ ...base, title: "Public resources: conservation.", abstracts: [{ abstract }] }, "ca"), abstract).toBeNull();
    }
    // Water bills word it many ways; with no banking words, any "overdraft" is the water kind.
    for (const abstract of [
      "Redefines the water year for groundwater investigations in basins subject to overdraft.",
      "Requires the department to report on groundwater overdraft-related subsidence.",
      // No water words at all, but no bank, account or fee either: not a bank fee bill.
      "Authorizes surety bonds as security and addresses overdraft in specified regions.",
    ]) {
      expect(parseOpenStatesBill({ ...base, title: "Public resources: conservation.", abstracts: [{ abstract }] }, "ca"), abstract).toBeNull();
    }
    // A bill that names both keeps its bank fee reading.
    expect(
      parseOpenStatesBill({ ...base, title: "Overdraft fees on checking accounts", abstracts: [{ abstract: "Also funds critically overdrafted basins." }] }, "ca"),
    ).toMatchObject({ topics: ["fees", "overdraft_nsf"] });
    expect(
      parseOpenStatesBill({ ...base, title: "Bank overdraft fees", abstracts: [{ abstract: "Applies to banks and credit unions; also amends the Water Code." }] }, "ca"),
    ).toMatchObject({ topics: ["fees", "overdraft_nsf"] });
  });
});
