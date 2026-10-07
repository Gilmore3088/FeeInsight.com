/**
 * The "What's new" line in the monthly emails: reader-facing changes that shipped last month,
 * one sentence each. Updates ride inside the monthly email instead of going out as their own
 * sends (decision 2026-10-06, email plan).
 *
 * What earns a line: a new state with enough data for its own edition, a new free report, a new
 * Hamilton feature, or a methodology change readers should know about. Bug fixes, internal agent
 * work and coverage counts don't. A merged PR that ships one of those adds its line here, dated
 * the day it merged. Lines carry no figures: numbers in these emails come only from live data.
 */

export interface WhatsNewEntry {
  /** The day the change went live, YYYY-MM-DD. */
  date: string;
  line: string;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    date: "2026-10-06",
    line: "Pick your state when you sign up and this email arrives as your state's edition, comparing its fees with the national median.",
  },
];

/** The month before `month` (YYYY-MM). */
function previousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 2, 1)).toISOString().slice(0, 7);
}

/** Lines for the email drafted in `month`: what went live in the month before it. At most three. */
export function whatsNewFor(month: string, entries: WhatsNewEntry[] = WHATS_NEW): string[] {
  const since = previousMonth(month);
  return entries.filter((entry) => entry.date.slice(0, 7) === since).map((entry) => entry.line).slice(0, 3);
}
