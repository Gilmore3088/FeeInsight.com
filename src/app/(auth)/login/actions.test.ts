import { beforeEach, describe, expect, it, vi } from "vitest";

const { loginMock, reserveMock } = vi.hoisted(() => ({ loginMock: vi.fn(), reserveMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ login: loginMock }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/api-hardening/login-rate-limit", () => ({ LOGIN_ATTEMPT_LIMITS: { windowMinutes: 15 }, LOGIN_IDENTIFIER_MAX_LENGTH: 320, reserveLoginAttempt: reserveMock }));

import { loginAction } from "./actions";

function form(username: string, password: string): FormData {
  const data = new FormData();
  data.set("username", username);
  data.set("password", password);
  return data;
}

describe("loginAction", () => {
  beforeEach(() => {
    loginMock.mockReset();
    reserveMock.mockReset().mockResolvedValue("allowed");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns a message instead of throwing when login hits a server error", async () => {
    loginMock.mockRejectedValue(new Error("BFI_COOKIE_SECRET must be set in production"));

    await expect(loginAction(form("admin@example.com", "pw"), "/admin")).resolves.toEqual({
      success: false,
      error: expect.stringContaining("temporarily unavailable"),
    });
  });

  it("rejects bad credentials", async () => {
    loginMock.mockResolvedValue(null);
    await expect(loginAction(form("a@b.c", "nope"), "/admin")).resolves.toEqual({
      success: false,
      error: "Invalid email or password",
    });
  });

  it("sends operators to the admin destination", async () => {
    loginMock.mockResolvedValue({ id: 1, role: "admin" });
    await expect(loginAction(form("a@b.c", "pw"), "/admin")).resolves.toEqual({ success: true, redirect: "/admin" });
  });

  it.each(["viewer", "premium"])("keeps legitimate %s sign-in and safe return destinations", async (role) => {
    loginMock.mockResolvedValue({ id: 2, role });
    expect(await loginAction(form("person@example.com", "pw"), "/admin/quality")).toEqual({ success: true, redirect: "/account" });
    expect(reserveMock.mock.invocationCallOrder[0]).toBeLessThan(loginMock.mock.invocationCallOrder[0]);
  });

  it.each(["known@example.com", "unknown@example.com"])("refuses a limited %s before the verifier or session can run", async (identifier) => {
    reserveMock.mockResolvedValue("limited");
    expect(await loginAction(form(identifier, "pw"), "/account")).toMatchObject({ success: false, error: expect.stringContaining("Too many sign-in attempts") });
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("fails closed before credentials on enforcement or header failures", async () => {
    reserveMock.mockResolvedValueOnce("unavailable").mockRejectedValueOnce(new Error("private identifier must not escape"));
    for (let i = 0; i < 2; i++) expect(await loginAction(form("private@example.com", "pw"), "/account")).toMatchObject({ success: false, error: expect.stringContaining("temporarily unavailable") });
    expect(loginMock).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it("rejects non-text or oversized identifiers without hashing or verifying them", async () => {
    const file = form("user@example.com", "pw");
    file.set("username", new File(["user@example.com"], "login.txt"));
    for (const input of [file, form("x".repeat(321), "pw"), form("   ", "pw"), form("user\u0000@example.com", "pw")]) {
      expect(await loginAction(input, "/account")).toMatchObject({ success: false, error: "Invalid email or password" });
    }
    expect(reserveMock).not.toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
  });
});
