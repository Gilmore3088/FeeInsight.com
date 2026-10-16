import { describe, expect, it } from "vitest";
import { COVERAGE_LABELS, UNAVAILABLE_LABEL } from "@/lib/public-stats";
import { ABOUT_BLOCKS, FOUNDER, REPORT_REQUEST_HREF, SAMPLE_REPORT_HREF, aboutNextAction, aboutProof } from "./about-view";

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

describe("ABOUT_BLOCKS", () => {
  it("has three blocks, and the honesty block links to the methodology", () => {
    expect(ABOUT_BLOCKS.map((b) => b.id)).toEqual(["publish", "audience", "honest"]);
    expect(ABOUT_BLOCKS[2].link).toEqual({ href: "/methodology", label: "Read the methodology" });
  });

  it("keeps the copy free of em-dashes, digits and people", () => {
    const text = ABOUT_BLOCKS.flatMap((b) => [b.eyebrow, b.title, ...b.lines]).join(" ");
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/James|Hamilton|Frost|Velocity|CSI/);
  });

  it("does not claim every fee links to its source", () => {
    expect(ABOUT_BLOCKS[0].lines.join(" ")).toBe(
      "Every fee is read from the institution's own schedule, and medians use only fees traced to a stored copy.",
    );
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
