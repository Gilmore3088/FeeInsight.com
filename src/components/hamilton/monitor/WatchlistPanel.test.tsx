import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HamiltonRefreshJobEntry } from "@/lib/hamilton/refresh-jobs";
import type { WatchlistEntry } from "@/lib/hamilton/monitor-data";
import { WatchlistPanel } from "./WatchlistPanel";

vi.mock("@/app/pro/(hamilton)/monitor/actions", () => ({
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

describe("WatchlistPanel", () => {
  it("lists watched institutions and waiting updates in plain language, in the memo style", () => {
    const entries: WatchlistEntry[] = [
      { institutionId: "2945", displayName: "Example Bank", status: "current" },
    ];
    const refreshJobs: HamiltonRefreshJobEntry[] = [
      {
        id: "job-1",
        institutionId: "2945",
        jobType: "report_refresh",
        status: "queued",
        priority: 2,
        reason: "Published fee movement detected.",
        sourceSignalId: "signal-1",
        sourceSignalType: "hamilton_fee_movement_detected",
        evidencePolicy: "verified-only",
        providerCallQueued: false,
        automationMode: "manual_rerun",
        pipelineStage: "publication",
        createdAt: "2026-08-15T12:00:00.000Z",
        updatedAt: "2026-08-15T12:00:00.000Z",
        completedAt: null,
      },
    ];

    const html = renderToStaticMarkup(
      <WatchlistPanel entries={entries} refreshJobs={refreshJobs} />,
    );

    expect(html).toContain("Institutions you watch");
    expect(html).toContain("Example Bank");
    expect(html).toContain("Fees verified and current");
    expect(html).toContain("Updates waiting");
    expect(html).toContain("Waiting for you to rerun");
    expect(html).toContain('href="/pro/reports?instId=2945&amp;intent=refresh-queue"');
    expect(html).not.toContain("var(--hamilton");
    expect(html).not.toContain("Canonical IDs");
    expect(html).not.toContain("Recurring Value preserves institutional permanence");
    expect(html).not.toContain("Hamilton Strategy Protocol");
    expect(html).not.toContain("Custodial Premium");
  });
});
