import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { PAST_DUE_GRACE_DAYS } from "./access";
import { WORKSPACE_SEAT_GRACE_DAYS, hasWorkspaceSeat } from "./auth";

function fakeDb(result: unknown[] | Error) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return { db: db as never, calls };
}

describe("hasWorkspaceSeat", () => {
  it("is true when the one query finds a seat on a paid institution account", async () => {
    const { db, calls } = fakeDb([{ has_seat: true }]);
    expect(await hasWorkspaceSeat(8, db)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual([8, WORKSPACE_SEAT_GRACE_DAYS]);
  });

  it("requires an active membership and an active owner whose own subscription is active or in grace", async () => {
    const { db, calls } = fakeDb([{ has_seat: false }]);
    expect(await hasWorkspaceSeat(8, db)).toBe(false);
    const sql = calls[0].text;
    expect(sql).toContain("seat.membership_status = 'active'");
    expect(sql).toContain("owner_seat.membership_role = 'owner'");
    expect(sql).toContain("owner_seat.membership_status = 'active'");
    expect(sql).toContain("owner_user.is_active = true");
    expect(sql).toContain("owner_user.subscription_status = 'active'");
    expect(sql).toContain("owner_user.subscription_status = 'past_due'");
    expect(sql).toContain("past_due_since");
  });

  it("fails closed when the query errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb(new Error("relation does not exist"));
    expect(await hasWorkspaceSeat(8, db)).toBe(false);
    errorSpy.mockRestore();
  });

  it("fails closed on an empty result", async () => {
    const { db } = fakeDb([]);
    expect(await hasWorkspaceSeat(8, db)).toBe(false);
  });

  it("uses the same past-due grace window as a subscriber's own access", () => {
    expect(WORKSPACE_SEAT_GRACE_DAYS).toBe(PAST_DUE_GRACE_DAYS);
  });
});
