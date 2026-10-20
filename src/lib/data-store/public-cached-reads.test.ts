import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for Next's data cache that also records whether a cached read started while
// another cached read was running. Next bypasses an unstable_cache nested inside another one,
// so a nested read reaches the database on every miss of the outer entry.
const state = vi.hoisted(() => ({ store: new Map<string, unknown>(), depth: 0, nested: [] as string[] }));

vi.mock("next/cache", () => ({
  unstable_cache: <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[]) =>
    async (...args: A): Promise<R> => {
      const key = JSON.stringify([keyParts, args]);
      if (state.store.has(key)) return state.store.get(key) as R;
      if (state.depth > 0) state.nested.push(keyParts[1]);
      state.depth++;
      try {
        const value = await fn(...args);
        state.store.set(key, value);
        return value;
      } finally {
        state.depth--;
      }
    },
}));

vi.mock("./connection", () => ({ sql: vi.fn() }));

const reads = vi.hoisted(() => ({
  coverage: vi.fn(async () => [[1, 5, "TX", "bank", 11], [2, 5, "TX", "bank", 11]]),
  peerValues: vi.fn(async () => [[1, "monthly_maintenance", 10, "bank", "TX", 11]]),
}));

vi.mock("./market-readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./market-readiness")>()),
  getHeadlineCoverageRows: reads.coverage,
  reportRuleCheckFromRows: (id: number) => ({ id, passes: true, charter_type: "bank", state_code: "TX" }),
}));

vi.mock("./peer-fee-rank", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./peer-fee-rank")>()),
  getAllPeerRankValues: reads.peerValues,
  peerFiltersForRule: () => ({ charter_type: "bank", state_code: "TX" }),
  peerGroupValuesFrom: () => [],
  peerRankFromGroupValues: (id: number) => ({ institution_id: id }),
}));

import { getInstitutionHeadlineCoverageCached, getInstitutionPeerRankCached } from "./public-cached-reads";

beforeEach(() => {
  state.store.clear();
  state.depth = 0;
  state.nested = [];
  reads.coverage.mockClear();
  reads.peerValues.mockClear();
});

// 2026-10-09-institution-pages-recounted-catalog: the first fix put the coverage cache inside
// the per-institution peer rank cache, so the whole-catalog count still ran on every miss.
describe("institution page peer rank", () => {
  it("reads the coverage and peer values caches beside each other, never one inside another", async () => {
    await getInstitutionPeerRankCached(1);
    expect(reads.coverage).toHaveBeenCalledTimes(1);
    expect(reads.peerValues).toHaveBeenCalledTimes(1);
    expect(state.nested).toEqual([]);
  });

  it("shares one coverage read across every institution page and the directory", async () => {
    await getInstitutionPeerRankCached(1);
    await getInstitutionPeerRankCached(2);
    await getInstitutionHeadlineCoverageCached([1, 2]);
    expect(reads.coverage).toHaveBeenCalledTimes(1);
    expect(reads.peerValues).toHaveBeenCalledTimes(1);
  });
});
