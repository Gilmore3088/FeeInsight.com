/**
 * Alerts and watches dashboard (Hamilton redesign, Nov 2026): pure builders that turn the reads the
 * Monitor page makes into the plain, serialisable props of the dashboard kit. No read and no model
 * call here; the server read is alerts-read.ts. Client-safe: the alert feed filters and counts run in
 * the browser on the rows the server sent.
 *
 * Rules it keeps:
 *   - a change is a like-for-like one confirmed on the institution's own fee schedule
 *     (loadConfirmedFeeChanges); nothing else is counted as a fee change;
 *   - names the site never shows (neverNamed) are left out of every named list but still counted;
 *   - a count that could not be read is said to be unread, never shown as zero.
 */

import { neverNamed } from "@/lib/never-named";

/** Weeks the alert feed's bar chart covers. */
export const ALERT_FEED_WEEKS = 12;
/** The summary's national and watch windows, in days. */
export const ALERT_RECENT_DAYS = 30;

/** One confirmed like-for-like change, as the server read returns it. */
export interface AlertChangeInput {
  institution_id?: number;
  institution_name: string;
  state_code: string | null;
  fee_category: string;
  display_name: string;
  old_amount: number;
  new_amount: number;
  direction: "up" | "down";
  /** "YYYY-MM-DD". */
  changed_at: string;
}

/** One row of the alert feed. */
export interface AlertFeedRow {
  id: string;
  /** "YYYY-MM-DD", for filtering by window. */
  day: string;
  /** "Oct 7, 2026". */
  date: string;
  institutionId: string | null;
  institution: string;
  state: string | null;
  fee: string;
  from: number;
  to: number;
  direction: "up" | "down";
  /** Index into the feed's weeks, 0 = oldest; -1 when outside them. */
  week: number;
}

