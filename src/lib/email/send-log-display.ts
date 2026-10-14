import type { EmailSendCounts, EmailSendStatus } from "@/lib/data-store/email-send-log";

/** Wording for the Publishing room's "Emails sent" section; pure so it is testable. */

export const SEND_STATUS_LABEL: Record<EmailSendStatus, string> = {
  sent: "Accepted",
  failed: "Failed",
  not_configured: "Not configured",
};

export type EventTone = "good" | "bad" | "neutral";

/** "email.delivery_delayed" -> "Delivery delayed"; null -> "No event yet". */
export function emailEventLabel(lastEvent: string | null): string {
  if (!lastEvent) return "No event yet";
  const words = lastEvent.replace(/^email\./, "").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "No event yet";
}

export function emailEventTone(lastEvent: string | null): EventTone {
  if (!lastEvent) return "neutral";
  const event = lastEvent.replace(/^email\./, "");
  if (["delivered", "opened", "clicked"].includes(event)) return "good";
  if (["bounced", "complained", "failed"].includes(event)) return "bad";
  return "neutral";
}

export interface EmailCountLine {
  label: string;
  value: number;
  note: string;
}

/** The three stages the audit asked to keep apart: configured, accepted by Resend, delivered. */
export function emailCountLines(counts: EmailSendCounts): EmailCountLine[] {
  const deliveredNote = counts.withEvents === 0
    ? "No delivery events yet; they arrive once the Resend webhook points at /api/webhooks/resend."
    : counts.undelivered > 0
      ? `${counts.undelivered} bounced, complained or failed after Resend accepted them.`
      : "Reported by Resend's webhook.";
  return [
    {
      label: "Configured",
      value: counts.configured,
      note: counts.notConfigured > 0
        ? `${counts.notConfigured} skipped because Resend was not configured.`
        : "Every attempt had Resend configured.",
    },
    {
      label: "Send accepted",
      value: counts.accepted,
      note: counts.failed > 0 ? `${counts.failed} refused by Resend or not reached.` : "Resend accepted every configured attempt.",
    },
    { label: "Delivered", value: counts.delivered, note: deliveredNote },
  ];
}
