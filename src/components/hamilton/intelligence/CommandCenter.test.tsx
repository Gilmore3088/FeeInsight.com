import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FinancialPoint } from "@/app/(public)/institution/[id]/financial-history";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: vi.fn() }));
vi.mock("./InstitutionBriefing", () => ({ getQuarterlyChangesOnce: vi.fn(), loadBriefingOnce: vi.fn() }));
vi.mock("@/lib/hamilton/workspace/research", () => ({ COMPETITOR_MOVE_WINDOW_DAYS: 180 }));
vi.mock("@/lib/hamilton/dashboard/command-center-read", () => ({
  readFiledSeries: vi.fn(),
  readBranchCount: vi.fn(),
  readCompetitorFilings: vi.fn(),
  readFeeGroups: vi.fn(),
  readStateChanges: vi.fn(),
  scorecardIds: (b: { localMarket?: { rows: { institutionId: number }[] } } | null) => (b?.localMarket?.rows ?? []).map((r) => r.institutionId),
}));
vi.mock("@/lib/hamilton/coverage-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hamilton/coverage-read")>()),
  readInstitutionCoverage: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { CommandCenter } from "./CommandCenter";
import { getCurrentUser } from "@/lib/auth";
import { getActivePeerSet } from "@/lib/hamilton/active-peer-set";
import { readInstitutionCoverage } from "@/lib/hamilton/coverage-read";
import { readBranchCount, readCompetitorFilings, readFeeGroups, readFiledSeries, readStateChanges } from "@/lib/hamilton/dashboard/command-center-read";
import { getQuarterlyChangesOnce, loadBriefingOnce } from "./InstitutionBriefing";

const institution = { id: 9701940, name: "Harbor Ridge Test Bank", stateCode: "TX", city: "Austin" };

function point(reportDate: string, i: number): FinancialPoint {
  return {
    reportDate, quarter: reportDate, source: "fdic",
    assets: 1_200_000_000 + i * 1_000_000, deposits: 1_000_000_000, loans: null, equity: null, netIncome: null,
    serviceCharges: 500_000 + i * 10_000, roaPct: 1 + i * 0.01, nimPct: 3.5, efficiencyPct: 60 - i * 0.1,
    ncoRatePct: null, noncurrentRatePct: null, tier1Pct: null, loansRealEstate: null, loansCommercial: null, loansConsumer: null,
    loansOther: null, loansCreditCard: null, loansAuto: null, securities: null, depositsCore: null, depositsBrokered: null,
    depositsUninsured: null, provision: null, roePct: null, leveragePct: null, totalCapitalPct: null, employees: null, members: null,
  };
}
const DATES = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"];
const peers = (amounts: number[]) => amounts.map((amount, i) => ({ institutionId: 100 + i, institutionName: `Peer ${i}`, amount, stateCode: "TX", sourceDocumentIds: [], documentUrls: [], publishedAt: null }));

const briefing = {
  institutionId: institution.id, institutionName: institution.name, peerLabel: "Texas banks", observations: [],
  positions: [{ feeCategory: "overdraft", displayName: "Overdraft", current: 35, band: null, peerLabel: "Texas banks" }],
  localMarket: {
    info: { basis: "branch_counties", places: ["Travis County"], sodYear: 2025, institutions: 3, source: { label: "SOD" } },
    rows: [
      { institutionId: institution.id, name: institution.name, own: true, marketDeposits: null, values: { overdraft: 35 } },
      { institutionId: 77, name: "Lakeside Test Bank", own: false, marketDeposits: 1, values: { overdraft: 30 } },
      { institutionId: 78, name: "Frost Bank", own: false, marketDeposits: 1, values: { overdraft: 33 } },
    ],
  },
  provenance: { peerGroup: { label: "Texas banks", n: 38 } },
  generatedAt: "2026-10-27T15:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 7 } as never);
  vi.mocked(getActivePeerSet).mockResolvedValue(null);
  vi.mocked(getQuarterlyChangesOnce).mockResolvedValue(null as never);
  vi.mocked(readFiledSeries).mockResolvedValue(DATES.map(point));
  vi.mocked(readBranchCount).mockResolvedValue(12);
  vi.mocked(readCompetitorFilings).mockResolvedValue(new Map([[77, DATES.map(point)]]));
  vi.mocked(readStateChanges).mockResolvedValue([]);
  vi.mocked(readInstitutionCoverage).mockResolvedValue({
    institutionId: institution.id, institutionName: institution.name, readAt: "2026-10-27T15:00:00Z", fees: 9,
    categories: ["overdraft"], documents: [{ id: 5001, statedDate: "2026-08-01", statedBasis: "effective_statement", statedRead: true }],
    lastVerifiedAt: "2026-10-24T01:20:46Z", peer: null,
  } as never);
  vi.mocked(readFeeGroups).mockResolvedValue({
    state: { label: "institutions in Texas", fees: [{ feeCategory: "overdraft", peers: peers([20, 25, 28, 30, 30, 32, 33, 34, 35, 36, 38]) }] },
    peers: { label: "Texas banks", fees: [{ feeCategory: "overdraft", peers: peers([25, 30, 35]) }] },
    peersSaved: false,
  });
});

