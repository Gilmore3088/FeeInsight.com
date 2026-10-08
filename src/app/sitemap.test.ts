import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInstitutionIdsWithFeeDates, getStatesWithFeeData } from "@/lib/data-store";
import { getPublicSnapshot } from "@/lib/public-stats";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { SITE_URL } from "@/lib/constants";
import sitemap from "./sitemap";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./(public)/institution/[id]/profile-copy";

vi.mock("@/lib/data-store", () => ({
  getCitiesInState: vi.fn(() => Promise.resolve([])),
  getDataFreshness: vi.fn(() => Promise.resolve(null)),
  getInstitutionIdsWithFeeDates: vi.fn(() => Promise.resolve([])),
  getStatesWithFeeData: vi.fn(),
}));

vi.mock("@/lib/public-stats", () => ({
  getPublicSnapshot: vi.fn(),
}));

vi.mock("@/lib/guides/source", () => ({
  loadGuides: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/data-store/connection", () => ({
  getSql: vi.fn(() => {
    throw new Error("no database in tests");
  }),
}));

vi.mock("@/lib/custom-report/sample-report", () => ({
  sampleReportAvailable: vi.fn(() => Promise.resolve(false)),
}));

function category(fee_category: string, institution_count: number) {
  return { fee_category, institution_count };
}

async function urls(): Promise<string[]> {
  return (await sitemap()).map((e) => e.url.replace(SITE_URL, ""));
}

describe("sitemap thin-page floor", () => {
  beforeEach(() => {
    vi.mocked(getPublicSnapshot).mockResolvedValue({
      summary: {} as never,
      categories: [
        category("overdraft", 1200),
        category("nsf", MIN_INSTITUTIONS_FOR_MEDIAN),
        category("dmv_filing", MIN_INSTITUTIONS_FOR_MEDIAN - 1),
      ] as never,
    });
    vi.mocked(getStatesWithFeeData).mockResolvedValue([
      { state_code: "TX", institution_count: 242, fee_count: 4328 },
      { state_code: "AK", institution_count: MIN_INSTITUTIONS_FOR_MEDIAN - 1, fee_count: 20 },
    ]);
  });

  it("leaves out a fee category below the median floor and keeps those at or above it", async () => {
    const paths = await urls();
    expect(paths).toContain("/fees/overdraft");
    expect(paths).toContain("/fees/nsf");
    expect(paths).not.toContain("/fees/dmv_filing");
  });

  it("leaves out categories with no published fees at all", async () => {
    const paths = await urls();
    expect(paths).not.toContain("/fees/duplicate_title");
  });

  it("lists state reports only at or above the floor", async () => {
    const paths = await urls();
    expect(paths).toContain("/research/state/TX");
    expect(paths).not.toContain("/research/state/AK");
    expect(paths).not.toContain("/research/state/WY");
  });

  it("lists every category and state when the counts can't be read", async () => {
    vi.mocked(getPublicSnapshot).mockRejectedValue(new Error("db down"));
    vi.mocked(getStatesWithFeeData).mockRejectedValue(new Error("db down"));
    const paths = await urls();
    expect(paths).toContain("/fees/vehicle_title");
    expect(paths).toContain("/research/state/AK");
  });

  it("leaves out institution profiles below the verified-fee floor they are noindexed at", async () => {
    vi.mocked(getInstitutionIdsWithFeeDates).mockResolvedValueOnce([
      { id: 1, last_fee_at: "2026-10-01T00:00:00.000Z", verified_fee_count: MIN_VERIFIED_FEES_FOR_OFFER },
      { id: 2, last_fee_at: "2026-10-01T00:00:00.000Z", verified_fee_count: MIN_VERIFIED_FEES_FOR_OFFER - 1 },
      { id: 3, last_fee_at: null, verified_fee_count: 40 },
    ]);
    const paths = await urls();
    expect(paths).toContain("/institution/1");
    expect(paths).not.toContain("/institution/2");
    expect(paths).toContain("/institution/3");
  });

  it("lists an institution profile as before when its count can't be read", async () => {
    vi.mocked(getInstitutionIdsWithFeeDates).mockResolvedValueOnce([
      { id: 4, last_fee_at: null, verified_fee_count: null },
    ]);
    expect(await urls()).toContain("/institution/4");
  });
});
