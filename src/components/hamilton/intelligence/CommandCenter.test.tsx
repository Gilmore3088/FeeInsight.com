import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/hamilton/financial-performance-read", () => ({ readFinancialPerformance: vi.fn() }));
vi.mock("./InstitutionBriefing", () => ({ getQuarterlyChangesOnce: vi.fn(), loadBriefingOnce: vi.fn() }));
vi.mock("@/lib/hamilton/workspace/research", () => ({ COMPETITOR_MOVE_WINDOW_DAYS: 180 }));
vi.mock("@/lib/hamilton/coverage-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hamilton/coverage-read")>()),
  readInstitutionCoverage: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { CommandCenter, CommandCenterRow } from "./CommandCenter";
import { getCurrentUser } from "@/lib/auth";
import { readFinancialPerformance } from "@/lib/hamilton/financial-performance-read";
import { readInstitutionCoverage } from "@/lib/hamilton/coverage-read";
import { getQuarterlyChangesOnce, loadBriefingOnce } from "./InstitutionBriefing";

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

describe("CommandCenter coverage line (#1891, V5 §4A)", () => {
  const institution = { id: 9701940, name: "Harbor Ridge Test Bank", stateCode: "TX" };
  const fees = {
    institutionId: 9701940, institutionName: "Harbor Ridge Test Bank", readAt: "2026-10-27T15:00:00Z", fees: 9,
    categories: ["overdraft", "nsf", "monthly_maintenance"], documents: [{ id: 5001, statedDate: "2026-08-01", statedBasis: "effective_statement" }],
    lastVerifiedAt: "2026-10-24T01:20:46Z", peer: null,
  };

  async function render() {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(readFinancialPerformance).mockResolvedValue({ view: null } as never);
    vi.mocked(getQuarterlyChangesOnce).mockResolvedValue(null as never);
    return renderToStaticMarkup(await CommandCenter({ institution }));
  }

  it("sits under the header with the briefing's peer set and size", async () => {
    vi.mocked(loadBriefingOnce).mockResolvedValue({
      briefing: { peerLabel: "Texas banks", positions: [], observations: [], provenance: { peerGroup: { label: "Texas banks", n: 38 } }, generatedAt: "2026-10-27T15:00:00Z" },
      unavailable: false,
    } as never);
    vi.mocked(readInstitutionCoverage).mockResolvedValue(fees);
    const html = await render();
    expect(html).toContain("9 published fees on file across 3 fee types, read from its fee schedule dated Aug 1, 2026.");
    expect(html).toContain("Peer set: Texas banks, 38 institutions with published fees on file.");
    expect(html.indexOf("Coverage and freshness")).toBeLessThan(html.indexOf('id="cc-performance"'));
  });

  it("says so when the coverage read fails, and the five answers still show", async () => {
    vi.mocked(loadBriefingOnce).mockResolvedValue({ briefing: null, unavailable: true } as never);
    vi.mocked(readInstitutionCoverage).mockRejectedValue(new Error("down"));
    const html = await render();
    expect(html).toContain("Coverage for this institution could not be read just now.");
    expect(html).toContain('id="cc-next"');
  });
});
