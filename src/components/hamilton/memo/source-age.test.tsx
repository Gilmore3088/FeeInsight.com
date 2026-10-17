// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceChip, sourceDate, sourceDateWithAge } from "./exhibit-view";
import { AuditPanel } from "./memo";
import { StorylineView } from "@/components/hamilton/storyline/StorylineView";
import { sampleStoryline } from "@/components/hamilton/storyline/test-fixture";
import type { AuditTrail } from "@/lib/hamilton/audit-trail";

// Made-up sources for the test; none is live data.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the shared source date says when a source is old", () => {
  it("shows a recent date alone", () => {
    expect(sourceDateWithAge("2026-06-30")).toBe("Jun 2026");
    expect(renderToStaticMarkup(<SourceChip source={{ label: "FDIC call report", asOf: "2026-06-30" }} n={25} />))
      .toContain("FDIC call report · Jun 2026 · n=25");
  });
  it("puts the plain label beside an old date", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(sourceDateWithAge("2024-12-31", now)).toBe("Dec 2024 · Source over a year old");
    expect(renderToStaticMarkup(<SourceChip source={{ label: "Published fee schedule", asOf: "2024-12-31" }} />))
      .toContain("Published fee schedule · Dec 2024 · Source over a year old");
  });
  it("never makes up a date or a label when the date is missing", () => {
    expect(sourceDateWithAge(null)).toBeNull();
    expect(sourceDateWithAge(undefined)).toBeNull();
    // A non-date label is kept as given, with no age label.
    expect(sourceDateWithAge("Q2 2024")).toBe("Q2 2024");
    const chip = renderToStaticMarkup(<SourceChip source={{ label: "Published fee schedule", asOf: null }} />);
    expect(chip).toContain("Published fee schedule");
    expect(chip).not.toMatch(/over a year old|20\d\d/);
    // The plain date formatter stays a date only, for chart axes.
    expect(sourceDate("2024-12-31")).toBe("Dec 2024");
  });
  it("labels old sources in the storyline notes the same way", () => {
    const fresh = renderToStaticMarkup(<StorylineView story={sampleStoryline()} />);
    expect(fresh).toContain("Jun 2026");
    expect(fresh).not.toContain("over a year old");
    const old = JSON.parse(JSON.stringify(sampleStoryline()).replaceAll('"asOf":"2026-06-30"', '"asOf":"2024-06-30"'));
    expect(renderToStaticMarkup(<StorylineView story={old} />)).toContain("Jun 2024 · Source over a year old");
  });
  it("labels old sources and fee lines in How this was built", () => {
    const trail = {
      evidence: "Market data only", peerGroup: null, method: [], assumptions: [], clientFacts: [],
      engineVersion: "test", preparedAt: "2026-10-17",
      sources: [
        { label: "Published fee schedules", detail: "Live fees", asOf: "2024-03-31" },
        { label: "FDIC call reports", detail: "Filings", asOf: "2026-06-30" },
        { label: "Peer filings", detail: "Filings", asOf: null },
      ],
      ownFeeRows: [{ id: 1, feeName: "NSF", amount: 30, publishedAt: "2024-02-01T00:00:00Z", verifiedByEventId: null, documentUrl: null, sourceUrl: null }],
    } as unknown as AuditTrail;
    const html = renderToStaticMarkup(<AuditPanel trail={trail} open />);
    expect(html).toContain("As of Mar 31, 2024 · Source over a year old");
    expect(html).toContain("As of Jun 30, 2026<");
    expect(html).toContain("Date not recorded");
    expect(html).toContain("Published Feb 1, 2024 · Source over a year old");
  });
});
