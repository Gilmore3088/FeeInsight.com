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

/**
 * The buyer log (GTM plan, "Who can buy"): what James learns on a call, one short answer per
 * question, recorded with the outcome. The questions are the plan's discovery questions plus the
 * email's own question (how they review fees today).
 */
export const BUYER_LOG_FIELDS = [
  { key: "current_method", label: "How they review fees today", question: "Does your team handle competitive fee reviews internally, or do you use an outside research provider?", options: ["Internal", "Outside provider", "Core or consultant report", "Not done"] },
  { key: "last_review", label: "Last review and its trigger", question: "When was your last competitive fee review, and what triggered it?", options: null },
  { key: "review_cost", label: "What it cost", question: "What did that review cost in staff time or outside research?", options: null },
  { key: "signer", label: "Who would sign", question: "Who would approve buying a report like this?", options: ["Marketing", "Retail or deposit product", "Finance", "CEO", "Consultant's principal", "Other"] },
  { key: "budget", label: "Whose budget, set when", question: "Whose budget would it come from, and when is that budget set?", options: null },
  { key: "price_point", label: "Would buy today at", question: "If this report were available today, would you buy it for $500, $1,000 or $1,500?", options: ["$500", "$1,000", "$1,500", "None of these"] },
  { key: "frequency", label: "How often they need it", question: "How often would you need this data?", options: ["Monthly", "Quarterly", "Annually", "One project"] },
] as const;

export type BuyerLogKey = (typeof BUYER_LOG_FIELDS)[number]["key"];
export type BuyerLog = Partial<Record<BuyerLogKey, string>>;

export const BUYER_LOG_ANSWER_MAX_LENGTH = 200;

/** The answered buyer-log fields from a form, trimmed; null when nothing was answered. */
export function parseBuyerLog(get: (key: string) => unknown): BuyerLog | null {
  const log: BuyerLog = {};
  for (const field of BUYER_LOG_FIELDS) {
    const raw = get(`log_${field.key}`);
    const value = typeof raw === "string" ? raw.trim().slice(0, BUYER_LOG_ANSWER_MAX_LENGTH) : "";
    if (!value) continue;
    if (field.options && !(field.options as readonly string[]).includes(value)) continue;
    log[field.key] = value;
  }
  return Object.keys(log).length ? log : null;
}
