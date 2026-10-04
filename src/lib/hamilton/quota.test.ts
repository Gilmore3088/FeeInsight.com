import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));

import { checkProAiQuota, quotaExceededMessage } from "./quota";
import type { User } from "@/lib/auth";

const pro = { id: 7, role: "premium", subscription_status: "active" } as User;

describe("checkProAiQuota", () => {
  beforeEach(() => sqlMock.mockReset());

  it("allows the 50th request and blocks the 51st for a Pro subscriber", async () => {
    sqlMock.mockResolvedValueOnce([{ used: 49 }]);
    expect(await checkProAiQuota(pro)).toMatchObject({ allowed: true, used: 49, limit: 50 });
    sqlMock.mockResolvedValueOnce([{ used: 50 }]);
    const blocked = await checkProAiQuota(pro);
    expect(blocked).toMatchObject({ allowed: false, limit: 50 });
    expect(quotaExceededMessage(blocked)).toContain("50 Hamilton AI requests");
  });

  it("counts only today's Hamilton rows for this user", async () => {
    sqlMock.mockResolvedValueOnce([{ used: 0 }]);
    await checkProAiQuota(pro);
    const [strings, ...values] = sqlMock.mock.calls[0];
    expect((strings as string[]).join("?")).toContain("date_trunc('day'");
    expect(values).toEqual([7, "hamilton%"]);
  });

  it("does not lock users out when the count cannot be read", async () => {
    sqlMock.mockRejectedValueOnce(new Error("db down"));
    expect((await checkProAiQuota(pro)).allowed).toBe(true);
  });

  it("gives admins the larger limit", async () => {
    sqlMock.mockResolvedValueOnce([{ used: 120 }]);
    expect(await checkProAiQuota({ ...pro, role: "admin" })).toMatchObject({ allowed: true, limit: 200 });
  });
});
