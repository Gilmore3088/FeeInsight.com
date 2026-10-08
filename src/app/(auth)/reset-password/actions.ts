"use server";

import { sql, withTransaction } from "@/lib/data-store/connection";
import { hashPassword } from "@/lib/passwords";
import { parsePasswordResetToken, verifyPasswordResetToken } from "@/lib/password-reset";

export interface ResetPasswordResult {
  ok: boolean;
  error?: string;
}

const EXPIRED = "This reset link has expired or was already used. Ask for a new one.";

/**
 * Sets a new password from a reset link and signs the account out everywhere, so a
 * session someone else held does not outlive the reset.
 */
export async function resetPassword(formData: FormData): Promise<ResetPasswordResult> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };

  const parsed = parsePasswordResetToken(token);
  if (!parsed) return { ok: false, error: EXPIRED };

  try {
    const rows = await sql<{ id: number; password_hash: string }[]>`
      SELECT id, password_hash FROM users WHERE id = ${parsed.userId} AND is_active = true`;
    const user = rows[0];
    if (!user?.password_hash || !verifyPasswordResetToken(token, user)) return { ok: false, error: EXPIRED };

    const newHash = await hashPassword(password);
    const changed = await withTransaction(async (tx) => {
      // Only if the hash is still the one the link was signed over: two tabs can't both use it.
      const updated = await tx<{ id: number }[]>`
        UPDATE users SET password_hash = ${newHash}
        WHERE id = ${user.id} AND password_hash = ${user.password_hash}
        RETURNING id`;
      if (updated.length === 0) return false;
      await tx`DELETE FROM sessions WHERE user_id = ${user.id}`;
      return true;
    });
    if (!changed) return { ok: false, error: EXPIRED };
  } catch (error) {
    console.error("[password-reset] reset failed", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "Password reset is unavailable right now. Please try again shortly." };
  }
  return { ok: true };
}
