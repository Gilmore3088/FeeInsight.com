import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedFee } from "@/lib/data-store/types";

/**
 * #1043 (James, 2026-10-20): an institution page with fewer than MIN_VERIFIED_FEES_FOR_OFFER
 * verified fees stays out of search until it has them, even when it carries financial data.
 * The sitemap half of the rule is pinned in src/app/sitemap.test.ts.
 */
const reads = vi.hoisted(() => ({ institution: vi.fn(), fees: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("./profile-serif-font", () => ({ profileSerif: { variable: "serif" } }));
vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif" } }));
vi.mock("./profile-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./profile-data")>()),
  getPublicInstitutionForPage: reads.institution,
  getVisibleFeesForPage: reads.fees,
}));

import { institutionProfileMetadata } from "./profile-page";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./profile-copy";

const INSTITUTION = {
  id: 82,
  institution_name: "Example Bank",
  city: "SEATTLE",
  state_code: "WA",
  charter_type: "bank",
  asset_size: 30_000_000,
  fed_district: 12,
  fee_count: 40,
};

const NOINDEX = { index: false, follow: true };

const fee = (id: number, reviewStatus: string): ExtractedFee =>
  ({
    id,
    fee_name: `Fee ${id}`,
    fee_category: `category_${id}`,
    amount: 5,
    review_status: reviewStatus,
  }) as unknown as ExtractedFee;

const verified = (count: number) => Array.from({ length: count }, (_, i) => fee(i + 1, "approved"));

beforeEach(() => {
  reads.institution.mockReset().mockResolvedValue(INSTITUTION);
  reads.fees.mockReset().mockResolvedValue([]);
});

describe("institution page robots (#1043)", () => {
  it("noindexes a page with financial data but no fees, and still lets crawlers follow it", async () => {
    reads.institution.mockResolvedValue({ ...INSTITUTION, fee_count: 0 });
    const metadata = await institutionProfileMetadata("82");
    expect(metadata.robots).toEqual(NOINDEX);
  });

  it("noindexes a page one verified fee short of the threshold", async () => {
    reads.fees.mockResolvedValue(verified(MIN_VERIFIED_FEES_FOR_OFFER - 1));
    const metadata = await institutionProfileMetadata("82");
    expect(metadata.robots).toEqual(NOINDEX);
  });

  it("counts only verified fees toward the threshold", async () => {
    const pending = Array.from({ length: 10 }, (_, i) => fee(100 + i, "pending"));
    reads.fees.mockResolvedValue([...verified(MIN_VERIFIED_FEES_FOR_OFFER - 1), ...pending]);
    const metadata = await institutionProfileMetadata("82");
    expect(metadata.robots).toEqual(NOINDEX);
  });

  it("leaves a page at the threshold indexable", async () => {
    reads.fees.mockResolvedValue(verified(MIN_VERIFIED_FEES_FOR_OFFER));
    const metadata = await institutionProfileMetadata("82");
    expect(metadata.robots).toBeUndefined();
  });

  it("keeps the threshold at five verified fees", () => {
    expect(MIN_VERIFIED_FEES_FOR_OFFER).toBe(5);
  });
});
