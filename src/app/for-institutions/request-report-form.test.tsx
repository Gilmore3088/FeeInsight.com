// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// On the live page useSearchParams suspends for a moment, so React streams the Suspense
// fallback and then the loaded form, and the HTML carries both copies (#1168).
let suspend = false;
let query = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    if (suspend) throw new Promise(() => {});
    return new URLSearchParams(query);
  },
}));

import { RequestReportForm } from "./request-report-form";

function reportIds(html: string): string[] {
  return [...html.matchAll(/\sid="(report-[^"]+)"/g)].map((m) => m[1]);
}

function render(suspended: boolean): string {
  suspend = suspended;
  return renderToString(<RequestReportForm contactEmail="hello@example.com" />);
}

describe("RequestReportForm ids", () => {
  it("gives the fallback copy and the loaded copy different ids", () => {
    const fallback = render(true);
    const loaded = render(false);
    expect(fallback).toContain('aria-label="Request a fee report"');
    expect(loaded).toContain('aria-label="Request a fee report"');

    const fallbackIds = reportIds(fallback);
    const loadedIds = reportIds(loaded);
    expect(loadedIds).toContain("report-email-free");
    expect(fallbackIds).toContain("report-email-free-fallback");
    const all = [...fallbackIds, ...loadedIds];
    expect(new Set(all).size).toBe(all.length);

    // Each label still points at its own copy's field.
    expect(fallback).toContain('for="report-email-free-fallback"');
    expect(fallback).toContain('aria-describedby="report-email-free-note-fallback"');
    expect(loaded).toContain('for="report-email-free"');
  });
});

describe("RequestReportForm report type", () => {
  function checkedValue(html: string): string | undefined {
    return html.match(/<input[^>]*type="radio"[^>]*>/g)?.find((tag) => /\schecked=""/.test(tag))?.match(/value="([^"]+)"/)?.[1];
  }

  it("starts on the page's default and lets ?report= override it", () => {
    suspend = false;
    query = "";
    const byDefault = renderToString(<RequestReportForm contactEmail="hello@example.com" defaultReportType="institution" />);
    expect(checkedValue(byDefault)).toBe("institution");
    query = "report=national";
    const overridden = renderToString(<RequestReportForm contactEmail="hello@example.com" defaultReportType="institution" />);
    expect(checkedValue(overridden)).toBe("national");
    query = "";
  });
});

describe("RequestReportForm offers", () => {
  it("shows only the paid institution report when offer is institution", () => {
    suspend = false;
    query = "";
    const html = renderToString(<RequestReportForm contactEmail="hello@example.com" offer="institution" />);
    expect(html).not.toContain("Which report?");
    expect(html).toContain("Request your institution report");
  });

  it("offers national and district reports when offer is free, with its own ids", () => {
    suspend = false;
    query = "";
    const free = renderToString(<RequestReportForm contactEmail="hello@example.com" offer="free" idScope="-free" />);
    const paid = renderToString(<RequestReportForm contactEmail="hello@example.com" offer="institution" />);
    expect(free).toContain("Which report?");
    expect(free).toContain("National");
    expect(free).toContain("Fed district");
    const ids = [...reportIds(free), ...reportIds(paid)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
