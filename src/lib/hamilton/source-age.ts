/**
 * When a Hamilton source date counts as old. One rule for every answer branch: the source
 * badge, the source lines, the storyline notes and the peer tables all read it here.
 * A missing or unreadable date is never treated as old or new; no date is made up.
 */

/** A source dated more than this many days before today is old. */
export const SOURCE_STALE_AFTER_DAYS = 365;

/** The short label shown beside an old source's date. */
export const STALE_SOURCE_LABEL = "Source over a year old";

const DAY_MS = 86_400_000;

/** True only when the date is a real ISO date more than SOURCE_STALE_AFTER_DAYS days before `now`. */
export function isStaleSource(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return false;
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  if (!Number.isFinite(at) || !Number.isFinite(today)) return false;
  // Whole calendar days (UTC), so the label does not change with the hour of the day.
  return today - at > SOURCE_STALE_AFTER_DAYS * DAY_MS;
}

/** The label for an old source, or null when the source is recent or its date is unknown. */
export function staleSourceLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  return isStaleSource(iso, now) ? STALE_SOURCE_LABEL : null;
}
