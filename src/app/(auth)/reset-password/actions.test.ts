import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPasswordResetToken } from "@/lib/password-reset";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  tx: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sql,
  withTransaction: (cb: (tx: typeof mocks.tx) => Promise<unknown>) => cb(mocks.tx),
}));

vi.mock("@/lib/passwords", () => ({
  hashPassword: vi.fn(async () => "$2b$10$newhash"),
}));

const OLD_HASH = "$2b$10$oldhash";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("resetPassword", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.tx.mockReset();
    mocks.sql.mockResolvedValue([{ id: 9, password_hash: OLD_HASH }]);
    mocks.tx.mockResolvedValueOnce([{ id: 9 }]).mockResolvedValueOnce([]);
  });

  it("sets the new password and signs every session out", async () => {
    const { resetPassword } = await import("./actions");
    const token = createPasswordResetToken(9, OLD_HASH);
    const result = await resetPassword(form({ token, password: "newpassword1", confirm: "newpassword1" }));
    expect(result).toEqual({ ok: true });
    expect(mocks.tx).toHaveBeenCalledTimes(2);
    expect(mocks.tx.mock.calls[0].slice(1)).toEqual(["$2b$10$newhash", 9, OLD_HASH]);
    expect(String(mocks.tx.mock.calls[1][0].join("?"))).toContain("DELETE FROM sessions");
  });

  it("refuses a link signed over an older password", async () => {
    const { resetPassword } = await import("./actions");
    const token = createPasswordResetToken(9, "$2b$10$previous");
    const result = await resetPassword(form({ token, password: "newpassword1", confirm: "newpassword1" }));
    expect(result.ok).toBe(false);
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("checks length and the confirmation before touching the database", async () => {
    const { resetPassword } = await import("./actions");
    const token = createPasswordResetToken(9, OLD_HASH);
    expect((await resetPassword(form({ token, password: "short", confirm: "short" }))).ok).toBe(false);
    expect((await resetPassword(form({ token, password: "newpassword1", confirm: "different1" }))).ok).toBe(false);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
