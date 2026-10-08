import { describe, expect, it } from "vitest";
import {
  PASSWORD_RESET_TTL_MS,
  createPasswordResetToken,
  parsePasswordResetToken,
  verifyPasswordResetToken,
} from "./password-reset";

const user = { id: 42, password_hash: "$2b$10$abcdefghijklmnopqrstuv" };
const now = 1_790_000_000_000;

describe("password reset tokens", () => {
  it("verifies a fresh token for the same user and hash", () => {
    const token = createPasswordResetToken(user.id, user.password_hash, now);
    expect(parsePasswordResetToken(token)?.userId).toBe(42);
    expect(verifyPasswordResetToken(token, user, now + 1000)).toBe(true);
  });

  it("dies once the password changes, so a link works once", () => {
    const token = createPasswordResetToken(user.id, user.password_hash, now);
    expect(verifyPasswordResetToken(token, { ...user, password_hash: "$2b$10$changed" }, now)).toBe(false);
  });

  it("expires after an hour", () => {
    const token = createPasswordResetToken(user.id, user.password_hash, now);
    expect(verifyPasswordResetToken(token, user, now + PASSWORD_RESET_TTL_MS)).toBe(false);
  });

  it("rejects another user, edited fields and junk", () => {
    const token = createPasswordResetToken(user.id, user.password_hash, now);
    expect(verifyPasswordResetToken(token, { ...user, id: 43 }, now)).toBe(false);
    const [, , sig] = token.split(".");
    const extended = `${user.id}.${now + 10 * PASSWORD_RESET_TTL_MS}.${sig}`;
    expect(verifyPasswordResetToken(extended, user, now)).toBe(false);
    expect(parsePasswordResetToken("not-a-token")).toBeNull();
    expect(verifyPasswordResetToken("", user, now)).toBe(false);
  });
});
