import { describe, expect, it } from "vitest";
import { CREW, unknownCrew } from "@/lib/agents/crew";
import { STEP_OWNER } from "@/lib/agents/narrate";
import { PROVIDER_STEP_KEYS } from "@/lib/agents/types";
import { agentRegistry, CRON_OWNER, cronOwner, nextRunFor } from "./registry";
import { cronEntries, nextScheduledAt, pathnameOf } from "./schedule-check";

describe("agent registry", () => {
  it("gives every vercel.json cron an owner, so no schedule is orphaned", () => {
    const orphans = cronEntries().filter((cron) => !cronOwner(cron.path)).map((cron) => cron.path);
    expect(orphans).toEqual([]);
  });

  it("has no owner entry for a cron that no longer exists", () => {
    const live = new Set(cronEntries().map((cron) => pathnameOf(cron.path)));
    expect(Object.keys(CRON_OWNER).filter((path) => !live.has(path))).toEqual([]);
  });

  it("lists every crew member and every owned step once", () => {
    const registry = agentRegistry();
    expect(registry.map((entry) => entry.agent)).toEqual(CREW.map((member) => member.agent));
    const steps = registry.flatMap((entry) => entry.steps);
    expect(new Set(steps).size).toBe(steps.length);
    expect(steps.length).toBe(Object.keys(STEP_OWNER).length);
  });

  it("marks paid steps from the provider list", () => {
    const knox = agentRegistry().find((entry) => entry.agent === "knox");
    expect(knox?.paidSteps.every((step) => PROVIDER_STEP_KEYS.includes(step))).toBe(true);
    expect(knox?.steps).toContain("extract");
  });

  it("puts the hourly schedule check under Atlas with its audit route", () => {
    const atlas = agentRegistry().find((entry) => entry.agent === "atlas");
    expect(atlas?.schedules).toContainEqual({ path: "/api/admin/crew/schedule-check", schedule: "9 * * * *", routeId: "api.admin.crew.schedule_check" });
  });
});

describe("nextScheduledAt / nextRunFor", () => {
  it("finds the next minute strictly after now", () => {
    expect(nextScheduledAt("9 * * * *", new Date("2026-10-09T13:09:00Z"))?.toISOString()).toBe("2026-10-09T14:09:00.000Z");
    expect(nextScheduledAt("43 12 * * *", new Date("2026-10-09T12:00:00Z"))?.toISOString()).toBe("2026-10-09T12:43:00.000Z");
  });

  it("takes the soonest across schedules and is null with none", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(nextRunFor([{ path: "/a", schedule: "43 12 * * *" }, { path: "/b", schedule: "17 12 * * *" }], now)).toBe("2026-10-09T12:17:00.000Z");
    expect(nextRunFor([], now)).toBeNull();
  });
});

describe("unknownCrew", () => {
  it("claims no state when the ledger cannot be read", () => {
    const crew = unknownCrew(new Date("2026-10-09T12:00:00Z"));
    expect(crew).toHaveLength(CREW.length);
    expect(crew.every((member) => member.state === "unknown" && member.lastSuccessAt === null)).toBe(true);
    expect(crew.find((member) => member.agent === "atlas")?.nextRunAt).toBe("2026-10-09T12:05:00.000Z");
  });
});
