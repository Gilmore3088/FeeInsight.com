import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted: the static public-cached-reads import below runs unstable_cache at load, before
// ordinary top-level consts exist.
const { sqlMock, cacheMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  cacheMock: vi.fn((fn: unknown) => fn),
}));
vi.mock("./connection", () => ({ getSql: vi.fn(), sql: (...args: unknown[]) => sqlMock(...args) }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => cacheMock(fn) }));

import { getBranchCityForZip } from "./branch-cities";
// Static, not a dynamic import inside the test: public-cached-reads pulls in most of data-store
// (~40 modules), which took over 5s cold, and a static import pays that at collection rather
// than inside the test's 5s timeout. The mocks above are hoisted, so it still sees them.
import { getBranchCityForZipCached } from "./public-cached-reads";

describe("getBranchCityForZip", () => {
  beforeEach(() => sqlMock.mockReset());

  it("returns the city with the most branches in the ZIP", async () => {
    sqlMock.mockResolvedValue([{ state: "fl", city: "TALLAHASSEE", branches: "21" }]);
    await expect(getBranchCityForZip("32301")).resolves.toEqual({ city: "TALLAHASSEE", state: "FL" });
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(["32301", "32301"]);
  });

  it("reads no rows as no city", async () => {
    sqlMock.mockResolvedValue([]);
    await expect(getBranchCityForZip("00000")).resolves.toBeNull();
  });

  it("never queries for a malformed ZIP", async () => {
    await expect(getBranchCityForZip("3230")).resolves.toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe("getBranchCityForZipCached", () => {
  it("is wrapped in the shared public read cache", () => {
    expect(typeof getBranchCityForZipCached).toBe("function");
    expect(cacheMock).toHaveBeenCalled();
  });
});
