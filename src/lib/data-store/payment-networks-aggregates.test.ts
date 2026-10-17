import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { coveredIssuerSql, shareOf } from "./payment-networks-aggregates";

describe("shareOf", () => {
  it("gives no share for a group under five institutions", () => {
    expect(shareOf(2, 4)).toBeNull();
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(3, 6)).toBe(0.5);
  });
});

describe("coveredIssuerSql", () => {
  it("reads the newest covered list for the given alias", () => {
    expect(coveredIssuerSql("ct")).toContain("m.institution_id = ct.id AND m.network = 'reg-ii-not-exempt'");
  });

  it("refuses an alias that is not a plain identifier", () => {
    expect(() => coveredIssuerSql("s; DROP TABLE x")).toThrow();
  });
});
