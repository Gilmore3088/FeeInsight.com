import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  send: vi.fn(),
  limited: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/email/password-reset", () => ({ sendPasswordResetEmail: mocks.send }));
vi.mock("@/lib/api-hardening/action-rate-limit", () => ({
  PASSWORD_RESET_ACTION_POLICY: { routeId: "action.password_reset" },
  isServerActionRateLimited: mocks.limited,
}));

function form(email: string) {
  const data = new FormData();
  data.set("email", email);
  return data;
}

describe("requestPasswordReset", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.send.mockReset();
    mocks.limited.mockReset();
    mocks.limited.mockResolvedValue(false);
    mocks.send.mockResolvedValue({ status: "sent", providerId: "x" });
  });

  it("emails a reset link to an active account", async () => {
    mocks.sql.mockResolvedValue([{ id: 3, email: "a@bank.com", username: "a@bank.com", password_hash: "$2b$10$h" }]);
    const { requestPasswordReset } = await import("./actions");
    expect(await requestPasswordReset(form(" A@Bank.com "))).toEqual({ ok: true });
    expect(mocks.send).toHaveBeenCalledWith("a@bank.com", expect.stringMatching(/^3\.\d{13}\.[0-9a-f]{64}$/));
  });

  it("gives the same answer when no account exists, and sends nothing", async () => {
    mocks.sql.mockResolvedValue([]);
    const { requestPasswordReset } = await import("./actions");
    expect(await requestPasswordReset(form("nobody@bank.com"))).toEqual({ ok: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("stops at the rate limit", async () => {
    mocks.limited.mockResolvedValue(true);
    const { requestPasswordReset } = await import("./actions");
    expect((await requestPasswordReset(form("a@bank.com"))).ok).toBe(false);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
