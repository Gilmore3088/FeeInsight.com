"use server";

import { getCurrentUser } from "@/lib/auth";
import { EMAIL_CONFIRM_ACTION_POLICY, isServerActionRateLimited } from "@/lib/api-hardening/action-rate-limit";
import { sendEmailConfirmation } from "@/lib/email/email-confirm";

/** Sends the signed-in user a fresh confirmation link at their account email. */
export async function resendEmailConfirmation(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user?.email) return { ok: false, error: "Sign in again to send the link." };
  if (await isServerActionRateLimited(EMAIL_CONFIRM_ACTION_POLICY)) {
    return { ok: false, error: "That's a few links already. Check your inbox, or try again in 10 minutes." };
  }
  const result = await sendEmailConfirmation(user.id, user.email);
  return result.status === "sent" ? { ok: true } : { ok: false, error: "The email didn't send. Try again shortly." };
}
