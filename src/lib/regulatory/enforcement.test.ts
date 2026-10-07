import { describe, expect, it } from "vitest";
import {
  buildEnforcementMatcher,
  normalizeName,
  parseActionDate,
  parseFedActions,
  parseOccActions,
  splitFedOrganizations,
  splitLocation,
} from "./enforcement";

describe("enforcement parsing", () => {
  it("reads the date formats the OCC and Fed files use", () => {
    expect(parseActionDate("09/08/2022")).toBe("2022-09-08");
    expect(parseActionDate("9/8/2022 12:00:00 AM")).toBe("2022-09-08");
    expect(parseActionDate("September 8, 2022")).toBe("2022-09-08");
    expect(parseActionDate("2022-09-08T00:00:00")).toBe("2022-09-08");
    expect(parseActionDate("/Date(1662595200000)/")).toBe("2022-09-08");
    expect(parseActionDate("")).toBeNull();
  });

  it("normalizes names so agency and FFIEC spellings meet", () => {
    expect(normalizeName("Wells Fargo & Company")).toBe(normalizeName("WELLS FARGO&COMPANY"));
    expect(normalizeName("Wells Fargo Bank, N.A.")).toBe(normalizeName("Wells Fargo Bank, National Association"));
    expect(normalizeName("First National Financial Services, Inc.")).toBe(normalizeName("FIRST NATL FINL SERVICES INC"));
  });

  it("splits a location into city and state code", () => {
    expect(splitLocation("Sioux Falls, SD")).toEqual({ city: "Sioux Falls", state: "SD" });
    expect(splitLocation("Sioux Falls, South Dakota")).toEqual({ city: "Sioux Falls", state: "SD" });
    expect(splitLocation("London, United Kingdom")).toEqual({ city: "London, United Kingdom", state: null });
  });

  it("splits the Fed's organization text, keeping commas inside names", () => {
    expect(splitFedOrganizations("Wells Fargo Bank, N.A., Sioux Falls, South Dakota")).toEqual([
      { name: "Wells Fargo Bank, N.A.", city: "Sioux Falls", state: "SD" },
    ]);
    expect(splitFedOrganizations("First Bancorp, Charleston, West Virginia and First Bank, Beckley, West Virginia")).toEqual([
      { name: "First Bancorp", city: "Charleston", state: "WV" },
      { name: "First Bank", city: "Beckley", state: "WV" },
    ]);
    expect(splitFedOrganizations("Deutsche Bank AG, Frankfurt, Germany")).toEqual([
      { name: "Deutsche Bank AG, Frankfurt, Germany", city: null, state: null },
    ]);
  });

  it("keeps only institution actions from the OCC export", () => {
    const actions = parseOccActions([
      { CharterNumber: "1", Institution: "Example Bank, N.A.", Company: null, Individual: null, Location: "Dallas, TX", StartDate: "01/05/2024", TerminationDate: null, TypeDescription: "Formal Agreement", TypeCode: "FA", SubjectMatters: ["BSA/AML"], DocketNumber: "AA-1", Amount: null, StartDocuments: ["2024-001"] },
      { CharterNumber: "1", Institution: "Example Bank, N.A.", Company: null, Individual: "Jane Officer", Location: "Dallas, TX", StartDate: "01/05/2024", TypeDescription: "Prohibition", TypeCode: "PRO" },
      { CharterNumber: "1", Institution: "Example Bank, N.A.", Company: "Vendor LLC", Individual: null, Location: "Dallas, TX", StartDate: "01/05/2024", TypeDescription: "C&D", TypeCode: "CD" },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ agency: "OCC", party_name: "Example Bank, N.A.", party_state: "TX", start_date: "2024-01-05", subject: "BSA/AML", action_type: "Formal Agreement" });
  });

  it("keeps only institution actions from the Fed CSV and resolves order links", () => {
    const csv = [
      "﻿Effective Date,Termination Date,Banking Organization,Individual,Individual Affiliation,Action,Note,URL,Name",
      '"March 1, 2023",,"Example Bancorp, Dallas, Texas",,,Written Agreement,,/newsevents/files/enf20230301a1.pdf,x',
      '"March 2, 2023",,,Jane Officer,Example Bank,Prohibition,,DNE,y',
      '"April 1, 2020","June 1, 2022","Sample Bank, Austin, Texas",,,Cease and Desist Order,Civil money penalty,DNE,z',
    ].join("\n");
    const actions = parseFedActions(csv);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ agency: "FRB", party_name: "Example Bancorp", party_state: "TX", start_date: "2023-03-01", document_url: "https://www.federalreserve.gov/newsevents/files/enf20230301a1.pdf" });
    expect(actions[1]).toMatchObject({ termination_date: "2022-06-01", document_url: null, subject: "Civil money penalty" });
  });
});

describe("enforcement matching", () => {
  const matcher = buildEnforcementMatcher([
    { id: 1, name: "Example Bank, National Association", state_code: "TX", city: "Dallas", holding_company_name: "EXAMPLE BANCORP", active: true },
    { id: 2, name: "First Bank", state_code: "WV", city: "Beckley", holding_company_name: null, active: true },
    { id: 3, name: "First Bank", state_code: "WV", city: "Elkins", holding_company_name: null, active: true },
    { id: 4, name: "Old Bank", state_code: "TX", city: "Waco", holding_company_name: null, active: false },
  ]);

  it("matches by name and state, then city when a state has two", () => {
    expect(matcher.match({ party_name: "Example Bank, N.A.", party_city: "Dallas", party_state: "TX" })).toEqual({ institution_id: 1, holding_company: null, method: "name_state" });
    expect(matcher.match({ party_name: "First Bank", party_city: "Elkins", party_state: "WV" })).toEqual({ institution_id: 3, holding_company: null, method: "name_city" });
    expect(matcher.match({ party_name: "First Bank", party_city: "Wheeling", party_state: "WV" }).institution_id).toBeNull();
    expect(matcher.match({ party_name: "Old Bank", party_city: null, party_state: "TX" }).institution_id).toBe(4);
  });

  it("falls back to a holding company with a subsidiary in that state", () => {
    expect(matcher.match({ party_name: "Example Bancorp", party_city: "Dallas", party_state: "TX" })).toEqual({ institution_id: null, holding_company: "EXAMPLE BANCORP", method: "holding_company" });
    expect(matcher.match({ party_name: "Example Bancorp", party_city: null, party_state: "OK" }).method).toBeNull();
  });
});
