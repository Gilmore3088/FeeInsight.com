import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { makeStamp } from "@/lib/dataset-stamp";

/**
 * /pro/categories reads the national snapshot Market reads, with its dataset stamp, so its
 * medians and counts match Market's and say where they came from (#1924, go-live item D8).
 */
const stamp = makeStamp({
  dataset: "fee_index_cache",
  mode: "cached",
  readAt: "2026-10-30T19:00:55Z",
  runId: 16491,
  newestRecordAt: null,
  methodVersion: 13,
  counting: "counted_once",
  filters: [],
});

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/lib/team-billing", () => ({ redirectWithoutPremium: vi.fn(async () => undefined) }));
vi.mock("@/lib/data-store/fee-index", () => ({
  getNationalIndexCachedStamped: vi.fn(async () => ({
    entries: [{ fee_category: "overdraft", median_amount: 30, institution_count: 2578, observation_count: 3324 }],
    stamp,
  })),
}));

import ProCategoriesPage from "./page";

describe("/pro/categories dataset stamp (D8)", () => {
  it("shows the national snapshot's medians and counts with the stamp they came from", async () => {
    const markup = renderToStaticMarkup(await ProCategoriesPage());
    const text = new DOMParser().parseFromString(markup, "text/html").body.textContent ?? "";
    expect(markup).toContain("dataset-note");
    expect(text).toContain("How these figures were built");
    expect(text).toContain("2,578 institutions");
  });
});
