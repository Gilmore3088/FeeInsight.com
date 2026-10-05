import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InstitutionPositioning } from "@/lib/hamilton/institution-position";
import type { AlertEntry, PositioningEntry, SignalEntry } from "@/lib/hamilton/home-data";
import { HamiltonCommentary } from "./HamiltonCommentary";
import { NationalSnapshot } from "./NationalSnapshot";
import { PositionOverview, headlineFor, positionTone } from "./PositionOverview";
import { mergeChanges, RecentChanges } from "./RecentChanges";
import { rangeDomain } from "./RangeBar";

const positioning: InstitutionPositioning = {
  institutionId: 2945,
  institutionName: "First Bank",
  benchmarkLabel: "community banks",
  benchmarkSource: "selected-institution-default",
  ownFeeCount: 12,
  priority: "high",
  topGap: null,
  entries: [
    { feeCategory: "overdraft", displayName: "Overdraft", yourAmount: 35, benchmarkMedian: 28, benchmarkP25: 25, benchmarkP75: 32, benchmarkCount: 40, maturityTier: "strong", gapAmount: 7, gapPct: 25 },
    { feeCategory: "wire_domestic_outgoing", displayName: "Outgoing domestic wire", yourAmount: 20, benchmarkMedian: 25, benchmarkP25: 20, benchmarkP75: 30, benchmarkCount: 30, maturityTier: "strong", gapAmount: -5, gapPct: -20 },
    { feeCategory: "stop_payment", displayName: "Stop payment", yourAmount: 30, benchmarkMedian: 30, benchmarkP25: 25, benchmarkP75: 32, benchmarkCount: 33, maturityTier: "strong", gapAmount: 0, gapPct: 0 },
  ],
};
positioning.topGap = positioning.entries[0];

describe("PositionOverview", () => {
  it("leads with the largest gap in plain words", () => {
    expect(headlineFor(positioning)).toBe("Overdraft is 25% above the peer median: $35.00 against $28.00.");
  });

  it("counts fees above, in line with and below peers", () => {
    expect(positioning.entries.map(positionTone)).toEqual(["above", "below", "inline"]);
    const html = renderToStaticMarkup(<PositionOverview positioning={positioning} />);
    expect(html).toContain("Fees compared");
    expect(html).toContain('href="/pro/simulate?category=overdraft&amp;instId=2945"');
    expect(html).toContain("12 fees are published for this institution");
  });

  it("says plainly when there is nothing to compare", () => {
    const html = renderToStaticMarkup(
      <PositionOverview positioning={{ ...positioning, entries: [], topGap: null, ownFeeCount: 0 }} />,
    );
    expect(html).toContain("no published fees for First Bank");
  });
});

describe("RangeBar domain", () => {
  it("pads around the values and never goes below zero", () => {
    const [lo, hi] = rangeDomain([25, 28, 32, 35]);
    expect(lo).toBeLessThan(25);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeGreaterThan(35);
    expect(rangeDomain([0, 0])[0]).toBe(0);
  });
});

describe("NationalSnapshot", () => {
  const entry: PositioningEntry = {
    feeCategory: "monthly_maintenance", displayName: "Monthly Maintenance",
    medianAmount: 12, p25Amount: 8, p75Amount: 15, institutionCount: 42, maturityTier: "strong",
  };

  it("shows each spotlight fee with its range and keeps institution context on links", () => {
    const html = renderToStaticMarkup(<NationalSnapshot entries={[entry]} totalInstitutions={3000} selectedInstitutionId="2945" />);
    expect(html).toContain("Most charge $8.00 to $15.00");
    expect(html).toContain("3,000 institutions");
    expect(html).toContain('href="/pro/simulate?category=monthly_maintenance&amp;instId=2945"');
  });

  it("says when the index is unavailable", () => {
    expect(renderToStaticMarkup(<NationalSnapshot entries={[]} totalInstitutions={0} />)).toContain("unavailable");
  });
});

describe("RecentChanges", () => {
  const signal = (id: string, title: string): SignalEntry => ({
    id, signalType: "fee_change", severity: "low", title, body: "body", createdAt: "2026-10-01T00:00:00Z",
  });
  const alert: AlertEntry = {
    id: "a1", signalId: "s1", signalType: "fee_change", severity: "high", title: "Overdraft raised",
    body: "body", status: "active", createdAt: "2026-10-02T00:00:00Z",
  };

  it("puts alerts first and never repeats a signal an alert already covers", () => {
    const items = mergeChanges([alert], [signal("s1", "Overdraft raised"), signal("s2", "New fees published")]);
    expect(items.map((i) => i.title)).toEqual(["Overdraft raised", "New fees published"]);
    expect(items[0].isAlert).toBe(true);
  });

  it("links to Monitor with institution context", () => {
    const html = renderToStaticMarkup(<RecentChanges alerts={[]} signals={[]} selectedInstitutionId="2945" />);
    expect(html).toContain('href="/pro/monitor?instId=2945"');
  });
});

describe("HamiltonCommentary", () => {
  it("never invents text when the commentary is off, and tells admins why", () => {
    const html = renderToStaticMarkup(
      <HamiltonCommentary thesis={null} blockingPolicies={["agent:hamilton"]} isAdmin analyzeHref="/pro/analyze" />,
    );
    expect(html).toContain("commentary is paused");
    expect(html).toContain("agent:hamilton");
  });

  it("hides policy names from customers", () => {
    const html = renderToStaticMarkup(
      <HamiltonCommentary thesis={null} blockingPolicies={["agent:hamilton"]} isAdmin={false} analyzeHref="/pro/analyze" />,
    );
    expect(html).not.toContain("agent:hamilton");
  });
});
