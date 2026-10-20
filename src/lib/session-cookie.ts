import crypto from "crypto";

/**
 * The session cookie's name and signature, with no database or request imports, so the proxy
 * can tell a real session from no session (or a forged one) before a page renders. The
 * session's row is still read by `getCurrentUser` in auth.ts.
 */
export const SESSION_COOKIE = "fsh_session";

/** The secret that signs session cookies and password-reset links. */
export function getCookieSecret(): string {
  const secret = process.env.BFI_COOKIE_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BFI_COOKIE_SECRET must be set in production");
  }
  return secret || "dev-secret-change-in-production";
}

export function signSessionId(sessionId: string): string {
  const sig = crypto
    .createHmac("sha256", getCookieSecret())
    .update(sessionId)
    .digest("hex");
  return `${sessionId}.${sig}`;
}

export function verifyAndExtractSessionId(signed: string): string | null {
  const dotIdx = signed.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const sessionId = signed.substring(0, dotIdx);
  const sig = signed.substring(dotIdx + 1);
  if (!sessionId || !sig || sig.length !== 64) return null;
  try {
    const expected = crypto
      .createHmac("sha256", getCookieSecret())
      .update(sessionId)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
    return sessionId;
  } catch {
    return null;
  }
}
