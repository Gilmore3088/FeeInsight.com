"use server";

import { PASSWORD_RESET_ACTION_POLICY, isServerActionRateLimited } from "@/lib/api-hardening/action-rate-limit";
import { sql } from "@/lib/data-store/connection";
import { sendPasswordResetEmail } from "@/lib/email/password-reset";
import { LEAD_HONEYPOT_FIELD } from "@/lib/lead-capture";
import { createPasswordResetToken } from "@/lib/password-reset";

export interface PasswordResetRequestResult {
  ok: boolean;
  error?: string;
}

/**
 * Emails a one-hour reset link when the address belongs to an active account. The answer
 * is the same either way, so the form never tells a stranger who has an account.
 */
export async function requestPasswordReset(formData: FormData): Promise<PasswordResetRequestResult> {
  const honeypot = formData.get(LEAD_HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim()) return { ok: true };

  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { ok: false, error: "Enter the email you signed up with." };

  if (await isServerActionRateLimited(PASSWORD_RESET_ACTION_POLICY)) {
    return { ok: false, error: "Too many reset requests from this connection. Try again in 10 minutes." };
  }

  try {
    const rows = await sql<{ id: number; email: string | null; username: string; password_hash: string }[]>`
      SELECT id, email, username, password_hash
      FROM users
      WHERE (lower(email) = ${email} OR lower(username) = ${email}) AND is_active = true
      ORDER BY id
      LIMIT 1`;
    const user = rows[0];
    if (user?.password_hash) {
      const to = user.email || user.username;
      await sendPasswordResetEmail(to, createPasswordResetToken(user.id, user.password_hash));
    }
  } catch (error) {
    console.error("[password-reset] request failed", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "Password reset is unavailable right now. Please try again shortly." };
  }
  return { ok: true };
}
