import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  buildSundayEmail,
  isSundayUtc,
  MINUTES_PER_ANSWER_KEY_BANK,
  runSundayMaintenance,
  SUNDAY_EMAIL_MINUTES,
  sundayEmailLive,
  type SundayEmailInputs,
} from "./sunday-maintenance";

const SUNDAY = new Date("2026-10-18T12:20:00Z");
const label = (example: string, banks: number) => ({ name: example.toLowerCase(), example, banks, verdicts: [], reason: "contested" }) as never;
const base: SundayEmailInputs = {
  labels: [label("Zipper Bags", 25), label("Stop Payment Cancellation", 4)],
  answerKeyToCheck: 1,
  dataRoom: { liveInstitutions: 3895, liveFees: 76548, liveRateFees: 808, closedInstitutionFees: 490, closedInstitutions: 22, cityAtLimit: 140, proInstitutionsBelowMinimum: 0 },
  goal: null,
  stuck: [],
  now: SUNDAY,
};

describe("Sunday maintenance email (#1104)", () => {
  it("lists the week's tasks with times and links, in order", () => {
    const email = buildSundayEmail(base);
    expect(email.minutes).toBe(2 * 1 + 1 * 5 + MINUTES_PER_ANSWER_KEY_BANK);
    expect(email.rolledOver).toBe(0);
    expect(email.lines[0]).toBe("This week: 4 tasks, about 17 minutes.");
    expect(email.lines[1]).toContain('Fee names to label (2 names, about 2 minutes): "Zipper Bags" (25 banks); "Stop Payment Cancellation" (4 banks).');
    expect(email.lines.join("\n")).toContain("Decide on 490 live fees at 22 closed institutions (#1200)");
    // The city repair was decided (#1213) and runs daily: no longer a task for James.
    expect(email.lines.join("\n")).not.toContain("#1213");
    expect(email.lines.join("\n")).toContain("/admin/answer-key");
    expect(email.subject).toBe("Fee Insight: your Sunday hour, 2026-10-18 (17 minutes)");
  });

  it("never asks for more than the hour; the rest rolls to next week", () => {
    const email = buildSundayEmail({ ...base, answerKeyToCheck: 10 });
    expect(email.minutes).toBeLessThanOrEqual(SUNDAY_EMAIL_MINUTES);
    expect(email.rolledOver).toBeGreaterThan(0);
    expect(email.lines[0]).toMatch(/roll to next week\.$/);
  });

  it("says when a source could not be read instead of counting it as zero", () => {
    const email = buildSundayEmail({ ...base, labels: null, dataRoom: null, answerKeyToCheck: null, stuck: null });
    const text = email.lines.join("\n");
    expect(text).toContain("Fee names to label: could not be read this week.");
    expect(text).toContain("Anything stuck: could not be read this week.");
    expect(text).toContain("The week in numbers: could not be read this week.");
  });

  it("lists open failure alerts", () => {
    const email = buildSundayEmail({ ...base, stuck: [{ key: "step:read", title: "Rosetta reads failing", message: "5 of 6 failed", failures: 5, total: 6, latestAt: null }] });
    expect(email.lines.join("\n")).toContain("Anything stuck (1 open alert):\n- Rosetta reads failing: 5 of 6 failed");
  });

  it("runs on Sundays only, and emails only when switched on", async () => {
    expect(isSundayUtc(SUNDAY)).toBe(true);
    expect(isSundayUtc(new Date("2026-10-19T12:20:00Z"))).toBe(false);
    expect(sundayEmailLive({})).toBe(false);
    expect(sundayEmailLive({ SUNDAY_EMAIL_LIVE: "true" })).toBe(true);
    const skipped = await runSundayMaintenance({ now: new Date("2026-10-19T12:20:00Z") });
    expect(skipped).toMatchObject({ ran: false, deliveryStatus: "skipped" });
  });
});
