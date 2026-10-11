import { describe, expect, it } from "vitest";
import { buildAuditTrail, provenanceToTrail, publishedRange } from "./audit-trail";
import { WORKSPACE_ENGINE_VERSION } from "./workspace/types";
import { summarizeLayer } from "./research-layers";

const layer = summarizeLayer("state", "Texas", "Banks and credit unions headquartered in Texas", [0, 25, 35], 30);

describe("buildAuditTrail", () => {
  it("names each source with its date and labels market-only evidence", () => {
    const trail = buildAuditTrail({
      feeName: "Overdraft",
      layer,
      layerDates: ["2026-10-01T03:00:00Z", null, "2026-09-12T00:00:00Z"],
      ownFeeRows: [{ id: 1, feeName: "Overdraft", amount: 30, sourceDocumentId: 9, documentUrl: "https://bank.example/fees.pdf", sourceUrl: "https://bank.example/fees", publishedAt: "2026-10-02T00:00:00Z", verifiedByEventId: "7" }],
      local: { basis: "branch_counties", places: ["Travis County, TX", "Hays County, TX"], sodYear: 2025 },
      clientFigures: { paidItems: null, waiverRate: null },
      now: new Date("2026-10-06T00:00:00Z"),
    });
    expect(trail.evidence).toBe("Market data only");
    expect(trail.sources.map((s) => [s.label, s.asOf])).toEqual([
      ["Overdraft fees, Texas", "2026-09-12 to 2026-10-01"],
      ["Research institution overdraft fee", "2026-10-02"],
      ["Local market", "June 30, 2025"],
    ]);
    expect(trail.sources[1].href).toBe("https://bank.example/fees.pdf");
    expect(trail.sources[1].detail).not.toContain("your own");
    expect(trail.assumptions[0]).toMatch(/No volume assumed/);
  });

  it("records the bank's own figures with who entered them and when", () => {
    const trail = buildAuditTrail({
      feeName: "Overdraft",
      layer,
      layerDates: [],
      ownFeeRows: [],
      clientFigures: { paidItems: 14500, waiverRate: 0.12 },
      enteredBy: "Pat Lee",
      now: new Date("2026-10-06T01:00:00Z"),
    });
    expect(trail.evidence).toBe("Market data and your figures");
    expect(trail.assumptions).toEqual([]);
    expect(trail.clientFacts).toEqual([
      { label: "Items charged a year", value: "14,500", givenBy: "Pat Lee", givenAt: "2026-10-06T01:00:00.000Z" },
      { label: "Share waived or refunded", value: "12%", givenBy: "Pat Lee", givenAt: "2026-10-06T01:00:00.000Z" },
    ]);
    expect(trail.peerGroup).toEqual({ label: "Texas", n: 3 });
    expect(trail.engineVersion).toBe(WORKSPACE_ENGINE_VERSION);
  });

  it("maps the engine's provenance onto the panel without adding anything", () => {
    const trail = provenanceToTrail({
      engineVersion: "1.0.0",
      generatedAt: "2026-10-06T02:00:00.000Z",
      peerGroup: { label: "Texas community banks", n: 41 },
      dataAsOf: { fees: "2026-10-05", financials: "2026-06-30", changes: null },
      sources: [
        { label: "Published fee schedules", table: "published_fee_catalog" },
        { label: "FDIC call report", table: "institution_financial_records", asOf: "2026-06-30" },
        { label: "Your schedule", url: "https://bank.example/fees.pdf" },
      ],
      assumptions: ["One value per institution."],
      clientFacts: [{ factId: "f1", fieldKey: "fee.overdraft.annual_items", value: 9000, givenBy: "Pat Lee", givenAt: "2026-10-01T00:00:00Z" }],
    });
    expect(trail.sources.map((s) => [s.label, s.asOf, s.href])).toEqual([
      ["Published fee schedules", "2026-10-05", null],
      ["FDIC call report", "2026-06-30", null],
      ["Your schedule", null, "https://bank.example/fees.pdf"],
    ]);
    expect(trail.peerGroup).toEqual({ label: "Texas community banks", n: 41 });
    expect(trail.engineVersion).toBe("1.0.0");
    expect(trail.preparedAt).toBe("2026-10-06T02:00:00.000Z");
    expect(trail.assumptions).toEqual(["One value per institution."]);
    expect(trail.clientFacts).toEqual([{ label: "Items charged a year (overdraft)", value: "9,000", givenBy: "Pat Lee", givenAt: "2026-10-01T00:00:00Z" }]);
    expect(trail.evidence).toBe("Market data and your figures");
  });

  it("gives no date range when no dates are known", () => {
    expect(publishedRange([null])).toBeNull();
  });
});
