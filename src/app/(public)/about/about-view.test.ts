import { describe, expect, it } from "vitest";
import { COVERAGE_LABELS, UNAVAILABLE_LABEL } from "@/lib/public-stats";
import {
  ABOUT_HERO,
  ABOUT_PRODUCTS,
  COVERAGE_NOTES,
  EVIDENCE_STEPS,
  FOUNDER,
  METHODOLOGY_LINK,
  NEUTRALITY,
  REPORT_REQUEST_HREF,
  SAMPLE_REPORT_HREF,
  aboutNextAction,
  aboutProof,
} from "./about-view";

const LIVE = {
  monitored: 8000,
  monitoredLabel: "8,000",
  institutions: 2000,
  institutionsLabel: "2,000",
  observations: 40000,
  observationsLabel: "40,000",
  refreshedOn: "Oct 15, 2026",
};

describe("aboutProof", () => {
  it("shows the three live counts under the shared coverage names", () => {
    const proof = aboutProof(LIVE);
    expect(proof.figures).toEqual([
      { key: "monitored", value: "8,000", label: COVERAGE_LABELS.monitored },
      { key: "institutions", value: "2,000", label: COVERAGE_LABELS.institutions },
      { key: "observations", value: "40,000", label: COVERAGE_LABELS.observations },
    ]);
    expect(proof.publishedShare).toBe(25);
    expect(proof.freshness).toBe("Data refreshed Oct 15, 2026");
  });

  it("hides a count whose read failed instead of showing a dash or a zero", () => {
    const proof = aboutProof({ ...LIVE, institutions: 0, institutionsLabel: UNAVAILABLE_LABEL });
    expect(proof.figures.map((f) => f.key)).toEqual(["monitored", "observations"]);
    expect(proof.publishedShare).toBeNull();
  });

  it("hides a count that read as zero", () => {
    const proof = aboutProof({ ...LIVE, monitored: 0, monitoredLabel: "0" });
    expect(proof.figures.map((f) => f.key)).toEqual(["institutions", "observations"]);
    expect(proof.publishedShare).toBeNull();
  });

  it("shows nothing at all when every read failed", () => {
    const proof = aboutProof({
      monitored: 0,
      monitoredLabel: UNAVAILABLE_LABEL,
      institutions: 0,
      institutionsLabel: UNAVAILABLE_LABEL,
      observations: 0,
      observationsLabel: UNAVAILABLE_LABEL,
      refreshedOn: null,
    });
    expect(proof).toEqual({ figures: [], publishedShare: null, freshness: null });
  });

  it("drops the share when the counts disagree rather than drawing more than 100%", () => {
    expect(aboutProof({ ...LIVE, institutions: 9000, institutionsLabel: "9,000" }).publishedShare).toBeNull();
  });
});

describe("about copy", () => {
  const visible = [
    ...Object.values(ABOUT_HERO),
    ...ABOUT_PRODUCTS.flatMap((p) => [p.name, p.kind, p.role, p.link.label]),
    ...NEUTRALITY,
    ...EVIDENCE_STEPS.flatMap((s) => [s.title, s.line]),
    ...COVERAGE_NOTES.flatMap((n) => [n.term, n.line]),
  ].join(" ");

  it("leads with James's purpose headline and supporting line, without the em-dash", () => {
    expect(ABOUT_HERO.title).toBe("Better banking decisions start with a clearer picture.");
    expect(ABOUT_HERO.lede).toBe(
      "Fee Insight connects published bank fees, financial performance and market context to help banks and credit unions understand where they stand and what deserves a closer look.",
    );
  });

  it("shows the Bank Fee Index and Hamilton together, with their role lines and links", () => {
    expect(ABOUT_PRODUCTS.map((p) => p.name)).toEqual(["The Bank Fee Index", "Hamilton"]);
    expect(ABOUT_PRODUCTS[1].kind).toBe("The Fee Insight workspace");
    expect(ABOUT_PRODUCTS[0].role).toContain("with links to their source schedules");
    expect(ABOUT_PRODUCTS[1].link).toEqual({ href: "/subscribe", label: "See Hamilton plans" });
  });

  it("limits the no-recommendation line to the public index", () => {
    expect(NEUTRALITY.join(" ")).toBe(
      "The Bank Fee Index reports published fees without recommending a price. Hamilton helps banking teams evaluate their options, with sources and limitations made clear.",
    );
    expect(visible).not.toMatch(/never advises/i);
  });

  it("keeps the evidence claims as the page made them", () => {
    expect(EVIDENCE_STEPS.map((s) => s.line).join(" ")).toBe(
      "Every fee is read from the institution's own fee schedule. Medians use only fees traced to a saved copy of that schedule. Fee Insight is independent of the institutions it covers.",
    );
    expect(METHODOLOGY_LINK).toEqual({ href: "/methodology", label: "Read the methodology" });
  });

  it("says what monitored and data refreshed mean", () => {
    expect(COVERAGE_NOTES.map((n) => n.term)).toEqual(["Monitored", "With published fees", "Data refreshed"]);
    expect(COVERAGE_NOTES[0].line).toContain("FDIC and NCUA records");
    expect(COVERAGE_NOTES[2].line).toContain("not the date every schedule was last checked");
  });

  it("keeps the copy free of em-dashes, digits, employers and pipeline agents", () => {
    expect(visible).not.toMatch(/\u2014/);
    expect(visible).not.toMatch(/\d/);
    expect(visible).not.toMatch(/James|Frost|Velocity|CSI|Atlas|Magellan|Rosetta|Knox|Darwin|Deming/);
  });
});

describe("FOUNDER", () => {
  it("names the founder without an employer or an em-dash", () => {
    expect(FOUNDER.line).toBe("Fee Insight is built and run by James Gilmore, a banking data analyst.");
    expect(Object.values(FOUNDER).join(" ")).not.toMatch(/\u2014|Velocity|CSI|Frost/);
  });
});

describe("aboutNextAction", () => {
  it("points at the sample report when it is live", () => {
    expect(aboutNextAction(true)).toEqual({ href: SAMPLE_REPORT_HREF, label: "See the sample report", event: "see_sample_report" });
  });

  it("falls back to the institution report request, tagged as from /about", () => {
    expect(aboutNextAction(false)).toEqual({
      href: "/reports?report=institution&src=about#request",
      label: "Request your institution report",
      event: "request_report_click",
    });
    expect(REPORT_REQUEST_HREF).toContain("src=about");
  });
});
