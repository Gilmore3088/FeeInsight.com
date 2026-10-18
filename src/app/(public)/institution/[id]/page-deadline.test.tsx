import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

/**
 * #1919: on Oct 18 a saturated connection pool queued every query, and the institution page
 * waited on them until Vercel killed it at 300 seconds. These tests hold the database reads
 * open forever and check that the page and its metadata answer within their budgets.
 */
const db = vi.hoisted(() => ({
  institution: vi.fn(),
  fees: vi.fn(),
  rateFees: vi.fn(),
  financials: vi.fn(),
  branchFootprint: vi.fn(),
  complaints: vi.fn(),
  holdingCompany: vi.fn(),
  enforcement: vi.fn(),
  regulator: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("./profile-serif-font", () => ({ profileSerif: { variable: "serif" } }));
vi.mock("@/lib/data-store", () => ({
  getPublicInstitutionById: db.institution,
  getFeesByInstitution: db.fees,
  getFinancialsByInstitution: db.financials,
}));
vi.mock("@/lib/data-store/rate-fees", () => ({ getRateFeesByInstitution: db.rateFees }));
vi.mock("@/lib/data-store/registry-profile", () => ({
  getBranchFootprint: db.branchFootprint,
  getComplaintTrend: db.complaints,
  getHoldingCompanyProfile: db.holdingCompany,
  getEnforcementRecord: db.enforcement,
  getRegulatorInfo: db.regulator,
}));
vi.mock("@/lib/data-store/financial", () => ({
  getFinancialHistory: vi.fn(async () => []),
  getPeerFinancialMedians: vi.fn(async () => null),
  getPeerPercentiles: vi.fn(async () => null),
}));
vi.mock("@/lib/data-store/regulatory-watch", () => ({ getRegulatoryWatch: vi.fn(async () => null) }));
vi.mock("@/lib/data-store/institution", () => ({ getInstitutionFeeScheduleEvidence: vi.fn(async () => null) }));
vi.mock("@/lib/data-store/alerts", () => ({ getAlertSubscriptionForInstitution: vi.fn(async () => null) }));
vi.mock("@/lib/data-store/public-cached-reads", () => ({ getComparableMarketIndexCached: vi.fn(async () => []) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/lib/custom-report/sample-report", () => ({ sampleReportAvailable: vi.fn(async () => false) }));
const shortenPageLife = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/data-store/public-read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/public-read-cache")>()),
  shortenPageLife,
}));

import { generateMetadata } from "./page";
import { InstitutionProfile } from "./profile-page";
import InstitutionLayout from "./layout";
import { degradedMetadata, LAYOUT_READ_BUDGET_MS, METADATA_READ_BUDGET_MS, PAGE_READ_BUDGET_MS } from "./profile-budget";
import { ReadDeadlineError } from "@/lib/read-deadline";

const WAFD = {
  id: 82,
  institution_name: "WaFd Bank",
  city: "SEATTLE",
  state_code: "WA",
  charter_type: "bank",
  asset_size: 30_000_000,
  asset_size_tier: "large_regional",
  fed_district: 12,
  fee_count: 0,
  provisional_fee_count: 0,
  fee_schedule_url: null,
  website_url: "https://www.wafdbank.com",
  latest_source_status: null,
  latest_extracted_fee_count: 0,
  latest_source_collected_at: null,
};

/** A query queued behind a saturated pooler: it never answers. */
const hanging = () => new Promise<never>(() => undefined);

const props = (id = "82") => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

/** Every element in the rendered tree, so a test can ask whether a section is there. */
function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((child) => collect(child, out));
  else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    out.push(element);
    collect(element.props.children, out);
  }
  return out;
}

let id = 1000;

/** The cached page's whole render (page.tsx only hands the id to it). */
const InstitutionProfilePage = async (p: ReturnType<typeof props>) =>
  InstitutionProfile({ id: (await p.params).id, focusFeeCategory: null });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  shortenPageLife.mockClear();
  // A fresh id per test: the page's reads are memoized per institution id.
  id += 1;
  db.institution.mockReset().mockImplementation(async (instId: number) => ({ ...WAFD, id: instId }));
  db.fees.mockReset().mockResolvedValue([]);
  db.rateFees.mockReset().mockResolvedValue([]);
  db.financials.mockReset().mockResolvedValue([]);
  for (const read of [db.branchFootprint, db.complaints, db.holdingCompany, db.enforcement, db.regulator]) {
    read.mockReset().mockResolvedValue(null);
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("institution page with a database that never answers (#1919)", () => {
  it("renders straight away when every read answers", async () => {
    const node = await InstitutionProfilePage(props(String(id)));
    expect(node).toBeTruthy();
    // A clean render keeps the page's hour in the cache.
    expect(shortenPageLife).not.toHaveBeenCalled();
  });

  it("gives up on the layout's existence check, which runs before anything streams", async () => {
    db.institution.mockImplementation(hanging);
    const layout = InstitutionLayout({ children: null, params: Promise.resolve({ id: String(id) }) });
    const outcome = expect(layout).rejects.toBeInstanceOf(ReadDeadlineError);
    await vi.advanceTimersByTimeAsync(LAYOUT_READ_BUDGET_MS);
    await outcome;
  });

  it("gives up on the institution read at the page budget and lets the error boundary answer", async () => {
    db.institution.mockImplementation(hanging);
    const page = InstitutionProfilePage(props(String(id)));
    const outcome = expect(page).rejects.toBeInstanceOf(ReadDeadlineError);
    await vi.advanceTimersByTimeAsync(PAGE_READ_BUDGET_MS);
    await outcome;
  });

  it("still renders the page when only the public-record sections hang", async () => {
    for (const read of [db.branchFootprint, db.complaints, db.holdingCompany, db.enforcement, db.regulator]) {
      read.mockImplementation(hanging);
    }
    const page = InstitutionProfilePage(props(String(id)));
    await vi.advanceTimersByTimeAsync(PAGE_READ_BUDGET_MS);
    const node = await page;
    const ids = collect(node).map((element) => (element.props as { id?: string }).id);
    expect(ids).not.toContain("record-heading");
    // A render with a section missing is cached for a minute, not an hour (#1572).
    expect(shortenPageLife).toHaveBeenCalled();
  });

  it("falls back to plain metadata instead of holding the page when the institution read hangs", async () => {
    db.institution.mockImplementation(hanging);
    const metadata = generateMetadata(props(String(id)));
    await vi.advanceTimersByTimeAsync(METADATA_READ_BUDGET_MS);
    await expect(metadata).resolves.toEqual(degradedMetadata(id));
    expect(shortenPageLife).toHaveBeenCalled();
    expect(degradedMetadata(id).robots).toEqual({ index: false, follow: true });
  });

  it("still answers 404 for an institution that does not exist", async () => {
    db.institution.mockResolvedValue(null);
    await expect(generateMetadata(props(String(id)))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(InstitutionProfilePage(props(String(id)))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(InstitutionLayout({ children: null, params: Promise.resolve({ id: String(id) }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});
