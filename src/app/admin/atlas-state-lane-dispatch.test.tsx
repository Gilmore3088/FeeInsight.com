// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasStateLaneDispatch, AtlasStateLaneDispatchRow } from "@/lib/agents/state-lane-memory";
import { AtlasStateLaneDispatchPanel, snapshotAge } from "./atlas-state-lane-dispatch";
import { ATLAS_RUN_STATUSES_EVENT, finishedLaneRunLabel } from "./atlas-run-statuses";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  runAtlasDueStateLanes: vi.fn(),
  runAtlasStateLane: vi.fn(),
  triggerAgentRunExecution: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("./atlas-actions", () => ({
  runAtlasDueStateLanes: (limit: number) => mocks.runAtlasDueStateLanes(limit),
  runAtlasStateLane: (stateCode: string) => mocks.runAtlasStateLane(stateCode),
}));

vi.mock("@/lib/agents/client-execution", () => ({
  triggerAgentRunExecution: (runId: number) => mocks.triggerAgentRunExecution(runId),
}));

function row(overrides: Partial<AtlasStateLaneDispatchRow>): AtlasStateLaneDispatchRow {
  return {
    stateCode: "CA",
    name: "California",
    status: "scheduled",
    priorityScore: 0,
    backlogMissingUrls: 0,
    backlogStaleSources: 0,
    backlogOcr: 0,
    backlogManualReview: 0,
    failures: 0,
    corrections: 0,
    publicFindings: 0,
    criticalPublicFindings: 0,
    lastAgentRunId: null,
    lastRunAt: null,
    lastSuccessAt: null,
    nextRunAfter: null,
    activeRunId: null,
    activeRunStatus: null,
    ...overrides,
  };
}

function dispatch(rows: AtlasStateLaneDispatchRow[]): AtlasStateLaneDispatch {
  return {
    schemaReady: true,
    generatedAt: "2026-08-15T20:00:00.000Z",
    totalLanes: rows.length,
    dueLanes: 0,
    runningLanes: rows.filter((item) => item.status === "running").length,
    attentionLanes: rows.filter((item) => item.status === "attention").length,
    totalMissingUrls: rows.reduce((sum, item) => sum + item.backlogMissingUrls, 0),
    totalStaleSources: rows.reduce((sum, item) => sum + item.backlogStaleSources, 0),
    totalOcrBacklog: rows.reduce((sum, item) => sum + item.backlogOcr, 0),
    totalManualBacklog: rows.reduce((sum, item) => sum + item.backlogManualReview, 0),
    totalFailures: rows.reduce((sum, item) => sum + item.failures, 0),
    totalCorrections: rows.reduce((sum, item) => sum + item.corrections, 0),
    totalPublicFindings: rows.reduce((sum, item) => sum + item.publicFindings, 0),
    totalCriticalPublicFindings: rows.reduce((sum, item) => sum + item.criticalPublicFindings, 0),
    nextDueAfter: null,
    latestRunAt: null,
    rows,
    stateOptions: rows.map((item) => ({ stateCode: item.stateCode, name: item.name })),
  };
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.runAtlasDueStateLanes.mockReset();
  mocks.runAtlasStateLane.mockReset();
  mocks.triggerAgentRunExecution.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AtlasStateLaneDispatchPanel", () => {
  it("links each state lane to the most relevant repair surface", () => {
    render(
      <AtlasStateLaneDispatchPanel
        dispatch={dispatch([
          row({
            stateCode: "CA",
            name: "California",
            status: "attention",
            publicFindings: 8,
            criticalPublicFindings: 2,
          }),
          row({
            stateCode: "OH",
            name: "Ohio",
            backlogMissingUrls: 4,
          }),
          row({
            stateCode: "WA",
            name: "Washington",
            backlogStaleSources: 3,
            failures: 1,
          }),
          row({
            stateCode: "NY",
            name: "New York",
            status: "running",
            activeRunId: 44,
            activeRunStatus: "running",
          }),
        ])}
        automationEnabled
        executionEnabled
        activeJobCount={0}
      />,
    );

    expect(screen.getByRole("link", { name: "Review pages" })).toHaveAttribute(
      "href",
      "/admin/states/CA#public-discovery-findings",
    );
    expect(screen.getByRole("link", { name: "Resolve URLs" })).toHaveAttribute(
      "href",
      "/admin/states/OH#url-resolution",
    );
    expect(screen.getByRole("link", { name: "Fix sources" })).toHaveAttribute(
      "href",
      "/admin/states/WA#source-memory",
    );
    expect(screen.getByRole("link", { name: "Open run" })).toHaveAttribute(
      "href",
      "/admin/states/NY/runs/44",
    );
  });

  it("marks a snapshot-running lane finished once the live ledger says its run completed", () => {
    render(
      <AtlasStateLaneDispatchPanel
        dispatch={dispatch([
          row({ stateCode: "IA", name: "Iowa", status: "running", activeRunId: 3151, activeRunStatus: "running" }),
        ])}
        automationEnabled
        executionEnabled
        activeJobCount={0}
      />,
    );
    expect(screen.getByText("Running", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/Lane snapshot read Aug 15, 1:00 PM PDT/)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(ATLAS_RUN_STATUSES_EVENT, {
        detail: { generatedAt: "2026-08-15T20:05:00.000Z", runs: [{ id: 3151, status: "completed" }] },
      }));
    });

    expect(screen.queryByText("Running", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByText("Run completed")).toBeInTheDocument();
  });
});

describe("snapshotAge", () => {
  it("says how old a cached snapshot is", () => {
    const read = "2026-10-08T22:00:00.000Z";
    expect(snapshotAge(read, Date.parse("2026-10-08T22:00:20.000Z"))).toBe("under a minute old");
    expect(snapshotAge(read, Date.parse("2026-10-08T22:04:00.000Z"))).toBe("4 min old");
    expect(snapshotAge(read, Date.parse("2026-10-09T00:00:00.000Z"))).toBe("2 hours old");
  });
});

describe("finishedLaneRunLabel", () => {
  it("keeps the snapshot status while the ledger still has the run active or unread", () => {
    const lane = { status: "running" as const, activeRunId: 9 };
    expect(finishedLaneRunLabel(lane, new Map())).toBeNull();
    expect(finishedLaneRunLabel(lane, new Map([[9, "running"]]))).toBeNull();
    expect(finishedLaneRunLabel(lane, new Map([[9, "failed"]]))).toBe("Run failed");
  });
});