export interface AlertWeek {
  /** "YYYY-MM-DD", a Monday. */
  start: string;
  /** "Oct 5". */
  label: string;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "2026-10-07" to "Oct 7, 2026". */
export function longDay(day: string): string {
  return parseDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "2026-10-05" to "Oct 5". */
export function shortDay(day: string): string {
  return parseDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The day `days` before `now`, as "YYYY-MM-DD" (UTC). */
export function daysBefore(now: Date, days: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return utcDay(d);
}

/**
 * The feed's weeks, oldest first, each starting on a Monday (UTC); the last is the week holding
 * `now`.
 */
export function alertWeeks(now: Date, count = ALERT_FEED_WEEKS): AlertWeek[] {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  const lastMonday = new Date(today);
  lastMonday.setUTCDate(today.getUTCDate() - sinceMonday);
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(lastMonday);
    start.setUTCDate(lastMonday.getUTCDate() - 7 * (count - 1 - i));
    const day = utcDay(start);
    return { start: day, label: shortDay(day) };
  });
}

/** Which week a day falls in, or -1 when it is before the first or after the last week. */
export function weekIndex(day: string, weeks: AlertWeek[]): number {
  if (weeks.length === 0) return -1;
  const t = parseDay(day).getTime();
  const first = parseDay(weeks[0].start).getTime();
  const index = Math.floor((t - first) / (7 * 24 * 3600 * 1000));
  return index >= 0 && index < weeks.length ? index : -1;
}

/** Feed rows, newest first. Changes at a never-named institution are left out of the list. */
export function buildAlertFeed(changes: AlertChangeInput[], weeks: AlertWeek[]): AlertFeedRow[] {
  return changes
    .filter((c) => !neverNamed(c.institution_name))
    .map((c) => ({ c, day: String(c.changed_at).slice(0, 10) }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.c.institution_name.localeCompare(b.c.institution_name))
    .map(({ c, day }, i) => ({
      id: `${c.institution_id ?? c.institution_name}-${c.fee_category}-${day}-${i}`,
      day,
      date: longDay(day),
      institutionId: c.institution_id ? String(c.institution_id) : null,
      institution: c.institution_name,
      state: c.state_code,
      fee: c.display_name,
      from: Number(c.old_amount),
      to: Number(c.new_amount),
      direction: c.direction,
      week: weekIndex(day, weeks),
    }));
}

/** Changes per week, oldest first, over the rows given (already filtered). */
export function weeklyCounts(rows: Pick<AlertFeedRow, "week">[], weekCount: number): number[] {
  const counts = new Array<number>(weekCount).fill(0);
  rows.forEach((r) => {
    if (r.week >= 0 && r.week < weekCount) counts[r.week] += 1;
  });
  return counts;
}

export interface AlertFeedFilter {
  direction: "all" | "up" | "down";
  /** A state code, or "all". */
  state: string;
  /** A week index, or null for every week. */
  week: number | null;
}

/** The rows a filter keeps. The week filter is applied separately so the chart shows every week. */
export function filterAlertFeed(rows: AlertFeedRow[], filter: Omit<AlertFeedFilter, "week">): AlertFeedRow[] {
  return rows.filter((r) => {
    if (filter.direction !== "all" && r.direction !== filter.direction) return false;
    if (filter.state !== "all" && r.state !== filter.state) return false;
    return true;
  });
}

/** "▲ 3 up · ▼ 1 down", or the plain sentence for none. */
export function upDownLine(changes: { direction: "up" | "down" }[], none: string): string {
  if (changes.length === 0) return none;
  const up = changes.filter((c) => c.direction === "up").length;
  return `▲ ${up} up · ▼ ${changes.length - up} down`;
}

export interface AlertSummaryKpi {
  key: string;
  label: string;
  value: string;
  sub: string;
  subTone: "good" | "bad" | "neutral";
}

/**
 * The summary row: active watches, alerts on them in the last 30 days, like-for-like changes
 * nationally in the last 30 days, and in the institution's state in the last 180 days.
 * `national` and `state` are null when their read failed; `state` is undefined with no state.
 */
export function buildAlertSummary(input: {
  activeWatchIds: string[];
  offWatches: number;
  /** National rows over the feed's weeks (named rows only are fine: counts use `nationalCount`). */
  national: { recent: { direction: "up" | "down"; institutionId: string | null }[] } | null;
  state: { label: string; days: number; changes: { direction: "up" | "down" }[] } | null | undefined;
}): AlertSummaryKpi[] {
  const active = input.activeWatchIds.length;
  const watched = new Set(input.activeWatchIds);
  const alerts = input.national ? input.national.recent.filter((c) => c.institutionId && watched.has(c.institutionId)) : null;
  const kpis: AlertSummaryKpi[] = [
    {
      key: "watches",
      label: "Watches active",
      value: String(active),
      sub: input.offWatches > 0 ? `${input.offWatches} turned off` : active === 0 ? "Add one with New watch" : "Each follows every fee",
      subTone: "neutral",
    },
    {
      key: "alerts",
      label: `Alerts, last ${ALERT_RECENT_DAYS} days`,
      value: alerts ? String(alerts.length) : "Not read",
      sub: alerts === null ? "Could not be read just now" : active === 0 ? "Nothing watched yet" : alerts.length === 0 ? "Nothing you watch has moved" : upDownLine(alerts, ""),
      subTone: "neutral",
    },
    {
      key: "national",
      label: `Fees changed, US, ${ALERT_RECENT_DAYS} days`,
      value: input.national ? input.national.recent.length.toLocaleString("en-US") : "Not read",
      sub: input.national ? upDownLine(input.national.recent, "No confirmed change") : "Could not be read just now",
      subTone: "neutral",
    },
  ];
  if (input.state === undefined) {
    kpis.push({ key: "state", label: "Your state, 180 days", value: "Not set", sub: "Choose your institution in Settings", subTone: "neutral" });
  } else if (input.state === null) {
    kpis.push({ key: "state", label: "Your state, 180 days", value: "Not read", sub: "Could not be read just now", subTone: "neutral" });
  } else {
    kpis.push({
      key: "state",
      label: `${input.state.label} changes, ${input.state.days} days`,
      value: input.state.changes.length.toLocaleString("en-US"),
      sub: upDownLine(input.state.changes, `No institution in ${input.state.label} changed a fee`),
      subTone: "neutral",
    });
  }
  return kpis;
}

/**
 * Institutions to offer in the New watch builder: the reader's own institution, then those that
 * changed a fee in its state lately, newest first, never one already watched or never named.
 */
export function watchSuggestions(input: {
  selected: { id: string; name: string } | null;
  stateChanges: { institution_id?: number; institution_name: string; changed_at: string }[] | null;
  watchedIds: ReadonlySet<string>;
  limit?: number;
}): { id: string; name: string; reason: string }[] {
  const out: { id: string; name: string; reason: string }[] = [];
  const seen = new Set<string>(input.watchedIds);
  if (input.selected && !seen.has(input.selected.id)) {
    out.push({ ...input.selected, reason: "Your institution" });
    seen.add(input.selected.id);
  }
  const recent = [...(input.stateChanges ?? [])].sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)));
  for (const c of recent) {
    if (!c.institution_id || neverNamed(c.institution_name)) continue;
    const id = String(c.institution_id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: c.institution_name, reason: `Changed a fee ${shortDay(String(c.changed_at))}` });
    if (out.length >= (input.limit ?? 5)) break;
  }
  return out;
}
