// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import { REPORT_OFFER } from "@/lib/constants";
import { RequestReportForm, institutionReportHref } from "./request-report-form";

/** The <label> around the radio with this value. */
function optionLabel(html: string, value: string): string {
  const at = html.indexOf(`value="${value}"`);
  const start = html.lastIndexOf("<label", at);
  return html.slice(start, html.indexOf("</label>", at));
}

describe("RequestReportForm paid option (#1162)", () => {
  const html = renderToString(<RequestReportForm contactEmail="hello@example.com" />);

  it("shows the paid report as available, with its price and no lock", () => {
    const paid = optionLabel(html, "institution");
    expect(paid).toContain(REPORT_OFFER.priceLabel);
    expect(paid).not.toMatch(/border-dashed|lucide-lock|text-ink-soft/);
    expect(html).not.toContain("lucide-lock");
  });

  it("draws the paid option like the free ones when neither is picked", () => {
    const district = renderToString(<RequestReportForm contactEmail="hello@example.com" />);
    const cls = (label: string) => label.match(/^<label class="([^"]*)"/)?.[1];
    // The form opens on the national report here, so the paid and district options are both unpicked.
    expect(cls(optionLabel(district, "institution"))).toBe(cls(optionLabel(district, "district")));
  });
});

describe("institution report links (#1171)", () => {
  it("go to the one request form on /reports", () => {
    expect(institutionReportHref(null)).toBe("/reports?report=institution#request");
    expect(institutionReportHref({ institutionId: 323, institutionName: "Capital City Bank", src: "x" })).toBe(
      "/reports?report=institution&institution=323&name=Capital+City+Bank&src=x#request",
    );
  });
});
