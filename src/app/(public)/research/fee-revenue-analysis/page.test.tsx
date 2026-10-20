import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeeRevenueCorrelation } from "@/lib/data-store/fee-revenue";
import { buildFeeRevenueResearch, previewFeeRevenueResearch } from "@/lib/data-store/fee-revenue-research";

const mocks = vi.hoisted(() => ({ user: vi.fn(), premium: vi.fn(), research: vi.fn(), oldRows: vi.fn(), oldTiers: vi.fn(), oldCharters: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium }));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getFeeRevenueResearchCached: mocks.research,
  getFeeRevenueDataCached: mocks.oldRows,
  getTierFeeRevenueSummaryCached: mocks.oldTiers,
  getCharterFeeRevenueSummaryCached: mocks.oldCharters,
}));
vi.mock("@/components/breadcrumb-jsonld", () => ({ BreadcrumbJsonLd: () => null }));
vi.mock("@/components/upgrade-gate", () => ({ UpgradeGate: ({ message }: { message: string }) => <p>Upgrade: {message}</p> }));
import Page, { metadata } from "./page";

function rows(source: "fdic" | "ncua", count: number, overrides: Partial<FeeRevenueCorrelation> = {}): FeeRevenueCorrelation[] {
  return Array.from({ length: count }, (_, index) => ({ institution_id: (source === "fdic" ? 100 : 200) + index,
    institution_name: `${source === "fdic" ? "Bank" : "Credit Union"} ${index + 1}`, charter_type: source === "fdic" ? "bank" : "credit_union",
    state_code: "VA", regulatory_status: null, asset_size_tier: "regional", financial_source: source,
    report_date: "2026-06-30", total_assets: 20000000, service_charge_income: (index + 1) * 100,
    fee_income_ratio: 9999, avg_fee: source === "fdic" ? 20 : 40, fee_count: 3, median_overdraft: null, ...overrides }));
}
async function pageFrom(input: FeeRevenueCorrelation[]) {
  mocks.research.mockResolvedValue(previewFeeRevenueResearch(buildFeeRevenueResearch(input)));
  return new DOMParser().parseFromString(renderToStaticMarkup(await Page()), "text/html");
}
function stat(section: Element, name: string): string | null | undefined {
  return [...section.querySelectorAll("dt")].find((node) => node.textContent === name)?.nextElementSibling?.textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: 1 });
  mocks.premium.mockReturnValue(true);
});

