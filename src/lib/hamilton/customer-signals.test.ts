import { describe, expect, it } from "vitest";
import { INTERNAL_REVIEW_SIGNAL_TYPES, customerSignalCopy, isCustomerSignal } from "./customer-signals";
import { PIPELINE_TERMS } from "./workspace/four-roles";

describe("isCustomerSignal", () => {
  it("keeps internal review signals out of the Pro feed", () => {
    expect(isCustomerSignal("darwin_verification_needs_review")).toBe(false);
    expect(isCustomerSignal("knox_extraction_needs_review")).toBe(false);
  });

  it("keeps market and fee-change signals", () => {
    expect(isCustomerSignal("hamilton_competitor_fee_change")).toBe(true);
    expect(isCustomerSignal("hamilton_fee_movement_detected")).toBe(true);
    expect(isCustomerSignal("darwin_verification_completed")).toBe(true);
  });

  it("lists every internal *_needs_review type the pipeline raises", () => {
    expect([...INTERNAL_REVIEW_SIGNAL_TYPES].sort()).toEqual([
      "darwin_verification_needs_review",
      "knox_extraction_needs_review",
    ]);
  });
});

describe("customerSignalCopy", () => {
  // The wording the pipeline writes today (knox/extract.ts, darwin/verify.ts, hamilton/publish.ts, admin/quality/actions.ts).
  const stored = [
    { signalType: "knox_extraction_completed", title: "Capital City Bank - 23 raw observations extracted",
      body: "Knox extracted 23 raw observations from Rosetta-normalized source text. Darwin verification is still required before benchmark scoring or public-ready analysis changes." },
    { signalType: "darwin_verification_completed", title: "Capital City Bank - 12 rows verified",
      body: "Darwin verified 12 rows from source-grounded Knox observations. These rows are ready for Hamilton publication review before verified benchmark scoring changes." },
    { signalType: "hamilton_publication_completed", title: "Capital City Bank - 12 rows published",
      body: "Hamilton published 12 rows into the verified fee catalog. Refresh competitive briefs, scenarios, and watchlist analysis for this institution." },
    { signalType: "hamilton_fee_movement_detected", title: "Capital City Bank - 2 published fee movements detected",
      body: "Hamilton detected 2 published fee movements against prior live catalog rows. Refresh competitive briefs, scenarios, and watchlist analysis before using this institution in current recommendations." },
    { signalType: "source_accepted", title: "Capital City Bank - official fee source accepted",
      body: "Data Trust accepted an official fee source URL. Validation is queued; rerun analysis or reports after verified rows publish." },
    { signalType: "source_rejected", title: "Capital City Bank - submitted source rejected",
      body: "Data Trust rejected the submitted source as not official enough for validation. Submit a better source before relying on institution-specific fee analysis." },
    { signalType: "source_needs_info", title: "Capital City Bank - source needs more information",
      body: "Data Trust requested more context before validating the submitted source. Institution-specific conclusions should remain caveated until the source is accepted." },
  ];

  it("never shows agent names, internal terms or operator instructions", () => {
    for (const signal of stored) {
      const copy = customerSignalCopy(signal);
      const text = `${copy.title} ${copy.body}`;
      expect(text, signal.signalType).not.toMatch(PIPELINE_TERMS);
      expect(text, signal.signalType).not.toMatch(/raw observation|Data Trust|competitive briefs|watchlist analysis|benchmark scoring/i);
      expect(copy.title.startsWith("Capital City Bank - "), signal.signalType).toBe(true);
    }
  });

  it("keeps the count of fee changes and names the bank", () => {
    expect(customerSignalCopy(stored[3])).toEqual({
      title: "Capital City Bank - 2 published fees changed",
      body: "Capital City Bank changed 2 published fees since the last reading. Rerun a saved brief to use the new figures.",
    });
    expect(customerSignalCopy(stored[0]).body).toBe(
      "Hamilton read a new copy of Capital City Bank's fee schedule. Its fees are checked against the document before any comparison changes.",
    );
  });

  it("reads a title with no institution without inventing one", () => {
    const copy = customerSignalCopy({ ...stored[2], title: "12 rows published" });
    expect(copy).toEqual({ title: "Published fees updated", body: "This institution's published fees were updated. Rerun a saved report to use the new figures." });
  });

  it("passes other signals through unchanged", () => {
    const competitor = { signalType: "hamilton_competitor_fee_change", title: "M&T Bank - overdraft fee up $2", body: "M&T Bank raised its overdraft fee from $35 to $37." };
    expect(customerSignalCopy(competitor)).toEqual({ title: competitor.title, body: competitor.body });
  });
});
