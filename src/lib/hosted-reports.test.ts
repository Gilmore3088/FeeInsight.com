import { describe, expect, it } from "vitest";
import {
  extractExecutiveSummary,
  extractPositionMap,
  readSampleReportHtml,
  getHostedReport,
  hostedReportRequestHref,
  isHostedReportExpired,
  lookupHostedReport,
  prepareReportForEmbed,
  prepareReportForPrint,
  type HostedReportMap,
} from "./hosted-reports";

const FIXTURE: HostedReportMap = {
  "0123456789abcdef": {
    institution_id: 4802,
    institution_name: "Georgia Heritage Federal Credit Union",
    prepared_on: "2026-08-15",
    expires_on: "2026-11-15",
  },
  "fedcba9876543210": {
    institution_id: 860,
    institution_name: "Bank of the Pacific",
    prepared_on: "2026-05-01",
    expires_on: "2026-08-01",
  },
};

const NOW = new Date("2026-08-17T12:00:00Z");

describe("getHostedReport", () => {
  it("returns null for an unknown token", () => {
    expect(getHostedReport("ffffffffffffffff", { map: FIXTURE, now: NOW })).toBeNull();
  });

  it("returns null for a malformed token without consulting the map", () => {
    expect(getHostedReport("../etc/passwd", { map: FIXTURE, now: NOW })).toBeNull();
    expect(getHostedReport("", { map: FIXTURE, now: NOW })).toBeNull();
    expect(getHostedReport("0123456789ABCDEF", { map: FIXTURE, now: NOW })).toBeNull();
  });

  it("returns null for an expired token", () => {
    expect(getHostedReport("fedcba9876543210", { map: FIXTURE, now: NOW })).toBeNull();
  });

  it("returns the record for a known, unexpired token", () => {
    expect(getHostedReport("0123456789abcdef", { map: FIXTURE, now: NOW })).toEqual({
      token: "0123456789abcdef",
      institution_id: 4802,
      institution_name: "Georgia Heritage Federal Credit Union",
      prepared_on: "2026-08-15",
      expires_on: "2026-11-15",
    });
  });

  it("treats the expiry date itself as still valid", () => {
    const lastDay = new Date("2026-11-15T23:00:00Z");
    expect(getHostedReport("0123456789abcdef", { map: FIXTURE, now: lastDay })).not.toBeNull();
    const dayAfter = new Date("2026-11-16T00:00:00Z");
    expect(getHostedReport("0123456789abcdef", { map: FIXTURE, now: dayAfter })).toBeNull();
  });
});

describe("isHostedReportExpired", () => {
  it("treats a malformed expiry date as expired", () => {
    expect(
      isHostedReportExpired({ ...FIXTURE["0123456789abcdef"], expires_on: "soon" }, NOW),
    ).toBe(true);
  });
});

describe("report HTML preparation", () => {
  const doc = "<html><head><title>x</title></head><body><p>hi</p></body></html>";

  it("injects screen styles before </head>", () => {
    const out = prepareReportForEmbed(doc);
    expect(out.indexOf("data-fee-insight-embed")).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain("<p>hi</p>");
  });

  it("injects an auto-print hook before </body>", () => {
    const out = prepareReportForPrint(doc);
    expect(out.indexOf("window.print()")).toBeLessThan(out.indexOf("</body>"));
  });

  it("balances heading lines in both the embedded and printed report", () => {
    for (const out of [prepareReportForEmbed(doc), prepareReportForPrint(doc)]) {
      expect(out.indexOf("data-fee-insight-wrap")).toBeLessThan(out.indexOf("</head>"));
      expect(out).toContain("text-wrap: balance");
    }
  });
});

describe("formatReportDate", () => {
  it("formats an ISO date without shifting the calendar day", async () => {
    const { formatReportDate } = await import("./hosted-reports");
    expect(formatReportDate("2026-08-16")).toBe("Aug 16, 2026");
    expect(formatReportDate("not-a-date")).toBe("not-a-date");
  });
});

