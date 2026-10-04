// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AtlasOverview, funnelSteps, pipelineStatus, publishMinutes } from "./atlas-overview";
import type { PipelineHealth } from "@/lib/job-health";
import type { PipelineFunnel } from "@/lib/data-store/pipeline-funnel";

afterEach(() => cleanup());

const health: PipelineHealth = {
  pipeline_enabled: true,
  provider_automation_enabled: true,
  last_successful_tick_at: "2026-10-02T12:00:00.000Z",
  minutes_since_successful_tick: 3,
  blocked_ticks_1h: 0,
  stale_running_steps: 0,
  overdue_state_lanes: 0,
  last_published_at: "2026-10-02T06:00:00.000Z",
  hours_since_last_publish: 6,
  provider_failure_count_24h: 0,
  runs_completed_24h: 12,
  runs_failed_24h: 1,
};

const funnel: PipelineFunnel = {
  institutions: 8750,
  withFeeUrl: 4600,
  documentsFetched: 4422,
  textsRead: 77,
  rawExtracted: 1073,
  verified: 6401,
  publishedRows: 3741,
  publishedInstitutions: 1183,
  sourcedInstitutions: 239,
};

describe("pipelineStatus", () => {
  it("is running when enabled and healthy", () => {
    expect(pipelineStatus(health, [])).toBe("running");
  });
  it("is paused when the pipeline control is off, whatever else is wrong", () => {
    expect(pipelineStatus({ ...health, pipeline_enabled: false }, ["x"])).toBe("paused");
  });
  it("needs attention when health reports problems", () => {
    expect(pipelineStatus(health, ["Last successful agent tick was 900 minutes ago."])).toBe("attention");
  });
});

describe("funnelSteps", () => {
  it("expresses URL and sourced coverage as a share of the universe", () => {
    const steps = funnelSteps(funnel);
    expect(steps).toHaveLength(7);
    expect(steps[1]).toMatchObject({ label: "Fee URL found", value: 4600, note: "institutions · 53% of universe" });
    expect(steps[6]).toMatchObject({ value: 239, note: "institutions · 2.7% sourced · 1,183 any" });
  });
});

describe("AtlasOverview", () => {
  it("shows status, the funnel, 24h stats and the top attention items", () => {
    render(
      <AtlasOverview
        health={{ ...health, blocked_ticks_1h: 12 }}
        problems={["12 agent ticks were blocked in the last hour."]}
        funnel={funnel}
        attention={[
          { id: "a", severity: "critical", owner: "atlas", title: "First", detail: "d1", href: "/admin", action: "Go" },
          { id: "b", severity: "critical", owner: "atlas", title: "Second", detail: "d2", href: "/admin", action: "Go" },
          { id: "c", severity: "warning", owner: "atlas", title: "Third", detail: "d3", href: "/admin", action: "Go" },
          { id: "d", severity: "warning", owner: "atlas", title: "Fourth", detail: "d4", href: "/admin", action: "Go" },
        ] as never}
      />,
    );

    expect(screen.getByText("Pipeline: Needs attention")).toBeTruthy();
    expect(screen.getByText("12 agent ticks were blocked in the last hour.")).toBeTruthy();
    expect(screen.getByText("8,750")).toBeTruthy();
    expect(screen.getByText("239")).toBeTruthy();
    expect(screen.getByText("Third")).toBeTruthy();
    expect(screen.queryByText("Fourth")).toBeNull();
    expect(screen.getByText("All 4 items")).toBeTruthy();
    expect(screen.getByText("3 min ago")).toBeTruthy();
  });

  it("shows a publish from minutes ago as minutes, not 0 min", () => {
    render(
      <AtlasOverview
        health={{ ...health, hours_since_last_publish: 0, minutes_since_last_publish: 42 }}
        problems={[]}
        funnel={funnel}
        attention={[]}
      />,
    );
    expect(screen.getByText("42 min ago")).toBeTruthy();
  });

  it("falls back to whole hours for payloads without exact minutes", () => {
    expect(publishMinutes(health)).toBe(360);
    expect(publishMinutes({ ...health, hours_since_last_publish: null })).toBeNull();
    expect(publishMinutes({ ...health, minutes_since_last_publish: 7 })).toBe(7);
  });

  it("reassures when running with nothing to do", () => {
    render(<AtlasOverview health={health} problems={[]} funnel={funnel} attention={[]} />);
    expect(screen.getByText("Pipeline: Running")).toBeTruthy();
    expect(screen.getByText("Nothing needs you right now.")).toBeTruthy();
  });
});
