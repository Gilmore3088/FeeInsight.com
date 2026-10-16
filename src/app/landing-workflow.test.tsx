import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandingWorkflow, dollars, findingSentence, plainQuote, workflowLead } from "./landing-workflow";
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
const panel = (key: string) => html.match(new RegExp(`data-sample="${key}"[^>]*>([\\s\\S]*?)(?=<div[^>]*data-sample="|$)`))?.[1] ?? "";

describe("homepage live samples: one institution, one finding per visual", () => {
  it("leads with the fee furthest above its local median whose schedule line states it", () => {
    const lead = workflowLead(report)!;
    expect(lead.line.key).toBe("wire_intl_outgoing");
    expect(lead.gap).toBe(25);
    expect(findingSentence(lead)).toBe("Capital City Bank's outgoing international wire fee is $25 above the local median.");
    expect([dollars(75), dollars(2.5)]).toEqual(["$75", "$2.50"]);
  });

  it("opens on Compare: the finding, the bank against the median and three named peers as bars", () => {
    const tabs = [...html.matchAll(/aria-selected="(true|false)"[^>]*data-sample-tab="(\w+)"/g)].map(([, on, key]) => `${key}:${on}`);
    expect(tabs).toEqual(["compare:true", "inspect:false", "report:false"]);
    const t = text(panel("compare"));
    expect(t).toContain("Capital City Bank's outgoing international wire fee is $25 above the local median.");
    expect(t).toContain("$75 against a local median of $50");
    expect(t).toContain("8 local competitors publish this fee");
    expect(t).toMatch(/Capital City Bank \$75 Local median \$50 Wells Fargo Bank, N\.A\. \$45 Ameris Bank \$50 Regions Bank \$55/);
    // The full comparison opens on request, every named competitor in it.
    expect(panel("compare")).toMatch(/<details[^>]*data-workflow-more/);
    expect(t).toContain("View the full comparison");
    expect(t).toContain("Truist Bank $50");
    // No signed-in product claim on a frame.
    expect(html).not.toContain("Hamilton · Research");
    expect(t).toContain("Capital City Bank · live sample");
  });

  it("never quotes a schedule line that names what the fee excludes", () => {
    expect(plainQuote("wire_intl_outgoing", "Incoming or Outgoing International Wire … $50.00")).toBeNull();
    expect(plainQuote("wire_intl_outgoing", "Outgoing International Wire … $50.00")).toBe("Outgoing International Wire … $50.00");
    const lead = workflowLead(report)!;
    expect(lead.peers.map((p) => p.name)).toEqual(["Wells Fargo Bank, N.A.", "Ameris Bank", "Regions Bank"]);
  });

  it("Inspect shows the fee and the exact schedule line, with other sources on request", () => {
    const p = panel("inspect");
    const t = text(p);
    expect(t).toContain("Capital City Bank · Outgoing international wire $75");
    expect(t).toContain("From its fee schedule “Outgoing International Wire … $75.00 ”");
    expect(t).toContain("Read Oct 8, 2026 · Published schedule");
    expect(p).toContain('href="https://example.com/323/fee-schedule.pdf"');
    expect(p).toMatch(/<details[^>]*data-workflow-more/);
    expect(p.match(/data-workflow-peer/g)).toHaveLength(3);
    expect(t).not.toMatch(/Incoming/);
  });

  it("Report shows the report's first page and links to the whole report", () => {
    const p = panel("report");
    const t = text(p);
    expect(t).toContain("Capital City Bank against its local market");
    expect(t).toContain("At a glance");
    expect(t).toMatch(/Of your 7 comparable fees, 2 above the local middle range/);
    expect(p).toContain('href="/reports/sample-competitive-fee-position"');
    expect(t).not.toMatch(/Sources and method|Named competitors, same lines/);
  });

  it("is left out without a ready sample report", () => {
    expect(renderToStaticMarkup(<LandingWorkflow report={null} />)).toBe("");
    const notReady = { ...report, analysis: { ...report.analysis, readiness: { ...report.analysis.readiness, ready: false } } };
    expect(renderToStaticMarkup(<LandingWorkflow report={notReady} />)).toBe("");
  });

  it("keeps the copy free of em-dashes and agent names", () => {
    expect(text(html)).not.toMatch(/—|Atlas|Magellan|Rosetta|Knox|Darwin|Deming|Gutenberg|Frost/);
  });
});
