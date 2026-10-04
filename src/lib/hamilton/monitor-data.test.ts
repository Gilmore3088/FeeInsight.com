import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
let queuedRows: unknown[][] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ text: strings.join("?"), values });
  return Promise.resolve(queuedRows.shift() ?? []);
});

const getHamiltonInstitutionContextMock = vi.fn();

vi.mock("@/lib/data-store/connection", () => ({
  sql: sqlMock,
}));

vi.mock("@/lib/hamilton/institution-context", () => ({
  getHamiltonInstitutionContext: getHamiltonInstitutionContextMock,
}));

import type { HamiltonSelectedInstitutionContext } from "./institution-context";

function institution(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Institution ${id}`,
    feePublicationStatus: "verified",
    insightReadiness: "public_ready",
    ...overrides,
  } as unknown as HamiltonSelectedInstitutionContext;
}

describe("Hamilton monitor data", () => {
  beforeEach(() => {
    sqlCalls.length = 0;
    queuedRows = [];
    sqlMock.mockClear();
    getHamiltonInstitutionContextMock.mockReset();
  });

  it("derives watchlist status from evidence readiness", async () => {
    const { createWatchlistEntryFromInstitution } = await import("./monitor-data");

    expect(
      createWatchlistEntryFromInstitution(
        institution(2945, {
          name: "Verified Bank",
          feePublicationStatus: "verified",
          insightReadiness: "public_ready",
        }),
      ),
    ).toMatchObject({
      institutionId: "2945",
      displayName: "Verified Bank",
      status: "current",
    });

    expect(
      createWatchlistEntryFromInstitution(
        institution(8109, {
          feePublicationStatus: "unavailable",
          insightReadiness: "source_needed",
        }),
      ).status,
    ).toBe("review_due");
  });

  it("scopes monitor signals and alert counts to canonical watchlist institutions", async () => {
    const { fetchMonitorPageData } = await import("./monitor-data");

    queuedRows = [
      [{ institution_ids: ["2945"] }],
      [
        {
          id: "signal-1",
          institution_id: "2945",
          signal_type: "fee_change",
          severity: "high",
          title: "Institution 2945 — overdraft changed",
          body: "Overdraft pricing changed. Review the peer position.",
          created_at: "2026-08-15T12:00:00.000Z",
          evidence_policy: "verified-only",
          provider_call_queued: false,
        },
      ],
      [
        {
          id: "alert-1",
          signal_id: "signal-1",
          status: "active",
          created_at: "2026-08-15T12:00:00.000Z",
          institution_id: "2945",
          signal_type: "fee_change",
          severity: "high",
          title: "Institution 2945 — alert",
          body: "High-priority movement.",
          evidence_policy: "verified-only",
          provider_call_queued: false,
        },
      ],
      [{ count: 1 }],
      [{ count: 1 }],
      [{ count: 1 }],
      [
        {
          id: "job-1",
          institution_id: "2945",
          source_signal_id: "signal-1",
          source_signal_type: "fee_change",
          job_type: "report_refresh",
          status: "queued",
          priority: 3,
          reason: "Institution 2945 — alert",
          created_at: "2026-08-15T12:00:00.000Z",
          updated_at: "2026-08-15T12:00:00.000Z",
          completed_at: null,
        },
      ],
    ];
    getHamiltonInstitutionContextMock.mockResolvedValue({
      institution: institution(2945),
      error: null,
    });

    const data = await fetchMonitorPageData(7);

    expect(data.monitoringScope).toMatchObject({
      institutionIds: ["2945"],
      isScoped: true,
    });
    expect(data.signalFeed[0]).toMatchObject({
      institutionId: "2945",
      signalType: "fee_change",
      evidencePolicy: "verified-only",
      providerCallQueued: false,
    });
    expect(data.topAlert).toMatchObject({
      institutionId: "2945",
      signalType: "fee_change",
      evidencePolicy: "verified-only",
      providerCallQueued: false,
    });
    expect(data.status).toMatchObject({
      overall: "worsening",
      newSignals: 1,
      highPriorityAlerts: 1,
    });
    expect(data.refreshJobs[0]).toMatchObject({
      institutionId: "2945",
      jobType: "report_refresh",
      status: "queued",
    });
    expect(sqlCalls.slice(1).every((call) => call.text.includes("ANY"))).toBe(true);
    expect(sqlCalls[1].values).toEqual([["2945"], 20]);
  });

  it("uses selected institution context when the watchlist is empty", async () => {
    const { fetchMonitorPageData } = await import("./monitor-data");

    queuedRows = [
      [],
      [],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [],
    ];

    const data = await fetchMonitorPageData(7, { selectedInstitutionId: 8109 });

    expect(data.watchlist).toEqual([]);
    expect(data.monitoringScope).toMatchObject({
      institutionIds: ["8109"],
      isScoped: true,
    });
    expect(sqlCalls[1].values).toEqual([["8109"], 20]);
  });

  it("shows no signals for legacy non-canonical watchlist values instead of a global sample", async () => {
    const { fetchMonitorPageData } = await import("./monitor-data");

    queuedRows = [
      [{ institution_ids: ["legacy-bank"] }],
      [],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [],
    ];
    getHamiltonInstitutionContextMock.mockResolvedValue({
      institution: null,
      error: "Invalid institution ID",
    });

    const data = await fetchMonitorPageData(7);

    expect(data.monitoringScope).toMatchObject({
      institutionIds: [],
      isScoped: false,
    });
    expect(data.monitoringScope.label).toContain("matched institutions");
    // No global signal sample: nothing outside the user's scope is ever queried.
    expect(sqlCalls.some((call) => call.text.includes("FROM hamilton_signals") && !call.text.includes("ANY"))).toBe(false);
    expect(data.signalFeed ?? []).toEqual([]);
  });
});
