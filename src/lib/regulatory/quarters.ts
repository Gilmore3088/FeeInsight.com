/**
 * Call-report quarter helpers. A quarter key is "2026Q2"; its report date is the
 * quarter-end ISO date ("2026-06-30"), and FDIC's REPDTE is "20260630".
 */

const QUARTER_END_MONTH_DAY = ["03-31", "06-30", "09-30", "12-31"] as const;

export interface Quarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}

export function quarterKey(q: Quarter): string {
  return `${q.year}Q${q.quarter}`;
}

export function parseQuarterKey(key: string): Quarter | null {
  const match = /^(\d{4})Q([1-4])$/.exec(key.trim().toUpperCase());
  if (!match) return null;
  return { year: Number(match[1]), quarter: Number(match[2]) as Quarter["quarter"] };
}

export function quarterEndDate(q: Quarter): string {
  return `${q.year}-${QUARTER_END_MONTH_DAY[q.quarter - 1]}`;
}

export function fdicRepdte(q: Quarter): string {
  return quarterEndDate(q).replaceAll("-", "");
}

export function previousQuarter(q: Quarter): Quarter {
  return q.quarter === 1
    ? { year: q.year - 1, quarter: 4 }
    : { year: q.year, quarter: (q.quarter - 1) as Quarter["quarter"] };
}

export function compareQuarters(a: Quarter, b: Quarter): number {
  return a.year !== b.year ? a.year - b.year : a.quarter - b.quarter;
}

/** The quarter containing `date` (UTC). */
export function quarterOf(date: Date): Quarter {
  return {
    year: date.getUTCFullYear(),
    quarter: (Math.floor(date.getUTCMonth() / 3) + 1) as Quarter["quarter"],
  };
}

/**
 * The newest quarter whose filings can be published by `now`, given a filing lag
 * in days after quarter end (FDIC publishes ~30-45 days out, NCUA ~45-60).
 */
export function latestPublishableQuarter(now: Date, lagDays: number): Quarter {
  let q = previousQuarter(quarterOf(now));
  for (;;) {
    const end = new Date(`${quarterEndDate(q)}T00:00:00Z`);
    if (end.getTime() + lagDays * 86_400_000 <= now.getTime()) return q;
    q = previousQuarter(q);
  }
}

/** Every quarter from `from` to `to` inclusive, newest first. */
export function quartersNewestFirst(from: Quarter, to: Quarter): Quarter[] {
  const out: Quarter[] = [];
  for (let q = to; compareQuarters(q, from) >= 0; q = previousQuarter(q)) out.push(q);
  return out;
}
