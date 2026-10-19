import { sql } from "@/lib/data-store/connection";
import { ACCURACY_HISTORY_WEEKS, accuracyDays, eventFromAccuracyDay, poolAccuracyDays, type AccuracyDay, type AccuracyMeasure } from "./accuracy-measure";

export interface AccuracyWeek extends AccuracyMeasure {
  weekStart: string;
  partial: boolean;
  scoringChanged: boolean;
}
export interface LegacyAccuracySnapshot { asOf: string; right: number; scorable: number; accuracy: number | null }
export interface AccuracyHistory {
  weeks: AccuracyWeek[];
  /** Older snapshots contain only overlapping rolling totals: show them, never sum them into weeks. */
  legacySnapshots?: LegacyAccuracySnapshot[];
}

function monday(day: string): string {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

/** Snapshot copies of an audit are not new draws. Calendar weeks and checker series stay separate. */
export function bucketAccuracyHistory(days: AccuracyDay[], now = new Date(), weeks = ACCURACY_HISTORY_WEEKS): AccuracyHistory {
  const currentWeek = monday(now.toISOString());
  const starts = Array.from({ length: weeks }, (_, i) => {
    const date = new Date(`${currentWeek}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (weeks - i - 1) * 7);
    return date.toISOString().slice(0, 10);
  });
  const byTimestamp = new Map(days.filter((day) => typeof day?.at === "string" && Number.isFinite(Date.parse(day.at)) && Date.parse(day.at) <= now.getTime()).map((day) => [`${day.at}|${day.series ?? "legacy"}|${day.seed ?? ""}`, day]));
  const { days: draws } = accuracyDays([...byTimestamp.values()].map(eventFromAccuracyDay));
  const result: AccuracyWeek[] = [];
  let previousSeries: string | null | undefined;
  for (const weekStart of starts) {
    const groups = new Map<string | null, AccuracyDay[]>();
    for (const day of [...draws].sort((a, b) => a.at.localeCompare(b.at))) {
      if (monday(day.at) !== weekStart) continue;
      const series = day.series ?? null;
      groups.set(series, [...(groups.get(series) ?? []), day]);
    }
    if (groups.size === 0) {
      result.push({ ...poolAccuracyDays([]), weekStart, partial: weekStart === currentWeek, scoringChanged: false });
    }
    for (const [series, group] of groups) {
      const scoringChanged = previousSeries !== undefined && previousSeries !== series;
      result.push({ ...poolAccuracyDays(group), weekStart, partial: weekStart === currentWeek, scoringChanged });
      previousSeries = series;
    }
  }
  return { weeks: result };
}

/** Only the small dated audit receipts are read, not each snapshot's full operational detail. */
export async function readAccuracyHistory(db: typeof sql = sql, now = new Date()): Promise<AccuracyHistory> {
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - ACCURACY_HISTORY_WEEKS * 7);
  const rows = await db<Array<{ day: AccuracyDay | null; snapshot_day: string; legacy: { right: number; scorable: number; accuracy: number | null } | null }>>`
    SELECT DISTINCT ON (COALESCE(day->>'at', s.snapshot_date::text), day->>'series', day->>'seed')
           day, s.snapshot_date::text AS snapshot_day,
           CASE WHEN day IS NULL THEN jsonb_build_object(
             'right', s.detail #> '{goal,accuracy,right}',
             'scorable', s.detail #> '{goal,accuracy,scorable}',
             'accuracy', s.detail #> '{goal,accuracy,accuracy}'
           ) END AS legacy
      FROM pipeline_scoreboard_snapshots s
      LEFT JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.detail #> '{goal,accuracy,daily}') = 'array'
             THEN s.detail #> '{goal,accuracy,daily}' ELSE '[]'::jsonb END
      ) AS entries(day) ON TRUE
     WHERE s.snapshot_date >= ${since.toISOString().slice(0, 10)}::date
     ORDER BY COALESCE(day->>'at', s.snapshot_date::text), day->>'series', day->>'seed', s.snapshot_date DESC
  `;
  return {
    ...bucketAccuracyHistory(rows.flatMap((row) => row.day ? [row.day] : []), now),
    legacySnapshots: rows.flatMap((row) => {
      const old = row.legacy;
      if (!old || !Number.isSafeInteger(old.right) || !Number.isSafeInteger(old.scorable) || old.right < 0 || old.right > old.scorable || old.scorable <= 0) return [];
      return [{ asOf: row.snapshot_day, right: old.right, scorable: old.scorable, accuracy: old.right / old.scorable }];
    }),
  };
}