describe("extractExecutiveSummary", () => {
  it("pulls the three findings and the net-position paragraph out of a report", () => {
    const html = `<div class="findings">
      <div class="finding"><div class="num" style="font-size:18pt">$33 vs $15<small>your NSF fee vs peer median</small></div>
   <p><b>Your NSF fee is an outlier.</b>At $33.00 it is 2.2x the median &amp; flagged.</p></div>
      <div class="finding"><div class="num" style="font-size:24pt">$1<small>overdraft</small></div>
   <p><b>Friendly overdraft.</b>Body two.</p></div>
    </div>
    <p class="narrative drop">Net position: bifurcated schedule.</p>`;
    const summary = extractExecutiveSummary(html);
    expect(summary.findings).toHaveLength(2);
    expect(summary.findings[0]).toEqual({
      stat: "$33 vs $15",
      statLabel: "your NSF fee vs peer median",
      headline: "Your NSF fee is an outlier.",
      body: "At $33.00 it is 2.2x the median & flagged.",
    });
    expect(summary.narrative).toBe("Net position: bifurcated schedule.");
  });

  it("returns an empty summary for a document without an executive section", () => {
    expect(extractExecutiveSummary("<html><body>hi</body></html>")).toEqual({ findings: [], narrative: null });
  });
});

describe("extractPositionMap", () => {
  it("keeps only ranked lines and classifies each against the peer middle half", () => {
    const html = `<p>Compared with 60 banks with $300M–$1B in assets</p>
    <table class="position"><thead><tr><th>Fee</th></tr></thead><tbody>
      <tr><td><span class="cat">Non-network ATM</span></td><td class="r"><b>—</b></td>
      <td class="r">$1.25</td><td class="r">$2.13</td><td class="r">$4.31</td><td class="r muted">6</td>
      <td><span class="small muted">listed under another label</span></td><td></td></tr>
      <tr><td><span class="cat">Deposited item return</span><span class="feeline">Returned item</span></td>
      <td class="r"><b>$18.00</b></td><td class="r">$5.00</td><td class="r">$5.00</td><td class="r">$10.00</td>
      <td class="r muted">15</td><td><div class="bar-wrap"></div><span class="small muted"> P100</span></td><td></td></tr>
      <tr><td><span class="cat">Outgoing intl. wire</span></td><td class="r"><b>$40.00</b></td>
      <td class="r">$46.25</td><td class="r">$50.00</td><td class="r">$61.25</td><td class="r muted">8</td>
      <td><span class="small muted"> P25</span></td><td></td></tr>
    </tbody></table>`;
    expect(extractPositionMap(html)).toEqual({
      cohortSize: 60,
      rows: [
        { category: "Deposited item return", you: 18, p25: 5, median: 5, p75: 10, peers: 15, percentile: 100, status: "above" },
        { category: "Outgoing intl. wire", you: 40, p25: 46.25, median: 50, p75: 61.25, peers: 8, percentile: 25, status: "below" },
      ],
    });
  });

  it("reads the committed sample report", () => {
    const map = extractPositionMap(readSampleReportHtml());
    expect(map.rows.length).toBeGreaterThan(3);
    expect(map.cohortSize).toBeGreaterThan(0);
  });

  it("returns no rows when the report has no position map", () => {
    expect(extractPositionMap("<html></html>")).toEqual({ rows: [], cohortSize: null });
  });
});

describe("lookupHostedReport", () => {
  it("tells an expired link from an unknown one", () => {
    expect(lookupHostedReport("fedcba9876543210", { map: FIXTURE, now: NOW })).toMatchObject({
      state: "expired",
      report: { institution_id: 860, institution_name: "Bank of the Pacific" },
    });
    expect(lookupHostedReport("ffffffffffffffff", { map: FIXTURE, now: NOW })).toEqual({ state: "missing" });
    expect(lookupHostedReport("0123456789abcdef", { map: FIXTURE, now: NOW }).state).toBe("ok");
  });

  it("links to the free request form prefilled for the institution", () => {
    expect(hostedReportRequestHref(FIXTURE["fedcba9876543210"], "hosted_report_expired")).toBe(
      "/for-institutions?institution=860&name=Bank+of+the+Pacific&src=hosted_report_expired#report",
    );
  });
});
