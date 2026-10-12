import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));

import { checkProAiQuota, quotaExceededMessage } from "./quota";
import type { User } from "@/lib/auth";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";

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

  it("refuses a capped reader's paid call when the count cannot be read (#1080)", async () => {
    sqlMock.mockRejectedValueOnce(new Error("db down"));
    const quota = await checkProAiQuota(pro);
    expect(quota).toMatchObject({ allowed: false, unreadable: true, limit: 50 });
    expect(quotaExceededMessage(quota)).toBe(HAMILTON_PAUSED_MESSAGE);
  });

  it("keeps a team seat holder allowed when the count cannot be read", async () => {
    sqlMock.mockRejectedValueOnce(new Error("db down"));
    expect((await checkProAiQuota({ ...pro, workspace_seat: true })).allowed).toBe(true);
  });

  it("never blocks a team seat holder, however many questions they asked today", async () => {
    sqlMock.mockResolvedValueOnce([{ used: 400 }]);
    const quota = await checkProAiQuota({ ...pro, workspace_seat: true });
    expect(quota.allowed).toBe(true);
    expect(quota.used).toBe(400);
    expect(quota.limit).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps the 50-question cap for a Pro subscriber without a seat", async () => {
    sqlMock.mockResolvedValueOnce([{ used: 50 }]);
    expect(await checkProAiQuota({ ...pro, workspace_seat: false })).toMatchObject({ allowed: false, limit: 50 });
  });

  it("gives admins the larger limit", async () => {
    sqlMock.mockResolvedValueOnce([{ used: 120 }]);
    expect(await checkProAiQuota({ ...pro, role: "admin" })).toMatchObject({ allowed: true, limit: 200 });
  });
});
