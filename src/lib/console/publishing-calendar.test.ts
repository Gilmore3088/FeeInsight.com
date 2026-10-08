import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLICATIONS, buildPublishingCalendar } from "./publishing-calendar";

const now = new Date("2026-10-06T06:00:00Z");

describe("publishing calendar", () => {
  it("computes the next date from each schedule", () => {
    const rows = buildPublishingCalendar([], now);
    const next = Object.fromEntries(rows.map((row) => [row.publication.key, row.nextAt]));
    expect(next.national_index).toBe("2027-01-05T14:30:00.000Z");
    expect(next.monthly_pulse).toBe("2026-11-03T14:30:00.000Z");
    expect(next.morning_brief).toBe("2026-10-06T12:00:00.000Z");
    expect(next.fee_alerts).toBe("2026-10-06T13:23:00.000Z");
    // 2026-10-06 is a Tuesday: the next Sunday is the 11th.
    expect(next.linkedin_posts).toBe("2026-10-11T13:37:00.000Z");
    expect(next.marketing_email).toBe("2026-11-01T14:07:00.000Z");
  });

  it("rolls a weekly run that already happened today to next week", () => {
    const sundayAfter = buildPublishingCalendar([], new Date("2026-10-11T14:00:00Z"));
    expect(sundayAfter.find((row) => row.publication.key === "linkedin_posts")!.nextAt).toBe("2026-10-18T13:37:00.000Z");
    const sundayBefore = buildPublishingCalendar([], new Date("2026-10-11T13:00:00Z"));
    expect(sundayBefore.find((row) => row.publication.key === "linkedin_posts")!.nextAt).toBe("2026-10-11T13:37:00.000Z");
  });

  it("reads last-run facts by key and leaves unknowns empty", () => {
    const rows = buildPublishingCalendar(
      [{ key: "report_jobs:monthly_pulse", count: 3, lastAt: "2026-10-06T03:03:17.000Z", lastStatus: "complete", lastError: null }],
      now,
    );
    const pulse = rows.find((row) => row.publication.key === "monthly_pulse")!;
    expect(pulse.count).toBe(3);
    expect(pulse.lastAt).toBe("2026-10-06T03:03:17.000Z");
    const index = rows.find((row) => row.publication.key === "national_index")!;
    expect(index.lastAt).toBeNull();
  });

  it("matches the cron schedules in vercel.json", () => {
    const crons: { path: string; schedule: string }[] = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
    ).crons;
    const schedule = (fragment: string) => crons.find((cron) => cron.path.includes(fragment))?.schedule;
    expect(schedule("type=national_index")).toBe("30 14 5 1,4,7,10 *");
    expect(schedule("type=monthly_pulse")).toBe("30 14 3 * *");
    expect(schedule("crew/daily-brief")).toBe("0 12 * * *");
    expect(schedule("crew/fee-alerts")).toBe("23 13 * * *");
    expect(schedule("crew/content")).toBe("37 13 * * 0");
    expect(schedule("crew/marketing")).toBe("7 14 1 * *");
    expect(PUBLICATIONS).toHaveLength(7);
  });

  it("lists the weekly growth scores with no next date until their cron is registered", () => {
    const crons: { path: string }[] = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")).crons;
    // Nothing turns on until James says go: the scoring route is not a cron yet.
    expect(crons.some((cron) => cron.path.includes("growth-score"))).toBe(false);
    const scores = buildPublishingCalendar([], now).find((row) => row.publication.key === "growth_scores")!;
    expect(scores.publication.scheduled).toBe(false);
    expect(scores.nextAt).toBeNull();
    expect(scores.publication.freshnessKey).toBe("run:growth.score");
    // The planned schedule (Mondays 13:07 UTC) is kept for when it is turned on.
    expect(scores.publication.next(now).toISOString()).toBe("2026-10-12T13:07:00.000Z");
  });
});
