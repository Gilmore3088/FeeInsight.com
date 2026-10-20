import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("./connection", () => ({
  sql: Object.assign((first: unknown) => Array.isArray(first) && "raw" in first ? query() : first, { unsafe: (value: string) => value }),
}));

import { getPublicStats } from "./core";

const zero = { total_observations: 0, total_institutions: 0, total_categories: 0, total_states: 0 };
describe("public coverage count availability (#2373)", () => {
  beforeEach(() => { query.mockReset(); });

  it("propagates a failed analytical read while retaining the legacy public fallback", async () => {
    const error = new Error("canceling statement due to statement timeout");
    query.mockRejectedValue(error);
    await expect(getPublicStats({ strict: true })).rejects.toBe(error);
    await expect(getPublicStats()).resolves.toEqual(zero);
  });

  it("keeps successfully measured zero counts legitimate in either mode", async () => {
    query.mockResolvedValue([{ total_observations: "0", total_institutions: "0", total_categories: "0", total_states: "0" }]);
    await expect(getPublicStats({ strict: true })).resolves.toEqual(zero);
    await expect(getPublicStats()).resolves.toEqual(zero);
  });

  it("does not treat a missing count row as an analytical zero", async () => {
    query.mockResolvedValue([]);
    await expect(getPublicStats({ strict: true })).rejects.toThrow();
    await expect(getPublicStats()).resolves.toEqual(zero);
  });
});
