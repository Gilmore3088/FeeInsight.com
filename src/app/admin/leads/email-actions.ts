"use server";

import { requireAuth } from "@/lib/auth";
import { sendLeadTestEmail } from "@/lib/email/lead-email-test";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TestEmailState {
  status: "idle" | "sent" | "error";
  message: string;
}

export async function sendTestEmailAction(_prev: TestEmailState, formData: FormData): Promise<TestEmailState> {
  await requireAuth("edit");
  const to = String(formData.get("to") ?? "").trim();
  if (!EMAIL_PATTERN.test(to)) {
    return { status: "error", message: "Enter a valid email address." };
  }
  const { from, result } = await sendLeadTestEmail(to);
  if (result.status === "sent") {
    return {
      status: "sent",
      message: `Resend accepted it (id ${result.providerId ?? "n/a"}), sent from ${from} to ${to}. Check that inbox, including spam.`,
    };
  }
  const reason = result.status === "not_configured" ? result.reason : result.error;
  return { status: "error", message: `Not sent from ${from}: ${reason}` };
}
