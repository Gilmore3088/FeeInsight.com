import { describe, expect, it } from "vitest";
import { REPORT_DESIGN_CSS } from "./css";
import { rdDocument, rdExhibit, rdLegend, rdResponsive } from "./html";
import { RD } from "./tokens";
import { CHART } from "@/lib/charts/style";

describe("report design", () => {
  it("renders an exhibit as label, headline, sub-line, legend, panels, notice and source, escaped", () => {
    const html = rdExhibit({
      key: "fees",
      label: "Exhibit 5 · Fees",
      title: "Overdraft <b>differs</b> by $1",
      sub: "Every fee both banks publish.",
      legend: [{ label: "Orrstown", color: RD.terra }],
      panels: [{ heading: "Fees", html: "<svg></svg>" }, { html: "<svg></svg>" }],
      notice: "No fees on file for Mid Penn.",
      source: "Bank Fee Index, Oct 7, 2026.",
    });
    expect(html).toContain('<div class="rd-label">Exhibit 5 · Fees</div>');
    expect(html).toContain("Overdraft &lt;b&gt;differs&lt;/b&gt; by $1");
    expect(html).toContain('class="rd-pair"');
    expect(html.indexOf("rd-sub")).toBeLessThan(html.indexOf("rd-legend"));
    expect(html.indexOf("rd-notice")).toBeLessThan(html.indexOf("rd-source"));
  });

  it("wraps a document in .rd with the header first", () => {
    const html = rdDocument({ eyebrow: "Hamilton", title: "T", deck: null, heroes: [{ figure: "$8.0", unit: "B", label: "Assets" }], exhibits: [] });
    expect(html.startsWith('<div class="rd"><header class="rd-cover">')).toBe(true);
    expect(html).toContain("$8.0<small>B</small>");
  });

  it("shows the narrow drawing only on phones and always prints the wide one", () => {
    expect(rdResponsive("W", "N")).toBe('<div class="sc-wide">W</div><div class="sc-narrow">N</div>');
    expect(rdResponsive(null, "N")).toBeNull();
    expect(REPORT_DESIGN_CSS).toMatch(/@media screen and \(max-width:640px\)\{\s*\.rd \.sc-wide\{display:none\}/);
    expect(REPORT_DESIGN_CSS).toMatch(/@media print\{[\s\S]*\.rd \.sc-narrow\{display:none!important\}/);
    expect(REPORT_DESIGN_CSS).toMatch(/\.rd \.rd-exhibit\{[^}]*break-inside:avoid/);
  });

  it("balances headings and uses the app's loaded fonts before the named ones", () => {
    expect(REPORT_DESIGN_CSS).toContain(".rd h1,.rd h2,.rd h3,.rd h4{text-wrap:balance}");
    expect(REPORT_DESIGN_CSS).toContain("--rd-serif:var(--font-newsreader,\"Newsreader\")");
  });

  it("keeps the old chart imports on the same palette", () => {
    expect(CHART).toBe(RD);
    expect(rdLegend([])).toBe("");
  });
});
