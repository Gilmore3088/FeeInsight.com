import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FeeEvidence, dollars, findingSentence, plainQuote, workflowLead } from "./landing-workflow";
import { LandingHamilton } from "./landing-hamilton";
import { parseShowcaseAnswer } from "./landing-hamilton-answer";
import { sampleShowcaseRow, sampleWorkflowReport } from "./landing-workflow.test-fixture";

vi.mock("@/components/track-link", () => ({
  TrackLink: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const report = sampleWorkflowReport();
const lead0 = workflowLead(report)!;
const answer0 = parseShowcaseAnswer(sampleShowcaseRow())!;
const html = renderToStaticMarkup(<LandingHamilton report={report} answer={answer0} />);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const evidence = renderToStaticMarkup(<FeeEvidence lead={lead0} />);
const panel = (id: string) => {
  const from = html.indexOf(`data-hamilton-panel="${id}"`);
  const next = html.indexOf("data-hamilton-panel=", from + 1);
  return html.slice(from, next < 0 ? undefined : next);
};

describe("homepage example: one question, one finding, the same fee in the report", () => {
  it("leads with the fee furthest above its local median whose schedule line states it", () => {
    const lead = workflowLead(report)!;
    expect(lead.line.key).toBe("wire_intl_outgoing");
    expect(lead.gap).toBe(25);
    expect(findingSentence(lead)).toBe("Capital City Bank's outgoing international wire fee is $25 above the local median.");
    expect([dollars(75), dollars(2.5)]).toEqual(["$75", "$2.50"]);
  });

  it("never quotes a schedule line that names what the fee excludes", () => {
    expect(plainQuote("wire_intl_outgoing", "Incoming or Outgoing International Wire … $50.00")).toBeNull();
    expect(plainQuote("wire_intl_outgoing", "Outgoing International Wire … $50.00")).toBe("Outgoing International Wire … $50.00");
    const lead = workflowLead(report)!;
    expect(lead.peers.map((p) => p.name)).toEqual(["Wells Fargo Bank, N.A.", "Ameris Bank", "Regions Bank"]);
  });

  it("shows the schedule line behind a fee, with every competitor and its source on request", () => {
    const t = text(evidence);
    expect(t).toContain("$75 $25 above the local median");
    expect(t).toMatch(/Capital City Bank \$75 Local median \$50 Wells Fargo Bank, N\.A\. \$45 Ameris Bank \$50 Regions Bank \$55/);
    expect(t).toContain("From Capital City Bank's fee schedule “Outgoing International Wire … $75.00 ”");
    expect(t).toContain("Read Oct 8, 2026 · Published schedule");
    expect(evidence).toContain('href="https://example.com/323/fee-schedule.pdf"');
    expect(evidence).toMatch(/<details[^>]*data-workflow-more/);
    expect(evidence.match(/data-workflow-peer/g)).toHaveLength(3);
    expect(t).toContain("Truist Bank $50");
    expect(t).not.toMatch(/Incoming/);
  });

  it("follows one institution and the answer's fee through all three steps", () => {
    expect(answer0.feeKey).toBe("overdraft");
    expect(text(html.slice(0, html.indexOf('role="tablist"')))).toContain("Your fees. Your competitors. Your next committee report.");
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(text(html)).toMatch(/Compare your market .*Investigate a difference .*Prepare your report/);
    // Step 1: the institution, its named peers, several fees with counts, the answer's fee selected.
    const one = text(panel("compare"));
    expect(one).toContain("Your institution Capital City Bank");
    expect(one).toContain("Named peers Compared with 21 local competitors");
    expect(one).toContain("Wells Fargo Bank, N.A.");
    expect(one).toContain("Peer group: FL · bank · $1B to $10B · Fed district 6 peers");
    expect(panel("compare").match(/data-selected=""/g)).toHaveLength(1);
    expect(one).toMatch(/Overdraft \(per item\) In Hamilton's answer \$37/);
    // Step 2: the saved answer as asked, with findings, named peers, rules, limits and sources.
    const two = text(panel("investigate"));
    expect(two).toContain("Saved answer · Oct 16, 2026");
    expect(two).toContain("What is Capital City Bank's overdraft fee?");
    expect(two).toMatch(/Peer median \$35 9 institutions Local median \$35 8 institutions/);
    expect(two).toContain("CFPB Circular 2022-06");
    expect(two).not.toContain("Overdraft income was $10 million. Consumer");
    expect(two).toContain("The filings do not show how often the fee is charged or waived.");
    expect(two).toContain("All 8 named competitors");
    expect(two).toContain("Inspectable sources");
    expect(two).not.toMatch(/verified/i);
    // Step 3: the separate sample report, the same fee marked, with its detail.
    const three = panel("report");
    expect(text(three)).toContain("Separate sample report · Competitive Fee Position Report");
    expect(three.match(/data-highlight=""/g)).toHaveLength(1);
    expect(three).toMatch(/data-highlight=""[^>]*>\s*<span[^>]*>Overdraft \(per item\)</);
    expect(text(three)).toContain("Detail · Overdraft");
    // The two actions after the tabs.
    expect(html).toMatch(/href="\/subscribe"[^>]*>See Hamilton plans</);
    expect(html).toMatch(/href="\/reports\/sample-competitive-fee-position"[^>]*>Open the sample report</);
  });

  it("shows no demonstration when the answer and the report are not the same institution's", () => {
    const other = parseShowcaseAnswer(sampleShowcaseRow({ institution_id: "5" }));
    const bare = renderToStaticMarkup(<LandingHamilton report={report} answer={other} />);
    expect(bare).not.toContain('role="tablist"');
    expect(bare).toContain("See Hamilton plans");
    const noFee = parseShowcaseAnswer(sampleShowcaseRow({ title: "Fee position against 9 peers" }));
    expect(renderToStaticMarkup(<LandingHamilton report={report} answer={noFee} />)).not.toContain('role="tablist"');
    expect(renderToStaticMarkup(<LandingHamilton report={null} answer={answer0} />)).not.toContain('role="tablist"');
    // The answer's price must match the report's, or the steps would show two prices.
    const moved = parseShowcaseAnswer(sampleShowcaseRow())!;
    expect(renderToStaticMarkup(<LandingHamilton report={report} answer={{ ...moved, own: 35 }} />)).not.toContain('role="tablist"');
    expect(parseShowcaseAnswer(null)).toBeNull();
    expect(parseShowcaseAnswer({ ...sampleShowcaseRow(), prompt: null })).toBeNull();
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
