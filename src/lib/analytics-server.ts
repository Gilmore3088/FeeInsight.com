/**
 * Server-side funnel events: the steps that happen without a browser on the page (a Stripe
 * webhook, an activation check, a Hamilton answer). Sent to Vercel Analytics as custom
 * events beside the browser ones in `analytics.ts`. Never throws.
 */
import { track } from "@vercel/analytics/server";
import { sql } from "@/lib/data-store/connection";

export type ServerAnalyticsEvent =
  /** A Pro subscription became active, from the Stripe webhook or the activation fallback. */
  | "pro_activated"
  /** A user's first Hamilton question. */
  | "hamilton_first_question"
  /** A user's first saved Hamilton report. */
  | "hamilton_first_report";

export async function trackServerEvent(event: ServerAnalyticsEvent, props?: Record<string, string | number | boolean>): Promise<void> {
  try {
    await track(event, props);
  } catch {
    // Analytics must never break the request.
  }
}

/**
 * Fires the first-use event when the row just written is the user's only one, so the funnel
 * runs from paid to used. Call after the question's usage row or the report row is saved.
 */
export async function trackFirstHamiltonUse(userId: number, kind: "question" | "report"): Promise<void> {
  try {
    const rows =
      kind === "question"
        ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM research_usage WHERE user_id = ${userId} AND agent_id = 'hamilton'`
        : await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM hamilton_reports WHERE user_id = ${userId}`;
    if (rows[0]?.n === 1) await trackServerEvent(kind === "question" ? "hamilton_first_question" : "hamilton_first_report");
  } catch {
    // Analytics must never break the request.
  }
}
