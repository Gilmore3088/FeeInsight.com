import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import type { sql } from "@/lib/data-store/connection";
import { getApiUsageSummary, usageMonthStart } from "./api-usage-summary";

const db = vi.fn();
const asDb = db as unknown as typeof sql;
const text = (n: number) => (db.mock.calls[n][0] as string[]).join("?");
const values = (n: number) => db.mock.calls[n].slice(1);
const NOW = new Date("2026-10-17T15:30:00Z");

describe("getApiUsageSummary", () => {
  beforeEach(() => db.mockReset());

  it("uses the UTC calendar month the monthly limit uses", () => {
    expect(usageMonthStart(NOW).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("reads the payer org's monthly count and each key holder's successful calls", async () => {
    db.mockResolvedValueOnce([{ id: 55 }])
      .mockResolvedValueOnce([{ request_count: "1234" }])
      .mockResolvedValueOnce([
        { key_name: "Pro user 12", calls: "30" },
        { key_name: "Pro user 7", calls: "1200" },
        { key_name: "Pro subscription", calls: "4" },
      ])
      .mockResolvedValueOnce([
        { id: 7, display_name: "Dana Lee", email: "dana@bank.example" },
        { id: 12, display_name: " ", email: "sam@bank.example" },
      ]);

    const summary = await getApiUsageSummary(7, NOW, asDb);

    expect(summary).toEqual({
      used: 1234,
      allowance: 10000,
      people: [
        { userId: 7, label: "Dana Lee", calls: 1204 },
        { userId: 12, label: "sam@bank.example", calls: 30 },
      ],
    });
    expect(values(0)).toEqual(["pro-user-7"]);
    expect(text(1)).toContain("api_rate_limit_events");
    expect(values(1)).toEqual(["api.v1", "55", "2026-10-01T00:00:00.000Z"]);
    expect(text(2)).toContain("JOIN api_keys k ON k.id = ue.api_key_id");
    expect(text(2)).not.toContain("metadata ->> 'status'");
    expect(values(2)).toEqual([55, "2026-10-01T00:00:00.000Z"]);
    expect(values(3)).toEqual([[12, 7]]);
  });

  it("is zero with no one listed before the plan has an organization", async () => {
    db.mockResolvedValueOnce([]);

    await expect(getApiUsageSummary(7, NOW, asDb)).resolves.toEqual({ used: 0, allowance: 10000, people: [] });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("is zero this month when no call has been reserved, and falls back to the user id label", async () => {
    db.mockResolvedValueOnce([{ id: 55 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key_name: "Pro user 9", calls: 2 }])
      .mockResolvedValueOnce([]);

    await expect(getApiUsageSummary(7, NOW, asDb)).resolves.toEqual({
      used: 0,
      allowance: 10000,
      people: [{ userId: 9, label: "User 9", calls: 2 }],
    });
  });

  it("shows the total without a breakdown before usage_events.api_key_id exists", async () => {
    db.mockResolvedValueOnce([{ id: 55 }])
      .mockResolvedValueOnce([{ request_count: 3 }])
      .mockRejectedValueOnce(Object.assign(new Error("undefined column"), { code: "42703" }));

    await expect(getApiUsageSummary(7, NOW, asDb)).resolves.toEqual({ used: 3, allowance: 10000, people: [] });
  });
});
