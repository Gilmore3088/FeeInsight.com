import { describe, expect, it } from "vitest";
import { buildAuditTrail, publishedRange } from "./audit-trail";
import { summarizeLayer } from "./research-layers";

const layer = summarizeLayer("state", "Texas", "Banks and credit unions headquartered in Texas", [0, 25, 35], 30);

describe("buildAuditTrail", () => {
  it("names each source with its date and labels market-only evidence", () => {
    const trail = buildAuditTrail({
      feeName: "Overdraft",
      layer,
      layerDates: ["2026-10-01T03:00:00Z", null, "2026-09-12T00:00:00Z"],
      ownFeeRows: [{ feeName: "Overdraft", amount: 30, sourceUrl: "https://bank.example/fees.pdf", publishedAt: "2026-10-02T00:00:00Z", verifiedByEventId: 7 }],
      local: { year: 2025, countyCount: 2, banks: [] },
      clientFigures: { paidItems: null, waiverRate: null },
      now: new Date("2026-10-06T00:00:00Z"),
    });
    expect(trail.evidence).toBe("Market data only");
    expect(trail.sources.map((s) => [s.label, s.asOf])).toEqual([
      ["Overdraft fees, Texas", "2026-09-12 to 2026-10-01"],
      ["Your overdraft fee", "2026-10-02"],
      ["Local market", "June 30, 2025"],
    ]);
    expect(trail.sources[1].href).toBe("https://bank.example/fees.pdf");
    expect(trail.assumptions[0]).toMatch(/No volume assumed/);
  });

  it("records the bank's own figures as assumptions it entered", () => {
    const trail = buildAuditTrail({
      feeName: "Overdraft",
      layer,
      layerDates: [],
      ownFeeRows: [],
      clientFigures: { paidItems: 14500, waiverRate: 0.12 },
    });
    expect(trail.evidence).toBe("Market data and your figures");
    expect(trail.assumptions).toEqual([
      "Items charged a year: 14,500, entered by you on this page.",
      "Share waived or refunded: 12%, entered by you on this page.",
    ]);
  });

  it("gives no date range when no dates are known", () => {
    expect(publishedRange([null])).toBeNull();
  });
});
