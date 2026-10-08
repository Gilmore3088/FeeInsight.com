import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { createEmailConfirmToken, emailConfirmUrl, verifyEmailConfirmToken } from "./email-confirm";

const SECRET = "test-secret";
const NOW = new Date("2026-10-08T12:00:00Z");

describe("email confirmation token", () => {
  it("verifies for the same account and address, ignoring case", () => {
    const token = createEmailConfirmToken(7, "Pat@Bank.com", NOW, SECRET)!;
    expect(verifyEmailConfirmToken(7, "pat@bank.com", token, NOW, SECRET)).toBe(true);
  });

  it("fails for another account, another address, a bad signature or an expired link", () => {
    const token = createEmailConfirmToken(7, "pat@bank.com", NOW, SECRET)!;
    expect(verifyEmailConfirmToken(8, "pat@bank.com", token, NOW, SECRET)).toBe(false);
    expect(verifyEmailConfirmToken(7, "sam@bank.com", token, NOW, SECRET)).toBe(false);
    expect(verifyEmailConfirmToken(7, "pat@bank.com", `${token.slice(0, -1)}A`, NOW, SECRET)).toBe(false);
    expect(verifyEmailConfirmToken(7, "pat@bank.com", token, new Date("2026-10-30T00:00:00Z"), SECRET)).toBe(false);
  });

  it("makes no token without a secret", () => {
    expect(createEmailConfirmToken(7, "pat@bank.com", NOW, "")).toBeNull();
  });

  it("builds the link to /confirm-email", () => {
    expect(emailConfirmUrl(7, "Pat@Bank.com", "20261008.abc")).toMatch(
      /\/confirm-email\?uid=7&email=pat%40bank\.com&t=20261008\.abc$/,
    );
  });
});
