import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HamiltonAnswer, ReportPreview, dollars, findingSentence, plainQuote, workflowLead } from "./landing-workflow";
import { sampleWorkflowReport } from "./landing-workflow.test-fixture";

vi.mock("@/components/track-link", () => ({
  TrackLink: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const report = sampleWorkflowReport();
const lead0 = workflowLead(report)!;
const html = renderToStaticMarkup(
  <>
    <HamiltonAnswer lead={lead0} />
    <ReportPreview report={report} lead={lead0} />
  </>,
);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const answer = html.slice(html.indexOf("data-workflow-compare"), html.indexOf("data-workflow-report"));
const reportPart = html.slice(html.indexOf("data-workflow-report"));

describe("homepage example: one question, one finding, the same fee in the report", () => {
  it("leads with the fee furthest above its local median whose schedule line states it", () => {
    const lead = workflowLead(report)!;
    expect(lead.line.key).toBe("wire_intl_outgoing");
    expect(lead.gap).toBe(25);
    expect(findingSentence(lead)).toBe("Capital City Bank's outgoing international wire fee is $25 above the local median.");
    expect([dollars(75), dollars(2.5)]).toEqual(["$75", "$2.50"]);
  });

  it("asks one question and answers it with the bank, the median and three named peers as bars", () => {
    const t = text(html);
    expect(t).toContain("How does our outgoing international wire fee compare with local competitors?");
    const a = text(answer);
    expect(a).toContain("$75 $25 above the local median");
    expect(a).toContain("Local median $50 · 8 local competitors publish this fee · 8 charge less");
    expect(a).toMatch(/Capital City Bank \$75 Local median \$50 Wells Fargo Bank, N\.A\. \$45 Ameris Bank \$50 Regions Bank \$55/);
    // Names wrap rather than being cut.
    expect(answer.slice(0, answer.indexOf("data-workflow-evidence"))).not.toContain("truncate");
    // Labelled as a sample, never as a signed-in screen.
    expect(t).toContain("Hamilton · Sample answer · Capital City Bank");
    expect(html).not.toContain("Hamilton · Research");
  });

  it("never quotes a schedule line that names what the fee excludes", () => {
    expect(plainQuote("wire_intl_outgoing", "Incoming or Outgoing International Wire … $50.00")).toBeNull();
    expect(plainQuote("wire_intl_outgoing", "Outgoing International Wire … $50.00")).toBe("Outgoing International Wire … $50.00");
    const lead = workflowLead(report)!;
    expect(lead.peers.map((p) => p.name)).toEqual(["Wells Fargo Bank, N.A.", "Ameris Bank", "Regions Bank"]);
  });

  it("shows the schedule line behind the answer, with every competitor and its source on request", () => {
    const t = text(answer);
    expect(t).toContain("From Capital City Bank's fee schedule “Outgoing International Wire … $75.00 ”");
    expect(t).toContain("Read Oct 8, 2026 · Published schedule");
    expect(answer).toContain('href="https://example.com/323/fee-schedule.pdf"');
    expect(answer).toMatch(/<details[^>]*data-workflow-more/);
    expect(answer.match(/data-workflow-peer/g)).toHaveLength(3);
    expect(t).toContain("Truist Bank $50");
    expect(t).not.toMatch(/Incoming/);
  });

  it("marks the same fee in the report's first page and links to the whole report", () => {
    const t = text(reportPart);
    expect(t).toContain("Capital City Bank against its local market");
    expect(t).toContain("At a glance");
    expect(t).toContain("4 more fees in the full report");
    expect(t).toMatch(/Of your 7 comparable fees, 2 above the local middle range/);
    expect(reportPart.match(/data-highlight=""/g)).toHaveLength(1);
    expect(reportPart).toMatch(/data-highlight=""[^>]*>\s*<span[^>]*>Outgoing international wire</);
    expect(reportPart).toContain('href="/reports/sample-competitive-fee-position"');
    expect(t).not.toMatch(/Sources and method|Named competitors, same lines/);
  });

  it("finds no lead without a ready sample report", () => {
    expect(workflowLead(null)).toBeNull();
    const notReady = { ...report, analysis: { ...report.analysis, readiness: { ...report.analysis.readiness, ready: false } } };
    expect(workflowLead(notReady)).toBeNull();
  });

  it("keeps the copy free of em-dashes and agent names", () => {
    expect(text(html)).not.toMatch(/—|Atlas|Magellan|Rosetta|Knox|Darwin|Deming|Gutenberg|Frost/);
  });
});
