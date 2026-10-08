import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({
  sql: vi.fn(),
}));

import { sql } from "@/lib/data-store/connection";
import { getJobFreshness } from "./admin-queries";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

function statusOf(summary: Awaited<ReturnType<typeof getJobFreshness>>, job: string) {
  return summary.jobs.find((j) => j.job_name === job)?.status;
}

describe("getJobFreshness", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("reads the run ledger, not the retired workers_last_run markers", async () => {
    sqlMock.mockResolvedValueOnce([{
      atlas_lane_done: hoursAgo(0.2),
      step_done: hoursAgo(0.05),
      steps_queued: true,
      registry_done: hoursAgo(0.1),
      pulse_done: hoursAgo(24),
      pulse_latest_status: "complete",
    }]);

    const summary = await getJobFreshness();

    const query = (sqlMock.mock.calls[0][0] as string[]).join("?");
    expect(query).not.toContain("workers_last_run");
    expect(summary.jobs.map((j) => j.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(summary.stale_count + summary.failed_count + summary.never_ran_count).toBe(0);
  });

  it("flags a job that really stopped and a failed latest pulse", async () => {
    sqlMock.mockResolvedValueOnce([{
      atlas_lane_done: hoursAgo(30),
      step_done: hoursAgo(3),
      steps_queued: true,
      registry_done: null,
      pulse_done: hoursAgo(24 * 40),
      pulse_latest_status: "failed",
    }]);

    const summary = await getJobFreshness();

    expect(statusOf(summary, "atlas_state_lanes")).toBe("stale");
    expect(statusOf(summary, "agent_executor")).toBe("stale");
    expect(statusOf(summary, "registry_sync")).toBe("never_ran");
    expect(statusOf(summary, "monthly_pulse")).toBe("failed");
  });

  it("does not call the tick overdue when nothing is queued", async () => {
    sqlMock.mockResolvedValueOnce([{
      atlas_lane_done: hoursAgo(1),
      step_done: hoursAgo(5),
      steps_queued: false,
      registry_done: hoursAgo(1),
      pulse_done: hoursAgo(24),
      pulse_latest_status: "complete",
    }]);

    expect(statusOf(await getJobFreshness(), "agent_executor")).toBe("ok");
  });

  it("raises no alarm when the ledger cannot be read", async () => {
    sqlMock.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const summary = await getJobFreshness();

    expect(summary.jobs.every((j) => j.status === "ok")).toBe(true);
    errorSpy.mockRestore();
  });
});