describe("source/date financial research page (#2330)", () => {
  it("uses one shared cohort model and keeps each regulator's summary, tiers and ranking separate", async () => {
    const stale = rows("fdic", 1, { institution_id: 199, institution_name: "Older Bank", report_date: "2026-03-31", service_charge_income: 9999999 });
    const doc = await pageFrom([...rows("fdic", 6), ...rows("ncua", 5, { service_charge_income: 1000 }), ...stale]);
    const bank = doc.querySelector('section[aria-labelledby="fdic-heading"]')!;
    const cu = doc.querySelector('section[aria-labelledby="ncua-heading"]')!;
    expect(stat(bank, "Matched institutions")).toBe("6");
    expect(stat(bank, "Mean listed fee")).toBe("$20.00");
    expect(stat(bank, "Mean quarterly deposit charges")).toBe("$350K");
    expect(stat(cu, "Mean listed fee")).toBe("$40.00");
    expect(stat(cu, "Mean quarterly fee income")).toBe("$1.0M");
    expect(bank.querySelector("time")?.dateTime).toBe("2026-06-30");
    expect(bank.textContent).toContain("1 institution with an older matched filing is excluded");
    expect(bank.textContent).not.toContain("Credit Union 1");
    expect(cu.textContent).not.toContain("Bank 1");
    expect(doc.body.textContent).not.toContain("Older Bank");
    expect(bank.querySelectorAll('a[href^="/institution/"]')).toHaveLength(6);
    expect(cu.querySelectorAll('a[href^="/institution/"]')).toHaveLength(5);
    expect(bank.textContent).toContain("$20.0B"); // Filed assets were $20,000,000 in stored thousands.
    expect(doc.body.textContent).toContain("not annualized and is not a share of revenue");
    expect(doc.body.textContent).toContain("not a like-for-like fee-price benchmark");
    expect(doc.body.textContent).toContain("financial filing quarter, not a historical fee-price snapshot");
    expect(doc.body.textContent).toContain("do not establish peer growth");
    expect(mocks.research).toHaveBeenCalledTimes(1);
    expect(mocks.oldRows).not.toHaveBeenCalled();
    expect(mocks.oldTiers).not.toHaveBeenCalled();
    expect(mocks.oldCharters).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("shows a bounded ranking while keeping means and counts from the whole filing cohort", async () => {
    const doc = await pageFrom(rows("fdic", 60).map((row, index) => ({ ...row, service_charge_income: (index + 1) * 100 - 50 })));
    const bank = doc.querySelector('section[aria-labelledby="fdic-heading"]')!;
    expect(stat(bank, "Matched institutions")).toBe("60");
    expect(stat(bank, "Mean quarterly deposit charges")).toBe("$3.0M"); // All 60 institutions average $3M; the displayed top 50 average $3.5M.
    expect(bank.textContent).toContain("Showing 50 of 60 institutions with usable assets");
    expect(bank.querySelectorAll('a[href^="/institution/"]')).toHaveLength(50);
    expect(bank.querySelector('a[href="/institution/159"]')?.textContent).toBe("Bank 60");
    expect(bank.querySelector('a[href="/institution/100"]')).toBeNull();
    const ranks = [...bank.querySelectorAll('table')][1].querySelectorAll('tbody tr td:first-child');
    expect(ranks[0].textContent).toBe("1");
    expect(ranks[49].textContent).toBe("50");
  });

  it("keeps the newest thin quarter without filling means or ranks from older institutions", async () => {
    const older = rows("ncua", 5, { report_date: "2026-03-31" });
    const doc = await pageFrom([...older, ...rows("ncua", 4, { institution_id: 500, report_date: "2026-06-30" }).map((row, index) => ({ ...row, institution_id: 500 + index }))]);
    const cu = doc.querySelector('section[aria-labelledby="ncua-heading"]')!;
    expect(cu.querySelector("time")?.dateTime).toBe("2026-06-30");
    expect(stat(cu, "Matched institutions")).toBe("4");
    expect(stat(cu, "Mean quarterly fee income")).toBe("Unavailable");
    expect(cu.querySelectorAll('a[href^="/institution/"]')).toHaveLength(0);
    expect(cu.textContent).toContain("Aggregate means are unavailable; older quarters are not substituted");
    expect(doc.querySelector('section[aria-labelledby="fdic-heading"]')).toBeNull();
    expect(doc.body.textContent).toContain("Bank deposit service charges: no usable matched filing cohort is available");
  });

  it("distinguishes genuine zero amounts from missing denominators", async () => {
    const doc = await pageFrom(rows("fdic", 5, { service_charge_income: 0, avg_fee: 0, total_assets: null }));
    const bank = doc.querySelector('section[aria-labelledby="fdic-heading"]')!;
    expect(stat(bank, "Mean listed fee")).toBe("$0.00");
    expect(stat(bank, "Mean quarterly deposit charges")).toBe("$0");
    expect(bank.textContent).toContain("Assets unavailable");
    expect(bank.textContent).toContain("0 with assets");
    expect(bank.querySelectorAll('a[href^="/institution/"]')).toHaveLength(0);
  });

  it("does not manufacture zero summaries when no source/date cohort exists", async () => {
    const doc = await pageFrom([]);
    expect(doc.body.textContent).toContain("Missing financial data is not shown as zero");
    expect(doc.querySelectorAll("dl")).toHaveLength(0);
  });

  it("preserves the premium gate before any research read", async () => {
    mocks.premium.mockReturnValue(false);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Upgrade: Fee-to-revenue analysis");
    expect(mocks.research).not.toHaveBeenCalled();
    expect(mocks.oldRows).not.toHaveBeenCalled();
    expect(mocks.oldTiers).not.toHaveBeenCalled();
    expect(mocks.oldCharters).not.toHaveBeenCalled();
  });
});
