/**
 * The lead loop: every report request or contact inquiry has a visible status in
 * /admin/leads and is answered within LEAD_RESPONSE_HOURS, or James is alerted.
 * Newsletter and capture signups are subscriptions, not requests, and have no due time.
 */

export const LEAD_RESPONSE_HOURS = 24;

export const LEAD_STATUSES = [
  "new",
  "in_progress",
  "overdue",
  "email_failed",
  "needs_reply",
  "held",
  "sent",
  "followed_up",
  "closed",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  in_progress: "In progress",
  overdue: "Overdue",
  email_failed: "Email failed",
  needs_reply: "Needs a reply",
  held: "Held: market not ready",
  sent: "Report sent",
  followed_up: "Followed up",
  closed: "Closed",
};

/** Statuses that still owe the requester an answer. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ["new", "in_progress", "overdue", "email_failed", "needs_reply"];

const REQUEST_SOURCE = /^(report|report_order|enterprise|contact(?:_[a-z0-9-]+)?)$/;

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

/** True when any of the lead's accumulated sources is a request that needs an answer. */
export function isRequestLead(source: string | null | undefined): boolean {
  if (!source) return false;
  return source.split(",").some((part) => REQUEST_SOURCE.test(part.trim()));
}

/** When an open request is due; null for subscriptions and answered leads. */
export function leadDueAt(lead: { source: string | null; status: string; created_at: string | Date }): Date | null {
  if (!isRequestLead(lead.source) || !OPEN_LEAD_STATUSES.includes(lead.status as LeadStatus)) return null;
  const created = new Date(lead.created_at);
  if (Number.isNaN(created.getTime())) return null;
  return addBusinessHours(created, LEAD_RESPONSE_HOURS);
}

/**
 * The site promises a reply "within one business day", so the clock skips weekends:
 * a due time that lands on a Saturday or Sunday (UTC) moves to the same time on Monday,
 * and a request sent on a weekend is due 24 hours after Monday begins. Holidays are not counted.
 */
export function addBusinessHours(start: Date, hours: number): Date {
  const DAY = 86_400_000;
  const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  let from = start;
  if (isWeekend(from)) {
    const monday = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    while (isWeekend(monday)) monday.setTime(monday.getTime() + DAY);
    from = monday;
  }
  const due = new Date(from.getTime() + hours * 3_600_000);
  while (isWeekend(due)) due.setTime(due.getTime() + DAY);
  return due;
}

export function isLeadOverdue(lead: { source: string | null; status: string; created_at: string | Date }, now = new Date()): boolean {
  const due = leadDueAt(lead);
  return due !== null && due.getTime() <= now.getTime();
}
