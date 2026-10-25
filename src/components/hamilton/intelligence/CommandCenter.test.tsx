import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/hamilton/financial-performance-read", () => ({ readFinancialPerformance: vi.fn() }));
vi.mock("./InstitutionBriefing", () => ({ getQuarterlyChangesOnce: vi.fn(), loadBriefingOnce: vi.fn() }));
vi.mock("@/lib/hamilton/workspace/research", () => ({ COMPETITOR_MOVE_WINDOW_DAYS: 180 }));

import { CommandCenterRow } from "./CommandCenter";

describe("CommandCenterRow (#1891)", () => {
  it("renders the question as a heading, the answer, its source and its links", () => {
    const html = renderToStaticMarkup(
      <CommandCenterRow
        answer={{
          key: "performance",
          question: "How is Harbor Ridge Test Bank doing?",
          lines: ["Deposit service charges in Q2 2026 were $2.0 million."],
          source: "FDIC call report, Q2 2026.",
          links: [{ label: "Financial performance", href: "/pro/financials?instId=9701940" }],
        }}
      />,
    );
    expect(html).toContain('<h2 id="cc-performance"');
    expect(html).toContain("How is Harbor Ridge Test Bank doing?");
    expect(html).toContain("Source: FDIC call report, Q2 2026.");
    expect(html).toContain('href="/pro/financials?instId=9701940"');
  });

  it("shows no source line when the answer states no figure", () => {
    const html = renderToStaticMarkup(
      <CommandCenterRow answer={{ key: "next", question: "What to look at next", lines: ["Nothing stands out."], source: null, links: [] }} />,
    );
    expect(html).not.toContain("Source:");
  });
});
