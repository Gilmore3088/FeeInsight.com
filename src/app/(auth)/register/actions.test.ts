import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUserWithSession: vi.fn(),
  getStripe: vi.fn(() => {
    throw new Error("Stripe must not be called during registration");
  }),
}));

vi.mock("@/lib/auth", () => ({ createUserWithSession: mocks.createUserWithSession }));
vi.mock("@/lib/stripe", () => ({ getStripe: mocks.getStripe }));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("register", () => {
  beforeEach(() => {
    mocks.createUserWithSession.mockReset();
    mocks.getStripe.mockClear();
  });

  it("creates no account when the hidden honeypot is filled", async () => {
    const { register } = await import("./actions");
    const result = await register(form({ email: "bot@example.com", password: "password1", website: "spam.example" }));
    expect(result.success).toBe(false);
    expect(mocks.createUserWithSession).not.toHaveBeenCalled();
  });

  it("creates a consumer account from email and password alone, without Stripe", async () => {
    mocks.createUserWithSession.mockResolvedValue({ ok: true, userId: 12 });
    const { register } = await import("./actions");
    const result = await register(
      form({ email: " Reader@Example.com ", password: "password1" }),
      "/institutions?fee=overdraft",
    );
    expect(result).toEqual({ success: true, redirect: "/institutions?fee=overdraft" });
    expect(mocks.createUserWithSession).toHaveBeenCalledWith(
      expect.objectContaining({ email: "reader@example.com", displayName: "reader", institutionName: null }),
    );
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("offers sign-in when the email already has an account", async () => {
    mocks.createUserWithSession.mockResolvedValue({ ok: false, code: "duplicate", message: "dup" });
    const { register } = await import("./actions");
    const result = await register(form({ email: "a@b.com", password: "password1" }), "/institution/3?fee=nsf");
    expect(result).toMatchObject({
      success: false,
      loginHref: "/login?from=%2Finstitution%2F3%3Ffee%3Dnsf",
    });
  });

  it("validates before creating anything", async () => {
    const { register } = await import("./actions");
    expect(await register(form({ email: "nope", password: "password1" }))).toMatchObject({ success: false });
    expect(await register(form({ email: "a@b.com", password: "short" }))).toMatchObject({ success: false });
    expect(mocks.createUserWithSession).not.toHaveBeenCalled();
  });

  it("never redirects off-site", async () => {
    mocks.createUserWithSession.mockResolvedValue({ ok: true, userId: 1 });
    const { register } = await import("./actions");
    const result = await register(form({ email: "a@b.com", password: "password1" }), "https://evil.example");
    expect(result.redirect).toBe("/account");
  });
});
