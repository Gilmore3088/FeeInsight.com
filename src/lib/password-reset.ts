import crypto from "crypto";
import { getCookieSecret } from "@/lib/auth";

/** A reset link works for one hour. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Password-reset links need no table: the token carries the user id and expiry, and its
 * signature covers the user's current password hash. Setting a new password changes the
 * hash, so a link works once, and every older link dies with it.
 */
function signature(userId: number, expiresAt: number, passwordHash: string): string {
  return crypto
    .createHmac("sha256", getCookieSecret())
    .update(`password-reset.${userId}.${expiresAt}.${passwordHash}`)
    .digest("hex");
}

export function createPasswordResetToken(
  userId: number,
  passwordHash: string,
  now: number = Date.now(),
): string {
  const expiresAt = now + PASSWORD_RESET_TTL_MS;
  return `${userId}.${expiresAt}.${signature(userId, expiresAt, passwordHash)}`;
}

/** The user id and expiry a token claims, before its signature is checked. */
export function parsePasswordResetToken(token: string): { userId: number; expiresAt: number; sig: string } | null {
  const match = /^(\d{1,10})\.(\d{13})\.([0-9a-f]{64})$/.exec(token.trim());
  if (!match) return null;
  const userId = Number(match[1]);
  const expiresAt = Number(match[2]);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return { userId, expiresAt, sig: match[3] };
}

/** True when the token is unexpired and was signed over this user's current password hash. */
export function verifyPasswordResetToken(
  token: string,
  user: { id: number; password_hash: string },
  now: number = Date.now(),
): boolean {
  const parsed = parsePasswordResetToken(token);
  if (!parsed || parsed.userId !== user.id || parsed.expiresAt <= now) return false;
  const expected = signature(parsed.userId, parsed.expiresAt, user.password_hash);
  return crypto.timingSafeEqual(Buffer.from(parsed.sig, "hex"), Buffer.from(expected, "hex"));
}
