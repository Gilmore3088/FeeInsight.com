import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.fn();
vi.mock("./connection", () => ({ getSql: vi.fn(), sql: (...args: unknown[]) => sqlMock(...args) }));
const cacheMock = vi.fn((fn: unknown) => fn);
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => cacheMock(fn) }));

import { getInstitutionBranchCityCount } from "./branch-cities";

describe("getInstitutionBranchCityCount", () => {
  beforeEach(() => sqlMock.mockReset());

  it("returns the bank and credit union branch cities as a number", async () => {
    sqlMock.mockResolvedValue([{ cities: "45" }]);
    await expect(getInstitutionBranchCityCount(323)).resolves.toBe(45);
    expect(sqlMock.mock.calls[0].slice(1)).toEqual([323, 323]);
  });

  it("reads no rows as zero cities", async () => {
    sqlMock.mockResolvedValue([]);
    await expect(getInstitutionBranchCityCount(1)).resolves.toBe(0);
  });
});

describe("getInstitutionBranchCityCountCached", () => {
  it("is wrapped in the shared public read cache", async () => {
    const { getInstitutionBranchCityCountCached } = await import("./public-cached-reads");
    expect(typeof getInstitutionBranchCityCountCached).toBe("function");
    expect(cacheMock).toHaveBeenCalled();
  });
});
