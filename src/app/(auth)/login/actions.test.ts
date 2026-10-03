import { beforeEach, describe, expect, it, vi } from "vitest";

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ login: loginMock }));

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
});
