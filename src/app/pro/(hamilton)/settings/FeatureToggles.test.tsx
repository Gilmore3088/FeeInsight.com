import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeatureToggles } from "./FeatureToggles";

describe("FeatureToggles", () => {
  it("renders Hamilton capabilities as real institution-scoped workflow links", () => {
    const html = renderToStaticMarkup(<FeatureToggles selectedInstitutionId="2945" />);

    expect(html).toContain('href="/pro/analyze?instId=2945"');
    expect(html).toContain('href="/pro/hamilton?instId=2945"');
    expect(html).toContain('href="/pro/reports?instId=2945"');
    expect(html).toContain('href="/pro/simulate?instId=2945"');
    expect(html).toContain('href="/pro/monitor?instId=2945"');
    // Plain-English labels, not internal policy jargon.
    expect(html).not.toContain("Evidence gated");
    expect(html).not.toContain("Context scoped");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("visual only");
  });

  it("does not add invalid institution context", () => {
    const html = renderToStaticMarkup(<FeatureToggles selectedInstitutionId="abc" />);

    expect(html).toContain('href="/pro/analyze"');
    expect(html).toContain('href="/pro/reports"');
    expect(html).not.toContain("instId=abc");
  });
});
