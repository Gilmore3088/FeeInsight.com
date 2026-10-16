import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandingWorkflow, workflowFinding, workflowMarket } from "./landing-workflow";
import { sampleWorkflowReport } from "./landing-workflow.test-fixture";

vi.mock("@/components/track-link", () => ({
  TrackLink: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const report = sampleWorkflowReport();
const html = renderToStaticMarkup(<LandingWorkflow report={report} />);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const panel = (key: string) => html.match(new RegExp(`data-sample="${key}"[^>]*>(.*?)(?=<div[^>]*data-sample="|$)`, "s"))?.[1] ?? "";

describe("homepage workflow: one institution, compare, inspect, report", () => {
  it("names the sample institution once and walks three steps, the first open", () => {
    expect(text(html)).toContain("Sample institution: Capital City Bank, Tallahassee, FL, with live figures from the Bank Fee Index.");
    const tabs = [...html.matchAll(/aria-selected="(true|false)"[^>]*data-sample-tab="(\w+)"/g)].map(([, on, key]) => `${key}:${on}`);
    expect(tabs).toEqual(["compare:true", "inspect:false", "report:false"]);
    expect(html).toMatch(/hidden=""[^>]*data-sample="inspect"/);
    expect(html).toMatch(/hidden=""[^>]*data-sample="report"/);
  });

  it("builds Hamilton's local competitors table from the report's own named competitors", () => {
    const market = workflowMarket(report)!;
    expect(market.rows[0]).toMatchObject({ name: "Capital City Bank", own: true });
    expect(market.rows.slice(1).map((r) => r.name)).toEqual(report.analysis.named.map((c) => c.institution_name.replace(", National Association", ", N.A.")));
    expect(market.rows[1].values.overdraft).toBe(35);
    const t = text(panel("compare"));
    expect(t).toContain("Hamilton · Research");
    expect(t).toContain("Your institution: Capital City Bank");
    expect(t).toContain("Capital City Bank's local competitors");
    expect(t).toContain("Wells Fargo Bank, N.A.");
    expect(t).toContain("Overdraft (per item): Capital City Bank charges $37.00. 8 of 8 local competitors charge less; the local median is $34.50.");
  });

  it("gives phones the finding's fee and one more, at full size, with no deposits column", () => {
    const phone = panel("compare").match(/<div class="sm:hidden">([\s\S]*)/)![1];
    const heads = [...phone.matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map(([, h]) => h);
    expect(heads[0]).toBe("Institution");
    expect(heads).toContain("Overdraft");
    expect(heads).toHaveLength(3);
    expect(heads).not.toContain("Local deposits");
    expect(html.match(/id="compare-wide"/g)).toHaveLength(1);
    expect(html.match(/id="compare-phone"/g)).toHaveLength(1);
  });

  it("opens the finding to the schedule wording, read date and source, beside named competitors", () => {
    const finding = workflowFinding(report)!;
    expect(finding.line.key).toBe("overdraft");
    expect(finding.quote).toBe("Overdraft Fee (per item) … $37.00");
    const t = text(panel("inspect"));
    expect(t).toContain("Capital City Bank · Overdraft (per item) $37.00");
    expect(t).toContain("Above local range · local median $34.50");
    expect(t).toContain("“Overdraft Fee (per item) … $37.00”");
    expect(t).toContain("Read Oct 8, 2026 · Published schedule");
    expect(panel("inspect")).toContain('href="https://example.com/323/fee-schedule.pdf"');
    expect(t).toContain("Wells Fargo Bank, N.A. $35.00 $2.00 less");
    expect(panel("inspect").match(/data-workflow-peer/g)).toHaveLength(3);
  });

  it("shows the sample report itself, cropped and inert, with a link to the whole report", () => {
    const p = panel("report");
    expect(p).toMatch(/<div inert="" class="p-4/);
    expect(text(p)).toContain("Capital City Bank against its local market");
    expect(text(p)).toContain("What stands out");
    expect(p).toContain('href="/reports/sample-competitive-fee-position"');
    expect(text(p)).toContain("Open full example");
  });

  it("is left out when there is no ready sample report", () => {
    expect(renderToStaticMarkup(<LandingWorkflow report={null} />)).toBe("");
    const notReady = { ...report, analysis: { ...report.analysis, readiness: { ...report.analysis.readiness, ready: false } } };
    expect(renderToStaticMarkup(<LandingWorkflow report={notReady} />)).toBe("");
  });

  it("keeps the page's own copy free of em-dashes and agent names", () => {
    const own = html.replace(/<div inert=""[\s\S]*?(?=<div aria-hidden="true" class="pointer-events-none)/, "");
    expect(text(own)).not.toMatch(/—|Atlas|Magellan|Rosetta|Knox|Darwin|Deming|Gutenberg|Frost/);
  });
});
