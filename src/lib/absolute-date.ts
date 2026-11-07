export function formatAbsoluteDate(
  value: string | Date | null | undefined,
  month: "short" | "long" = "short",
): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // A calendar date (a "YYYY-MM-DD" string, or a date column read as UTC midnight) keeps its own day.
  // Any other timestamp is dated in U.S. Pacific time, so no mainland visitor ever reads a date that
  // is still tomorrow for them (the server runs on UTC; Eastern dated a 9pm Pacific refresh tomorrow,
  // site check 2026-11-01).
  const calendarDate =
    (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ||
    (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0);
  return d.toLocaleDateString("en-US", {
    month,
    day: "numeric",
    year: "numeric",
    timeZone: calendarDate ? "UTC" : "America/Los_Angeles",
  });
}
