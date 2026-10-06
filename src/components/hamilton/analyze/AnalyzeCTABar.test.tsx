import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyzeCTABar } from "./AnalyzeCTABar";

describe("AnalyzeCTABar", () => {
  it("preserves selected institution context on the scenario CTA", () => {
    const html = renderToStaticMarkup(
      <AnalyzeCTABar isVisible institutionId="2945" />,
    );

    expect(html).toContain('href="/pro/simulate?instId=2945"');
  });

  it("renders secondary actions as real Hamilton workflow links", () => {
    const html = renderToStaticMarkup(
      <AnalyzeCTABar isVisible institutionId="2945" />,
    );

    expect(html).toContain('href="/pro/research?instId=2945"');
    expect(html).toContain('href="/pro/analyze?intent=risk&amp;instId=2945"');
    expect(html).toContain("Show the Market");
    expect(html).toContain("View Risk Drivers");
  });

  it("carries the analysed fee category into Simulate", () => {
    const html = renderToStaticMarkup(
      <AnalyzeCTABar isVisible institutionId="2945" feeCategory="nsf" />,
    );

    expect(html).toContain('href="/pro/simulate?category=nsf&amp;instId=2945"');
  });

  it("renders nothing before analysis completes", () => {
    const html = renderToStaticMarkup(<AnalyzeCTABar isVisible={false} />);

    expect(html).toBe("");
  });
});
