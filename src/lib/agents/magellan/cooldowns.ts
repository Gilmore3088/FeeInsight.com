/**
 * Rolling cooldowns for Magellan's paid searches (#1031).
 *
 * A paid try (the homepage pick, the web search, the schedule search, the website search)
 * keeps an institution off the paid list for a while counted from the try itself, not
 * from the calendar month: before #1031 every unsolved institution became due on the 1st,
 * and one found on the 30th was searched again on the 1st.
 *
 * - After a find (outcome `ok`): `FOUND_COOLDOWN_DAYS`.
 * - After a miss (any other outcome a step counts as a real try): `MISS_COOLDOWN_DAYS`.
 *
 * Transient outcomes (timeouts, 429, 5xx, network errors, budget blocks) are filtered out
 * by each query as before; they never start a cooldown.
 *
 * The SQL in `paid-find.ts`, `schedule-search.ts`, `website-find.ts` and the state lane
 * scheduler's due counts all use this condition:
 *
 *   pa.created_at >= NOW() - make_interval(days => CASE WHEN pa.outcome = 'ok'
 *     THEN ${FOUND_COOLDOWN_DAYS}::int ELSE ${MISS_COOLDOWN_DAYS}::int END)
 *
 * `onCooldown` is the same rule in TypeScript, so the day counts are tested directly.
 */

/** Days with no paid search after a paid try found the document (or website). */
export const FOUND_COOLDOWN_DAYS = 90;
/** Days with no paid search after a paid try that found nothing. */
export const MISS_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cooldown length, in days, that one paid try's outcome starts. */
export function cooldownDays(outcome: string): number {
  return outcome === "ok" ? FOUND_COOLDOWN_DAYS : MISS_COOLDOWN_DAYS;
}

/** True while a paid try still holds the institution off the paid list. */
export function onCooldown(attempt: { outcome: string; createdAt: Date }, now: Date): boolean {
  return attempt.createdAt.getTime() >= now.getTime() - cooldownDays(attempt.outcome) * DAY_MS;
}
