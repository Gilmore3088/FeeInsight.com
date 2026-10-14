import { describe, expect, it, vi } from "vitest";
import { federalRegisterUrl, fetchFederalRegisterRules, parseFederalRegisterDocument, trackerStage } from "./federal-register";

const proposed = {
  document_number: "2026-01234",
  title: "Overdraft Lending: Very Large Financial Institutions",
  type: "Proposed Rule",
  abstract: "The Bureau proposes to amend Regulation E and Regulation Z.",
  agencies: [{ slug: "consumer-financial-protection-bureau", name: "Consumer Financial Protection Bureau" }],
  publication_date: "2026-09-01",
  comments_close_on: "2026-11-01",
  effective_on: null,
  html_url: "https://www.federalregister.gov/documents/2026/09/01/2026-01234/overdraft",
  regulation_id_numbers: ["3170-AA42"],
  docket_ids: ["CFPB-2026-0001"],
  cfr_references: [{ title: 12, part: 1005 }, { title: 12, part: 1026 }],
};

describe("Federal Register tracker parsing", () => {
  it("turns a proposed rule into a tracker item with agencies, CFR parts and fee topics", () => {
    expect(parseFederalRegisterDocument(proposed)).toEqual({
      document_number: "2026-01234",
      kind: "proposed_rule",
      title: "Overdraft Lending: Very Large Financial Institutions",
      abstract: "The Bureau proposes to amend Regulation E and Regulation Z.",
      agencies: ["CFPB"],
      publication_date: "2026-09-01",
      comments_close_on: "2026-11-01",
      effective_on: null,
      url: proposed.html_url,
      rins: ["3170-AA42"],
      dockets: ["CFPB-2026-0001"],
      cfr_parts: ["12 CFR 1005", "12 CFR 1026"],
      topics: ["electronic_transfers", "overdraft_nsf"],
    });
  });

  it("keeps mortgage escrow and real estate lending rules off the fee topics", () => {
    const occ = { ...proposed, agencies: [{ slug: "comptroller-of-the-currency", name: "Comptroller of the Currency" }], cfr_references: [] };
    const escrow = (title: string) =>
      parseFederalRegisterDocument({ ...occ, title, abstract: "The OCC addresses state laws on fees charged for escrow accounts." })!.topics;
    expect(escrow("Preemption Determination: State Interest-on-Escrow Laws")).toEqual([]);
    expect(escrow("Real Estate Lending Escrow Accounts")).toEqual([]);
    expect(
      parseFederalRegisterDocument({ ...occ, title: "National Bank Non-Interest Charges and Fees", abstract: null })!.topics,
    ).toEqual(["fees"]);
  });

  it("skips notices and documents missing a number, title, link or date", () => {
    expect(parseFederalRegisterDocument({ ...proposed, type: "Notice" })).toBeNull();
    expect(parseFederalRegisterDocument({ ...proposed, document_number: undefined })).toBeNull();
    expect(parseFederalRegisterDocument({ ...proposed, publication_date: "September 1" })).toBeNull();
  });

  it("places each rule in its stage from the dates on the day it is read", () => {
    const item = parseFederalRegisterDocument(proposed)!;
    expect(trackerStage(item, "2026-10-07")).toBe("comment_open");
    expect(trackerStage(item, "2026-11-01")).toBe("comment_open");
    expect(trackerStage(item, "2026-11-02")).toBe("comment_closed");
    const final = { kind: "final_rule" as const, comments_close_on: null, effective_on: "2027-01-01" };
    expect(trackerStage(final, "2026-10-07")).toBe("final_not_yet_effective");
    expect(trackerStage(final, "2027-01-01")).toBe("in_effect");
    expect(trackerStage({ ...final, effective_on: null }, "2026-10-07")).toBe("in_effect");
  });

  it("asks for the five banking regulators' proposed and final rules since a date", () => {
    const url = decodeURIComponent(federalRegisterUrl("2025-09-02"));
    for (const slug of ["consumer-financial-protection-bureau", "federal-deposit-insurance-corporation", "comptroller-of-the-currency", "federal-reserve-system", "national-credit-union-administration"]) {
      expect(url).toContain(`conditions[agencies][]=${slug}`);
    }
    expect(url).toContain("conditions[type][]=PRORULE");
    expect(url).toContain("conditions[publication_date][gte]=2025-09-02");
    expect(url).toContain("fields[]=comments_close_on");
  });

  it("follows next pages until the API stops", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 2, results: [proposed], next_page_url: "https://www.federalregister.gov/api/v1/documents.json?page=2" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 2, results: [{ ...proposed, document_number: "2026-09999", type: "Rule", effective_on: "2027-01-01" }], next_page_url: null })));
    const result = await fetchFederalRegisterRules("2025-09-02", { fetchImpl, backoffMs: 0 });
    expect(result.pages).toBe(2);
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.kind)).toEqual(["proposed_rule", "final_rule"]);
  });
});
