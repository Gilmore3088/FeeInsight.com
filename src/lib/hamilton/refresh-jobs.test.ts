import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    sqlCalls: Array<{ text: string; values: unknown[] }>;
    queuedRows: unknown[][];
  } = {
    sqlCalls: [],
    queuedRows: [],
  };

  const sqlMock = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      state.sqlCalls.push({ text: strings.join("?"), values });
      return Promise.resolve(state.queuedRows.shift() ?? []);
    }),
    { json: vi.fn((value: unknown) => ({ json: value })) },
  );

  return { state, sqlMock };
});

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sqlMock,
}));

import {
  completeHamiltonRefreshJobsForInstitution,
  deriveRefreshJobTypes,
  enqueueHamiltonRefreshJobsForSignal,
  fetchQueuedHamiltonRefreshJobs,
} from "./refresh-jobs";

describe("Hamilton refresh jobs", () => {
  beforeEach(() => {
    mocks.state.sqlCalls.length = 0;
    mocks.state.queuedRows.length = 0;
    mocks.sqlMock.mockClear();
    mocks.sqlMock.json.mockClear();
  });

  it("derives job types from refresh recommendations", () => {
    expect(
      deriveRefreshJobTypes({
        refresh_recommended: ["reports", "scenarios", "watchlist", "reports"],
      }),
    ).toEqual(["report_refresh", "scenario_refresh", "watchlist_review"]);
  });

  it("enqueues one durable job per recommended target", async () => {
    mocks.state.queuedRows.push([{ id: "job-report" }], [{ id: "job-watch" }]);

    const inserted = await enqueueHamiltonRefreshJobsForSignal({
      signalId: "e7f37394-d8dd-49ef-a842-e453c89415b5",
      institutionId: 2945,
      signalType: "hamilton_publication_completed",
      severity: "high",
      title: "Hamilton Bank - refresh recommended",
      sourceJson: { refresh_recommended: ["reports", "watchlist"] },
    });

    expect(inserted).toBe(2);
    expect(mocks.state.sqlCalls).toHaveLength(2);
    expect(mocks.state.sqlCalls[0].text).toContain("INSERT INTO hamilton_refresh_jobs");
    expect(mocks.state.sqlCalls[0].text).toContain("ON CONFLICT (source_signal_id, job_type) DO NOTHING");
    expect(mocks.state.sqlCalls[0].values).toEqual([
      "2945",
      "e7f37394-d8dd-49ef-a842-e453c89415b5",
      "hamilton_publication_completed",
      "report_refresh",
      3,
      "Hamilton Bank - refresh recommended",
      { json: { refresh_recommended: ["reports", "watchlist"] } },
    ]);
    expect(mocks.state.sqlCalls[1].values[3]).toBe("watchlist_review");
  });

  it("marks queued institution jobs complete for a workflow", async () => {
    mocks.state.queuedRows.push([{ id: "job-report" }, { id: "job-report-2" }]);

    const completed = await completeHamiltonRefreshJobsForInstitution({
      institutionId: 2945,
      jobTypes: ["report_refresh"],
      completedByUserId: 7,
    });

    expect(completed).toBe(2);
    // Completion is per user: the shared job stays queued for other watchers.
    expect(mocks.state.sqlCalls[0].text).toContain("INSERT INTO hamilton_refresh_job_completions");
    expect(mocks.state.sqlCalls[0].text).not.toContain("UPDATE hamilton_refresh_jobs");
    expect(mocks.state.sqlCalls[0].values).toEqual([7, "2945", ["report_refresh"]]);
  });

  it("closes the shared job only for system completion", async () => {
    mocks.state.queuedRows.push([{ id: "job-report" }]);
    await completeHamiltonRefreshJobsForInstitution({ institutionId: 2945, jobTypes: ["report_refresh"] });
    expect(mocks.state.sqlCalls[0].text).toContain("UPDATE hamilton_refresh_jobs");
  });

  it("fetches queued jobs scoped to canonical institution IDs", async () => {
    mocks.state.queuedRows.push([
      {
        id: "job-1",
        institution_id: "2945",
        source_signal_id: "signal-1",
        source_signal_type: "hamilton_publication_completed",
        job_type: "report_refresh",
        status: "queued",
        priority: 3,
        reason: "Refresh report",
        evidence_policy: "verified-only",
        provider_call_queued: false,
        pipeline_stage: "published_public_ready",
        created_at: "2026-08-15T12:00:00.000Z",
        updated_at: "2026-08-15T12:00:00.000Z",
        completed_at: null,
      },
    ]);

    const jobs = await fetchQueuedHamiltonRefreshJobs({
      institutionIds: ["2945", "legacy-bank"],
      limit: 5,
    });

    expect(jobs).toEqual([
      {
        id: "job-1",
        institutionId: "2945",
        sourceSignalId: "signal-1",
        sourceSignalType: "hamilton_publication_completed",
        jobType: "report_refresh",
        status: "queued",
        priority: 3,
        reason: "Refresh report",
        evidencePolicy: "verified-only",
        providerCallQueued: false,
        automationMode: "manual_rerun",
        pipelineStage: "published_public_ready",
        createdAt: "2026-08-15T12:00:00.000Z",
        updatedAt: "2026-08-15T12:00:00.000Z",
        completedAt: null,
      },
    ]);
    expect(mocks.state.sqlCalls[0].text).toContain("institution_id = ANY");
    expect(mocks.state.sqlCalls[0].text).toContain("hamilton_refresh_job_completions");
    expect(mocks.state.sqlCalls[0].values).toEqual([["2945"], -1, 5]);
  });
});
