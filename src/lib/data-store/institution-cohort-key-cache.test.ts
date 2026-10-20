import { describe, expect, it, vi } from "vitest";

// Next's data cache stand-in: stores what resolves, never what throws.
const store = new Map<string, unknown>();
vi.mock("next/cache", () => ({
  unstable_cache: <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[]) =>
    async (...args: A): Promise<R> => {
      const key = JSON.stringify([keyParts, args]);
      if (store.has(key)) return store.get(key) as R;
      const value = await fn(...args);
      store.set(key, value);
      return value;
    },
  revalidateTag: vi.fn(),
}));
vi.mock("./connection", () => ({ sql: vi.fn(async () => []) }));
vi.mock("./core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core")>()),
  getPublicInstitutionById: vi.fn(),
}));

import { getPublicInstitutionById } from "./core";
import { getInstitutionCohortKeyCached } from "./public-cached-reads";

const readMock = vi.mocked(getPublicInstitutionById);

describe("getInstitutionCohortKeyCached", () => {
  it("caches an id the site does not show, so a random id reaches the database once", async () => {
    readMock.mockResolvedValue(null);
    expect(await getInstitutionCohortKeyCached(424242)).toEqual({ found: false });
    expect(await getInstitutionCohortKeyCached(424242)).toEqual({ found: false });
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("keeps only the charter and tier of a known institution", async () => {
    readMock.mockResolvedValue({ charter_type: "bank", asset_size_tier: "community_small", institution_name: "Capital City Bank" } as never);
    expect(await getInstitutionCohortKeyCached(323)).toEqual({ found: true, charterType: "bank", assetSizeTier: "community_small" });
  });

  it("does not cache a failed read", async () => {
    readMock.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(null);
    await expect(getInstitutionCohortKeyCached(77)).rejects.toThrow("db down");
    expect(await getInstitutionCohortKeyCached(77)).toEqual({ found: false });
  });
});
