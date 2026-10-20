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
// The national lists the pick reads; empty here, so only the choices decide.
vi.mock("./market-readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./market-readiness")>()),
  getHeadlineCoverageRows: vi.fn(async () => []),
}));
vi.mock("./peer-fee-rank", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./peer-fee-rank")>()),
  getAllPeerRankValues: vi.fn(async () => []),
}));
vi.mock("./public-peer-sets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./public-peer-sets")>()),
  getInstitutionPeerChoices: vi.fn(),
}));

import { getInstitutionPeerChoices } from "./public-peer-sets";
import { getInstitutionPeerSetsCached } from "./public-cached-reads";

const choicesMock = vi.mocked(getInstitutionPeerChoices);

describe("getInstitutionPeerSetsCached for an id with no institution", () => {
  it("caches the empty choice list, so a random id from the explorer's action reaches the database once", async () => {
    choicesMock.mockResolvedValue([]);
    expect(await getInstitutionPeerSetsCached(987654, "metro")).toBeNull();
    expect(await getInstitutionPeerSetsCached(987654, "state")).toBeNull();
    expect(choicesMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed read", async () => {
    choicesMock.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce([]);
    await expect(getInstitutionPeerSetsCached(55)).rejects.toThrow("db down");
    expect(await getInstitutionPeerSetsCached(55)).toBeNull();
    expect(choicesMock).toHaveBeenCalledTimes(3);
  });
});
