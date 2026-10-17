import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.fn();
vi.mock("./connection", () => ({ getSql: vi.fn(), sql: (...args: unknown[]) => sqlMock(...args) }));
const cacheMock = vi.fn((fn: unknown) => fn);
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => cacheMock(fn) }));

import { getBranchCityForZip } from "./branch-cities";

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
  it("is wrapped in the shared public read cache", async () => {
    const { getBranchCityForZipCached } = await import("./public-cached-reads");
    expect(typeof getBranchCityForZipCached).toBe("function");
    expect(cacheMock).toHaveBeenCalled();
  });
});
