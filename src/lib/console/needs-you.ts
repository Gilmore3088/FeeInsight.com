import type { AttentionItem } from "@/lib/admin-command-center";
import type { FailureAlert } from "@/lib/agents/failure-alerts";
import type { LeadRow } from "@/lib/admin-queries";
import type { HoldGroup } from "@/lib/agents/darwin/held-queue";
import { LEAD_STATUS_LABELS, isLeadStatus, leadDueAt, quoteFollowUpAt } from "@/lib/leads/lead-status";

/**
 * The Needs-you list: everything waiting on a person, gathered from what the
 * console already stores (Atlas's attention list, failure alerts, open leads).
 * It is empty when nothing needs anyone; it never invents work.
 */

export type NeedsYouSeverity = "critical" | "warning" | "work";

export interface NeedsYouItem {
  id: string;
  severity: NeedsYouSeverity;
  /** The room the item belongs to, as the reader sees it. */
  area: "Agents" | "Data" | "Customers" | "Controls";
  title: string;
  detail: string;
  href: string;
  action: string;
}

/**
 * Attention entries that describe standing backlog the agents work through on
 * their own, not a decision for a person. They stay on the Atlas page.
 */
const BACKLOG_ATTENTION = new Set(["coverage:urls"]);

const SEVERITY_ORDER: Record<NeedsYouSeverity, number> = { critical: 0, warning: 1, work: 2 };

function attentionArea(item: AttentionItem): NeedsYouItem["area"] {
  if (item.id.startsWith("provider:") || item.id.startsWith("automation:") || item.id.startsWith("pipeline:")) return "Controls";
  if (item.id.startsWith("trust:")) return "Data";
  return "Agents";
}

function hoursLabel(ms: number): string {
  const hours = Math.max(1, Math.round(Math.abs(ms) / 3_600_000));
  return hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** An emailed quote nobody has paid comes back as a follow-up, never as overdue. */
function quoteItem(lead: LeadRow, now: Date): NeedsYouItem | null {
  const followUp = quoteFollowUpAt(lead);
  if (!followUp || followUp.getTime() > now.getTime()) return null;
  const who = lead.company ? `${lead.name}, ${lead.company}` : lead.name;
  return {
    id: `quote:${lead.id}`,
    severity: "work",
    area: "Customers",
    title: `Quote unpaid for ${hoursLabel(now.getTime() - new Date(lead.quote_sent_at!).getTime())}: ${who}`,
    detail: `Follow up with ${lead.email}, or close the request.`,
    href: "/admin/leads",
    action: "Open lead",
  };
}

function leadItem(lead: LeadRow, now: Date): NeedsYouItem | null {
  const quote = quoteItem(lead, now);
  if (quote) return quote;
  const status = isLeadStatus(lead.status) ? lead.status : "new";
  const due = leadDueAt({ source: lead.source, status, created_at: lead.created_at_iso });
  if (!due) return null;
  const who = lead.company ? `${lead.name}, ${lead.company}` : lead.name;
  const late = due.getTime() <= now.getTime();
  const failed = status === "email_failed";
  return {
    id: `lead:${lead.id}`,
    severity: failed || late ? "critical" : "warning",
    area: "Customers",
    title: failed
      ? `Lead email failed: ${who}`
      : late
        ? `Reply overdue by ${hoursLabel(now.getTime() - due.getTime())}: ${who}`
        : `Reply due in ${hoursLabel(due.getTime() - now.getTime())}: ${who}`,
    detail: `${LEAD_STATUS_LABELS[status]} · ${lead.source ?? "request"} · ${lead.email}`,
    href: "/admin/leads",
    action: "Open lead",
  };
}

/**
 * Age limits for Darwin's held fees (#1115 step 2): a reason with no way out is raised after a
 * week; a reason with one after two weeks, since by then its way out is not keeping up.
 */
export const HOLD_AGE_LIMIT_DAYS = { noExit: 7, withExit: 14 } as const;

function holdItem(group: HoldGroup, now: Date): NeedsYouItem | null {
  if (!group.oldest || group.count === 0) return null;
  const ageMs = now.getTime() - new Date(group.oldest).getTime();
  const limit = group.hasExit ? HOLD_AGE_LIMIT_DAYS.withExit : HOLD_AGE_LIMIT_DAYS.noExit;
  if (ageMs < limit * 86_400_000) return null;
  return {
    id: `hold:${group.cause}`,
    severity: "warning",
    area: "Agents",
    title: `${group.count.toLocaleString("en-US")} fees held ${hoursLabel(ageMs)}: ${group.label}`,
    detail: group.hasExit ? `Past its ${limit}-day limit; its way out is not keeping up. ${group.wayOut}` : `No way out yet; past its ${limit}-day limit.`,
    href: "/admin/darwin",
    action: "See held fees",
  };
}

/** Pure: one ordered list from the stored sources. */
export function buildNeedsYou({
  attention,
  failureAlerts,
  leads,
  holds = [],
  now = new Date(),
}: {
  attention: AttentionItem[];
  failureAlerts: FailureAlert[];
  leads: LeadRow[];
  /** Darwin's held fees by reason; null or empty when not read. */
  holds?: HoldGroup[] | null;
  now?: Date;
}): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  for (const alert of failureAlerts) {
    items.push({
      id: `failure:${alert.key}`,
      severity: "critical",
      area: "Agents",
      title: alert.title,
      detail: alert.message,
      href: "/admin/atlas/details",
      action: "See failures",
    });
  }

  for (const item of attention) {
    if (BACKLOG_ATTENTION.has(item.id)) continue;
    items.push({
      id: `attention:${item.id}`,
      severity: item.severity,
      area: attentionArea(item),
      title: item.title,
      detail: item.detail,
      href: item.href,
      action: item.action,
    });
  }

  for (const lead of leads) {
    const item = leadItem(lead, now);
    if (item) items.push(item);
  }

  for (const group of holds ?? []) {
    const item = holdItem(group, now);
    if (item) items.push(item);
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity] || a.index - b.index)
    .map(({ item }) => item);
}

/** One line for a headline or an email subject. */
export function needsYouHeadline(items: NeedsYouItem[]): string {
  if (items.length === 0) return "Nothing needs you.";
  return `${items.length} thing${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} you.`;
}
