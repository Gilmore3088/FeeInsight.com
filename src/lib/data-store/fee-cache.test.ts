import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  registrations: [] as Array<{ keys: string[]; options: unknown }>,
  read: vi.fn(async () => []),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>, keys: string[], options: unknown) => {
    state.registrations.push({ keys, options });
    return read;
  },
  revalidateTag: state.revalidate,
}));
vi.mock("./fees", () => ({ getFeeCategorySummaries: state.read }));

import { FEE_SUMMARY_CACHE_TAG, getCachedFeeCategorySummaries, invalidateFeeSummaryCache } from "./fee-cache";
import { STATS_METHOD_VERSION } from "./fee-stats";

describe("national summary comparison cache (#2248)", () => {
  it("separates summaries made under old charging-unit rules while retaining publish invalidation", async () => {
    const registration = state.registrations.find(entry => entry.keys.includes("fee-category-summaries"));
    expect(registration).toEqual({
      keys: ["fee-category-summaries", "v2", `stats-v${STATS_METHOD_VERSION}`],
      options: { tags: [FEE_SUMMARY_CACHE_TAG], revalidate: 3600 },
    });
    await getCachedFeeCategorySummaries();
    expect(state.read).toHaveBeenCalledOnce();
    invalidateFeeSummaryCache();
    expect(state.revalidate).toHaveBeenCalledWith(FEE_SUMMARY_CACHE_TAG, "max");
  });
});