async function render() {
  return renderToStaticMarkup(await CommandCenter({ institution }));
}

describe("Command center dashboard (Hamilton redesign)", () => {
  it("opens on the institution with its facts, actions and coverage line", async () => {
    vi.mocked(loadBriefingOnce).mockResolvedValue({ briefing, unavailable: false } as never);
    const html = await render();
    expect(html).toContain("Command center · latest filing Q2 2026");
    expect(html).toContain(">Harbor Ridge Test Bank</h1>");
    expect(html).toContain("Austin, TX");
    expect(html).toContain("12 branches");
    expect(html).toContain('href="/pro/simulate?instId=9701940"');
    expect(html).toContain('href="/pro/reports?intent=executive-briefing&amp;instId=9701940"');
    expect(html).toContain("Peer set: Texas banks, 38 institutions with published fees on file.");
  });

  it("shows four KPI cards that drive the trend chart", async () => {
    vi.mocked(loadBriefingOnce).mockResolvedValue({ briefing, unavailable: false } as never);
    const html = await render();
    for (const label of ["Service charges, last 4 quarters", "Return on assets", "Net interest margin", "Efficiency ratio"]) expect(html).toContain(label);
    expect(html.match(/class="hd-kpi" aria-pressed=/g)).toHaveLength(4);
    expect(html).toContain('aria-pressed="true"><span class="hd-label">Service charges, last 4 quarters');
    expect(html).toContain("Service charges on deposits by quarter");
    expect(html).toContain('role="img"');
  });

  it("compares its fees with the state first, with the peer group a toggle away", async () => {
    vi.mocked(loadBriefingOnce).mockResolvedValue({ briefing, unavailable: false } as never);
    const html = await render();
    expect(html).toContain("Your fees against institutions in Texas");
    expect(html).toContain('role="group" aria-label="Compare with"');
    expect(html).toContain(">Peer group</button>");
    expect(html).toContain("med $32");
    expect(html).toContain("Where you stand");
  });

  it("lists local competitors in the scorecard but never a name the site does not show", async () => {
    vi.mocked(loadBriefingOnce).mockResolvedValue({ briefing, unavailable: false } as never);
    const html = await render();
    expect(html).toContain("Peer scorecard");
    expect(html).toContain("Lakeside Test Bank");
    expect(html).not.toContain("Frost Bank");
  });

  it("links Ask Hamilton into the Ask page and says plainly when nothing changed in the state", async () => {
    vi.mocked(loadBriefingOnce).mockResolvedValue({ briefing, unavailable: false } as never);
    const html = await render();
    expect(html).toContain('action="/pro/analyze"');
    expect(html).toContain('name="instId" value="9701940"');
    expect(html).toContain("/pro/analyze?q=");
    expect(html).toContain("No institution in Texas has a confirmed fee change in the last 180 days.");
  });

  it("says so when reads fail, and the page still renders", async () => {
    vi.mocked(loadBriefingOnce).mockResolvedValue({ briefing: null, unavailable: true } as never);
    vi.mocked(readFiledSeries).mockResolvedValue([]);
    vi.mocked(readInstitutionCoverage).mockRejectedValue(new Error("down"));
    vi.mocked(readStateChanges).mockResolvedValue(null);
    vi.mocked(readFeeGroups).mockResolvedValue({ peers: null, state: null, peersSaved: false });
    const html = await render();
    expect(html).toContain("Coverage for this institution could not be read just now.");
    expect(html).toContain("No filed quarter is on file for Harbor Ridge Test Bank yet");
    expect(html).toContain("Harbor Ridge Test Bank&#x27;s fees could not be compared just now.");
    expect(html).toContain("Fee changes in Texas could not be read just now.");
  });
});
