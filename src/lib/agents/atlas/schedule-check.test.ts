import { describe, expect, it } from "vitest";
import {
  cronEntries,
  cronMatcher,
  lastScheduledAt,
  routeIdFor,
  scheduleState,
  summarizeScheduleCheck,
  type ScheduleCheckResult,
} from "./schedule-check";
import { lastCompletedStepTitle } from "./last-completed";

const at = (iso: string) => new Date(iso);

describe("cronMatcher", () => {
  it("matches minute, hour and step fields in UTC", () => {
    const hourly = cronMatcher("9 * * * *");
    expect(hourly(at("2026-10-09T13:09:00Z"))).toBe(true);
    expect(hourly(at("2026-10-09T13:10:00Z"))).toBe(false);
    const everyFive = cronMatcher("*/5 * * * *");
    expect(everyFive(at("2026-10-09T13:25:00Z"))).toBe(true);
    expect(everyFive(at("2026-10-09T13:26:00Z"))).toBe(false);
  });

  it("ORs day-of-month and day-of-week when both are set", () => {
    const matches = cronMatcher("0 6 1 * 1");
    expect(matches(at("2026-10-01T06:00:00Z"))).toBe(true); // the 1st (a Thursday)
    expect(matches(at("2026-10-05T06:00:00Z"))).toBe(true); // a Monday
    expect(matches(at("2026-10-06T06:00:00Z"))).toBe(false);
  });

  it("treats day-of-week 7 as Sunday and supports ranges", () => {
    expect(cronMatcher("0 0 * * 7")(at("2026-10-11T00:00:00Z"))).toBe(true);
    expect(cronMatcher("0 9-17 * * 1-5")(at("2026-10-09T12:00:00Z"))).toBe(true);
    expect(cronMatcher("0 9-17 * * 1-5")(at("2026-10-10T12:00:00Z"))).toBe(false);
  });

  it("rejects schedules it cannot read", () => {
    expect(() => cronMatcher("0 0 * *")).toThrow();
    expect(() => cronMatcher("@daily * * * *")).toThrow();
  });
});

describe("lastScheduledAt", () => {
  it("finds the latest scheduled minute at or before the time", () => {
    expect(lastScheduledAt("43 12 * * *", at("2026-10-09T12:50:30Z"))?.toISOString()).toBe("2026-10-09T12:43:00.000Z");
    expect(lastScheduledAt("43 12 * * *", at("2026-10-09T12:30:00Z"))?.toISOString()).toBe("2026-10-08T12:43:00.000Z");
  });

  it("returns null when nothing falls inside the lookback", () => {
    expect(lastScheduledAt("0 0 1 1 *", at("2026-10-09T00:00:00Z"), 60)).toBeNull();
  });
});

describe("scheduleState", () => {
  const due = at("2026-10-09T12:43:00Z");
  it("is unknown when the route writes no audit row", () => {
    expect(scheduleState({ routeId: null, lastDueAt: due, lastCall: null })).toBe("unknown");
  });
  it("is not_due when the schedule never fell in the window", () => {
    expect(scheduleState({ routeId: "r", lastDueAt: null, lastCall: null })).toBe("not_due");
  });
  it("is missed when no call landed since the last due time", () => {
    expect(scheduleState({ routeId: "r", lastDueAt: due, lastCall: null })).toBe("missed");
    expect(scheduleState({ routeId: "r", lastDueAt: due, lastCall: { at: at("2026-10-08T12:43:05Z"), outcome: "success" } })).toBe("missed");
  });
  it("is ran or failed from the call's outcome", () => {
    expect(scheduleState({ routeId: "r", lastDueAt: due, lastCall: { at: at("2026-10-09T12:43:05Z"), outcome: "success" } })).toBe("ran");
    expect(scheduleState({ routeId: "r", lastDueAt: due, lastCall: { at: at("2026-10-09T12:42:30Z"), outcome: "success" } })).toBe("ran");
    expect(scheduleState({ routeId: "r", lastDueAt: due, lastCall: { at: at("2026-10-09T12:43:05Z"), outcome: "error" } })).toBe("failed");
  });
});

describe("vercel.json crons", () => {
  it("every schedule parses", () => {
    const entries = cronEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(() => cronMatcher(entry.schedule)).not.toThrow();
  });

  it("the schedule check's own cron has a policy, so its runs are visible", () => {
    expect(routeIdFor("/api/admin/crew/schedule-check")).toBe("api.admin.crew.schedule_check");
    expect(routeIdFor("/api/admin/crew/bayes?x=1")).toBe("api.admin.crew.bayes");
  });
});

describe("summarizeScheduleCheck", () => {
  const row = (path: string, state: ScheduleCheckResult["rows"][number]["state"]) => ({
    path, schedule: "0 * * * *", routeId: state === "unknown" ? null : path, state,
    lastDueAt: null, lastCallAt: null, lastOutcome: null, note: null,
  });
  it("names missed and failed schedules and counts unknown ones", () => {
    const result: ScheduleCheckResult = {
      checkedAt: "2026-10-09T13:09:00Z",
      rows: [row("/a", "ran"), row("/b", "missed"), row("/c", "failed"), row("/d", "unknown")],
      counts: { ran: 1, missed: 1, failed: 1, unknown: 1, not_due: 0 },
    };
    expect(summarizeScheduleCheck(result)).toBe(
      "Checked 4 schedules against the route ledger: 1 ran on time, 1 missed, 1 failed (/b, /c); 1 unknown (no audit trail).",
    );
  });
  it("says none missed when all ran", () => {
    const result: ScheduleCheckResult = {
      checkedAt: "2026-10-09T13:09:00Z",
      rows: [row("/a", "ran")],
      counts: { ran: 1, missed: 0, failed: 0, unknown: 0, not_due: 0 },
    };
    expect(summarizeScheduleCheck(result)).toBe("Checked 1 schedules against the route ledger: 1 ran on time, none missed or failed.");
  });
});

describe("lastCompletedStepTitle", () => {
  it("returns the latest completed step, never a running or failed one", () => {
    expect(lastCompletedStepTitle([
      { sequence: 1, status: "completed", title: "Read" },
      { sequence: 2, status: "completed", title: "Verify" },
      { sequence: 3, status: "failed", title: "Publish" },
      { sequence: 4, status: "running", title: "Notify" },
    ])).toBe("Verify");
  });
  it("is null when nothing finished", () => {
    expect(lastCompletedStepTitle([{ sequence: 1, status: "running", title: "Read" }])).toBeNull();
  });
});
