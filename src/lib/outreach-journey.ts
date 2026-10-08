import { parseUtmValue } from "@/lib/marketing-touch";

/**
 * The free-to-paid journey for founder-led outreach (James, 15:39 UTC Oct 8), in five stages:
 * email delivered (James marks it sent), snapshot opened, engaged with the data, commercial
 * interest, purchase. Page stages come from first-party snapshot events; the rest are outcomes
 * James records. No email-open tracking: privacy protections make it unreliable.
 */

export const SNAPSHOT_EVENT_ENDPOINT = "/api/track/snapshot";

/** What a visitor did on a free market snapshot. */
export const SNAPSHOT_EVENTS = ["opened", "source_click", "fee_view", "competitor_click", "report_click"] as const;
export type SnapshotEvent = (typeof SNAPSHOT_EVENTS)[number];

/** What happened after an email, recorded by James in /admin/growth. */
export const OUTREACH_OUTCOMES = [
  "sent",
  "replied",
  "conversation",
  "report_requested",
  "proposal",
  "purchased_report",
  "purchased_pro",
  "declined",
] as const;
export type OutreachOutcome = (typeof OUTREACH_OUTCOMES)[number];

export const OUTREACH_OUTCOME_LABELS: Record<OutreachOutcome, string> = {
  sent: "Sent",
  replied: "Replied",
  conversation: "Had a conversation",
  report_requested: "Asked for a report",
  proposal: "Proposal sent",
  purchased_report: "Bought the report",
  purchased_pro: "Bought Pro",
  declined: "Declined",
};

export type JourneyStage = "delivered" | "opened" | "engaged" | "interest" | "purchase";

export const JOURNEY_STAGES: ReadonlyArray<{ key: JourneyStage; label: string }> = [
  { key: "delivered", label: "Email sent" },
  { key: "opened", label: "Snapshot opened" },
  { key: "engaged", label: "Engaged with the data" },
  { key: "interest", label: "Commercial interest" },
  { key: "purchase", label: "Purchase" },
];

const INTEREST: ReadonlySet<OutreachOutcome> = new Set(["replied", "conversation", "report_requested", "proposal"]);
const PURCHASE: ReadonlySet<OutreachOutcome> = new Set(["purchased_report", "purchased_pro"]);

/**
 * The furthest stage one institution reached. A click to request a report counts as interest;
 * any other click past opening counts as engagement.
 */
export function journeyStage(events: readonly SnapshotEvent[], outcomes: readonly OutreachOutcome[]): JourneyStage | null {
  if (outcomes.some((outcome) => PURCHASE.has(outcome))) return "purchase";
  if (outcomes.some((outcome) => INTEREST.has(outcome)) || events.includes("report_click")) return "interest";
  if (events.some((event) => event !== "opened")) return "engaged";
  if (events.includes("opened")) return "opened";
  if (outcomes.includes("sent")) return "delivered";
  return null;
}

/** How many institutions reached each stage or beyond, in stage order. */
export function journeyFunnel(stages: ReadonlyArray<JourneyStage | null>): Array<{ key: JourneyStage; label: string; count: number }> {
  return JOURNEY_STAGES.map((stage, index) => ({
    ...stage,
    count: stages.filter((reached) => reached !== null && JOURNEY_STAGES.findIndex((s) => s.key === reached) >= index).length,
  }));
}

export interface SnapshotEventInput {
  institutionId: number;
  event: SnapshotEvent;
  detail: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
}

const DETAIL_PATTERN = /^[a-z0-9_]{1,60}$/;

/** A snapshot event from the page, checked; null for anything else. */
export function parseSnapshotEvent(body: unknown): SnapshotEventInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const institutionId = Number(value.institutionId);
  if (!Number.isInteger(institutionId) || institutionId <= 0) return null;
  if (typeof value.event !== "string" || !(SNAPSHOT_EVENTS as readonly string[]).includes(value.event)) return null;
  const detail = typeof value.detail === "string" && DETAIL_PATTERN.test(value.detail) ? value.detail : null;
  return {
    institutionId,
    event: value.event as SnapshotEvent,
    detail,
    utmCampaign: parseUtmValue(value.utm_campaign),
    utmContent: parseUtmValue(value.utm_content),
  };
}
