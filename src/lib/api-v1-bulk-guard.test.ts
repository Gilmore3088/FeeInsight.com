import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock } = vi.hoisted(() => {
  const sqlMock = vi.fn();
  return { sqlMock };
});
vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));

import { PRO_INSTITUTIONS_PER_MONTH, institutionReadAllowed, isEnterpriseCaller } from "./api-v1-bulk-guard";

const pro = { auth: { valid: true, organizationId: 7, tier: "pro" }, organizationId: 7, anonymousId: null };

describe("institutionReadAllowed", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    // Fragments (the subject and the IN list) return a marker; the count query returns rows.
    sqlMock.mockImplementation((strings: unknown) =>
      Array.isArray(strings) && (strings as string[]).join("").includes("COUNT(DISTINCT")
        ? Promise.resolve([{ institutions: 0, seen: false }])
        : "fragment");
  });

  function countRow(institutions: number, seen: boolean) {
    sqlMock.mockImplementation((strings: unknown) =>
      Array.isArray(strings) && (strings as string[]).join("").includes("COUNT(DISTINCT")
        ? Promise.resolve([{ institutions, seen }])
        : "fragment");
  }

  it("never counts for an Enterprise key", async () => {
    const enterprise = { ...pro, auth: { valid: true, organizationId: 7, tier: "enterprise" } };
    expect(isEnterpriseCaller(enterprise)).toBe(true);
    await expect(institutionReadAllowed(enterprise, 12)).resolves.toBe(true);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("allows a new institution under the monthly count", async () => {
    countRow(PRO_INSTITUTIONS_PER_MONTH - 1, false);
    await expect(institutionReadAllowed(pro, 12)).resolves.toBe(true);
  });

  it("refuses a new institution at the monthly count", async () => {
    countRow(PRO_INSTITUTIONS_PER_MONTH, false);
    await expect(institutionReadAllowed(pro, 12)).resolves.toBe(false);
  });

  it("keeps an institution already read this month available", async () => {
    countRow(PRO_INSTITUTIONS_PER_MONTH, true);
    await expect(institutionReadAllowed(pro, 12)).resolves.toBe(true);
  });

  it("is not Enterprise for a Pro key or a signed-in session", () => {
    expect(isEnterpriseCaller(pro)).toBe(false);
    expect(isEnterpriseCaller({ auth: { valid: false, organizationId: null, tier: "free" } })).toBe(false);
  });
});
