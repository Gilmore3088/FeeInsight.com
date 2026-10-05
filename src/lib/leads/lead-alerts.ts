/**
 * Alerts that keep a lead from going quiet: an email to the CONTACT_EMAIL inbox when a
 * lead's emails fail, and when a request passes its due time without an answer. Each
 * alerted lead moves to a status that says what is owed, so it is alerted once.
 */
import { CONTACT_EMAIL } from "@/lib/constants";
import { sql } from "@/lib/data-store/connection";
import {
  adminLeadsUrl,
  getLeadNotificationFromAddress,
  renderLeadEmailHtml,
  renderLeadEmailText,
  type LeadEmailContent,
  type LeadNotificationOutcome,
} from "@/lib/email/lead-notification";
import { sendResendEmail, type EmailDeliveryResult } from "@/lib/email/resend";
import { LEAD_RESPONSE_HOURS } from "./lead-status";

function failureReason(result: EmailDeliveryResult): string | null {
  if (result.status === "not_configured") return result.reason;
  if (result.status === "failed") return result.error;
  return null;
}

export async function sendLeadAlert(content: LeadEmailContent): Promise<EmailDeliveryResult> {
  return sendResendEmail(
    {
      from: getLeadNotificationFromAddress(),
      to: CONTACT_EMAIL,
      subject: content.subject,
      html: renderLeadEmailHtml(content),
      text: renderLeadEmailText(content),
    },
    "the lead alert",
  );
}

/**
 * After a lead's emails were attempted. When the requester's confirmation failed but the
 * internal notification went out, James gets a second, plain alert at once. When the
 * internal notification failed, the lead is marked email_failed so the hourly lead watch
 * alerts on it (and the admin row turns red) even if nothing could be emailed now.
 */
export async function handleLeadDeliveryOutcome(
  lead: { email: string; name: string; source: string },
  outcome: LeadNotificationOutcome,
): Promise<void> {
  const notificationFailure = failureReason(outcome.notification);
  const confirmationFailure = failureReason(outcome.confirmation);
  if (!notificationFailure && !confirmationFailure) return;

  if (notificationFailure) {
    await sql`
      UPDATE leads SET status = 'email_failed'
      WHERE lower(email) = lower(${lead.email})`;
    return;
  }

  const alert = await sendLeadAlert({
    subject: `Confirmation email failed: ${lead.email}`,
    lines: [
      `${lead.name} (${lead.email}) sent a ${lead.source} request, but their confirmation email did not go out.`,
      "",
      `Reason: ${confirmationFailure}`,
      "",
      "Reply to them directly; the request is saved in admin.",
    ],
    cta: { label: "Open leads", href: adminLeadsUrl() },
  });
  await sql`
    UPDATE leads SET status = ${alert.status === "sent" ? "needs_reply" : "email_failed"}
    WHERE lower(email) = lower(${lead.email})`;
}

export interface LeadWatchLead {
  id: number;
  name: string;
  email: string;
  company: string | null;
  source: string | null;
  status: string;
  created_at: string;
}

export interface LeadWatchResult {
  overdue: LeadWatchLead[];
  emailFailed: LeadWatchLead[];
  alert: EmailDeliveryResult["status"] | "none";
  alertReason: string | null;
  dryRun: boolean;
}

const REQUEST_SOURCE_SQL = "^(report|report_order|enterprise|contact(_[a-z0-9-]+)?)$";

function describe(lead: LeadWatchLead): string {
  const who = lead.company ? `${lead.name}, ${lead.company}` : lead.name;
  return `- ${who} <${lead.email}>: ${lead.source ?? "unknown source"}, received ${lead.created_at.slice(0, 16).replace("T", " ")} UTC`;
}

export function leadWatchAlert(overdue: LeadWatchLead[], emailFailed: LeadWatchLead[]): LeadEmailContent | null {
  if (overdue.length === 0 && emailFailed.length === 0) return null;
  const lines: string[] = [];
  if (emailFailed.length > 0) {
    lines.push(`${emailFailed.length} lead${emailFailed.length === 1 ? "" : "s"} whose emails failed; they have not heard from us:`, ...emailFailed.map(describe), "");
  }
  if (overdue.length > 0) {
    lines.push(
      `${overdue.length} request${overdue.length === 1 ? "" : "s"} unanswered for more than ${LEAD_RESPONSE_HOURS} hours:`,
      ...overdue.map(describe),
      "",
    );
  }
  lines.push("Set each one's status in admin once it is answered.");
  const count = overdue.length + emailFailed.length;
  return {
    subject: `${count} lead${count === 1 ? "" : "s"} waiting on a reply`,
    lines,
    cta: { label: "Open leads", href: adminLeadsUrl() },
  };
}

/**
 * Hourly: alert on requests past their due time and on leads whose emails failed, then
 * move them to overdue / needs_reply so the next run does not alert on them again.
 * Statuses only move when the alert email was sent.
 */
export async function runLeadWatch(options: { dryRun?: boolean } = {}): Promise<LeadWatchResult> {
  const dryRun = Boolean(options.dryRun);
  const rows = await sql<(LeadWatchLead & { created_at: string | Date; kind: string })[]>`
    SELECT id, name, email, company, source, status, created_at,
           CASE WHEN status = 'email_failed' THEN 'email_failed' ELSE 'overdue' END AS kind
    FROM leads
    WHERE status = 'email_failed'
       OR (status IN ('new', 'in_progress')
           AND created_at <= now() - make_interval(hours => ${LEAD_RESPONSE_HOURS})
           AND EXISTS (
             SELECT 1 FROM unnest(string_to_array(COALESCE(source, ''), ',')) AS part
             WHERE trim(part) ~ ${REQUEST_SOURCE_SQL}))
    ORDER BY created_at
    LIMIT 200`;
  const leads = rows.map((row) => ({
    lead: {
      id: Number(row.id),
      name: String(row.name),
      email: String(row.email),
      company: row.company ? String(row.company) : null,
      source: row.source ? String(row.source) : null,
      status: String(row.status),
      created_at: new Date(row.created_at).toISOString(),
    },
    kind: row.kind,
  }));
  const overdue = leads.filter((l) => l.kind === "overdue").map((l) => l.lead);
  const emailFailed = leads.filter((l) => l.kind === "email_failed").map((l) => l.lead);
  const content = leadWatchAlert(overdue, emailFailed);
  if (!content || dryRun) {
    return { overdue, emailFailed, alert: "none", alertReason: dryRun && content ? "dry run" : null, dryRun };
  }

  const result = await sendLeadAlert(content);
  if (result.status === "sent") {
    const overdueIds = overdue.map((l) => l.id);
    const failedIds = emailFailed.map((l) => l.id);
    if (overdueIds.length > 0) await sql`UPDATE leads SET status = 'overdue' WHERE id = ANY(${overdueIds})`;
    if (failedIds.length > 0) await sql`UPDATE leads SET status = 'needs_reply' WHERE id = ANY(${failedIds})`;
  }
  return { overdue, emailFailed, alert: result.status, alertReason: failureReason(result), dryRun };
}

export function summarizeLeadWatch(result: LeadWatchResult): string {
  const owed = result.overdue.length + result.emailFailed.length;
  if (owed === 0) return "No lead is waiting on a reply.";
  const parts = [`${result.overdue.length} overdue`, `${result.emailFailed.length} with failed emails`].join(", ");
  if (result.dryRun) return `Dry run: ${parts}; no alert sent.`;
  return result.alert === "sent" ? `Alerted James: ${parts}.` : `Could not alert James (${result.alertReason ?? result.alert}): ${parts}.`;
}
