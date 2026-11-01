import { describe, expect, it } from "vitest";

// #1944: Hamilton's publish gate with `OPENING_DOCUMENT_TAKEDOWN_LIVE` on as shipped (James, "Take
// them down", 2026-10-26). No mock: the gate reads the real switch, so turning it off again fails
// these tests on purpose.
import { OPENING_DOCUMENT_TAKEDOWN_LIVE } from "@/lib/agents/darwin/non-deposit-document-check";
import { publishSkipReason } from "./publish";

const TD_FIT = "https://www.td.com/content/dam/tdb/document/pdf/personal-banking/td-fit-account-guide-acc-en.pdf";
const VOLT = "https://www.arborfcu.org/hubfs/Documents/Volt%20Disclosures%204.pdf";
const row = {
  fee_verified_id: 9301,
  fee_raw_id: 9401,
  institution_id: 12,
  source_url: TD_FIT,
  document_r2_key: null,
  extraction_confidence: "0.9200",
  canonical_fee_key: "monthly_maintenance",
  fee_audience: "consumer" as const,
  variant_type: null,
  outlier_flags: ["agentic_darwin_verified"],
  verified_by_agent_event_id: "00000000-0000-4000-8000-000000009301",
  fee_name: "Monthly fee",
  amount: "5.00",
  frequency: "monthly",
  raw_agent_event_id: "00000000-0000-4000-8000-000000009401",
  source_document_id: 33822,
  document_url: TD_FIT,
  document_opening: "TD Fit Personal Unsecured Consumer Loan Disclosure\nAn ideal option if you are looking to consolidate debt.",
};

describe("publish gate with the opening sub-switch on (#1944)", () => {
  it("runs with the real switch on", () => {
    expect(OPENING_DOCUMENT_TAKEDOWN_LIVE).toBe(true);
  });

  it("refuses a fee from a document that opens as a loan disclosure", () => {
    expect(publishSkipReason(row, 0.85, true)).toBe("Refused at publish, Darwin's re-check would take it down: loan_titled_document: loan #33822");
  });

  it("refuses a fee from a youth account's document", () => {
    const youth = {
      ...row, institution_id: 7322, canonical_fee_key: "nsf", fee_name: "NSF Check, ACH Item, or Debit Card", source_document_id: 2241, document_url: VOLT, source_url: VOLT,
      document_opening: "ACCOUNT-SPECIFIC DISCLOSURES\nThe following additional disclosures apply to the Volt Teen Banking & Volt Banking accounts:",
    };
    expect(publishSkipReason(youth, 0.85, true)).toBe("Refused at publish, Darwin's re-check would take it down: youth_account_document: youth_account #2241");
  });

  it("lets the same fee by when its document opens as the general schedule, or has no stored text", () => {
    expect(publishSkipReason({ ...row, document_opening: "Personal Fee Schedule\nChecks | International" }, 0.85, true) ?? "").not.toMatch(/Darwin's re-check/);
    expect(publishSkipReason({ ...row, document_opening: null }, 0.85, true) ?? "").not.toMatch(/Darwin's re-check/);
  });
});
