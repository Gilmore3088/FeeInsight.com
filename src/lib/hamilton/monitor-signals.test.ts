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
  buildHamiltonMonitorSignalSourceJson,
  recordHamiltonMonitorSignal,
} from "./monitor-signals";

describe("buildHamiltonMonitorSignalSourceJson", () => {
  it("adds evidence policy and provider metadata to deterministic signals", () => {
    expect(
      buildHamiltonMonitorSignalSourceJson({
        institutionId: 2945,
        signalType: "source_accepted",
        sourceJson: { submission_id: 88 },
      }),
    ).toEqual({
      submission_id: 88,
      institution_id: "2945",
      evidence_policy: "source-diligence",
      provider_call_queued: false,
      monitor_policy_version: "2026-08-15",
    });
  });

  it("rejects signals that would silently queue provider automation", () => {
    expect(
      buildHamiltonMonitorSignalSourceJson({
        institutionId: 2945,
        signalType: "source_accepted",
        sourceJson: { provider_call_queued: true },
      }),
    ).toBeNull();
  });

  it("requires explicit evidence policy for provider-originated movement signals", () => {
    expect(
      buildHamiltonMonitorSignalSourceJson({
        institutionId: 2945,
        signalType: "provider_competitor_movement_detected",
        sourceJson: { source: "provider", provider: "anthropic" },
      }),
    ).toBeNull();

    expect(
      buildHamiltonMonitorSignalSourceJson({
        institutionId: 2945,
        signalType: "provider_competitor_movement_detected",
        sourceJson: {
          source: "provider",
          provider: "anthropic",
          evidence_policy: "source-diligence",
          provider_call_queued: false,
        },
      }),
    ).toMatchObject({
      source: "provider",
      provider: "anthropic",
      evidence_policy: "source-diligence",
      provider_call_queued: false,
      institution_id: "2945",
    });
  });
});

describe("recordHamiltonMonitorSignal", () => {
  beforeEach(() => {
    mocks.state.sqlCalls.length = 0;
    mocks.state.queuedRows.length = 0;
    mocks.sqlMock.mockClear();
    mocks.sqlMock.json.mockClear();
  });

  it("records an institution-scoped Hamilton signal", async () => {
    mocks.state.queuedRows.push([{ id: "e7f37394-d8dd-49ef-a842-e453c89415b5" }]);

    const signalId = await recordHamiltonMonitorSignal({
      institutionId: 2945,
      signalType: "source_accepted",
      severity: "medium",
      title: "Hamilton Bank - official source accepted",
      body: "Data Trust accepted an official source URL.",
      sourceJson: { submission_id: 88 },
    });

    expect(signalId).toBe("e7f37394-d8dd-49ef-a842-e453c89415b5");
    expect(mocks.state.sqlCalls).toHaveLength(1);
    expect(mocks.state.sqlCalls[0].text).toContain("INSERT INTO hamilton_signals");
    expect(mocks.state.sqlCalls[0].values).toEqual([
      "2945",
      "source_accepted",
      "medium",
      "Hamilton Bank - official source accepted",
      "Data Trust accepted an official source URL.",
      {
        json: {
          submission_id: 88,
          institution_id: "2945",
          evidence_policy: "source-diligence",
          provider_call_queued: false,
          monitor_policy_version: "2026-08-15",
        },
      },
    ]);
  });

  it("queues refresh jobs when signal metadata recommends refresh work", async () => {
    mocks.state.queuedRows.push(
      [{ id: "e7f37394-d8dd-49ef-a842-e453c89415b5" }],
      [{ id: "job-report" }],
      [{ id: "job-scenario" }],
    );

    const signalId = await recordHamiltonMonitorSignal({
      institutionId: 2945,
      signalType: "hamilton_publication_completed",
      severity: "high",
      title: "Hamilton Bank - catalog refreshed",
      body: "Hamilton published rows.",
      sourceJson: { refresh_recommended: ["reports", "scenarios"] },
    });

    expect(signalId).toBe("e7f37394-d8dd-49ef-a842-e453c89415b5");
    expect(mocks.state.sqlCalls).toHaveLength(3);
    expect(mocks.state.sqlCalls[1].text).toContain("INSERT INTO hamilton_refresh_jobs");
    expect(mocks.state.sqlCalls[1].values[3]).toBe("report_refresh");
    expect(mocks.state.sqlCalls[2].values[3]).toBe("scenario_refresh");
    expect(mocks.state.sqlCalls[1].values[6]).toMatchObject({
      json: {
        evidence_policy: "verified-only",
        provider_call_queued: false,
      },
    });
  });

  it("adds a user priority alert when requested", async () => {
    mocks.state.queuedRows.push([{ id: "e7f37394-d8dd-49ef-a842-e453c89415b5" }], []);

    await recordHamiltonMonitorSignal({
      institutionId: 8109,
      signalType: "claim_accepted",
      severity: "high",
      title: "Claim accepted",
      body: "Workspace authority is active.",
      priorityAlertUserId: 7,
    });

    expect(mocks.state.sqlCalls).toHaveLength(2);
    expect(mocks.state.sqlCalls[1].text).toContain("INSERT INTO hamilton_priority_alerts");
    expect(mocks.state.sqlCalls[1].values).toEqual([
      7,
      "e7f37394-d8dd-49ef-a842-e453c89415b5",
    ]);
  });

  it("fans a fee-movement signal out as priority alerts to every watcher", async () => {
    mocks.state.queuedRows.push([{ id: "e7f37394-d8dd-49ef-a842-e453c89415b5" }], []);

    await recordHamiltonMonitorSignal({
      institutionId: 8109,
      signalType: "hamilton_fee_movement_detected",
      severity: "high",
      title: "Fee movement",
      body: "Overdraft rose.",
      alertWatchers: true,
    });

    const fanOut = mocks.state.sqlCalls.find((call) => call.text.includes("FROM hamilton_watchlists"));
    expect(fanOut?.text).toContain("INSERT INTO hamilton_priority_alerts");
    expect(fanOut?.values).toEqual(["e7f37394-d8dd-49ef-a842-e453c89415b5", "8109", "[8109]", null]);
  });

  it("skips invalid institution IDs", async () => {
    const signalId = await recordHamiltonMonitorSignal({
      institutionId: 0,
      signalType: "source_accepted",
      severity: "medium",
      title: "Invalid",
      body: "Invalid",
    });

    expect(signalId).toBeNull();
    expect(mocks.state.sqlCalls).toHaveLength(0);
  });

  it("skips unsafe provider-queued signals before writing monitor state", async () => {
    const signalId = await recordHamiltonMonitorSignal({
      institutionId: 2945,
      signalType: "provider_competitor_movement_detected",
      severity: "high",
      title: "Provider movement",
      body: "Provider movement detected.",
      sourceJson: {
        source: "provider",
        evidence_policy: "source-diligence",
        provider_call_queued: true,
      },
    });

    expect(signalId).toBeNull();
    expect(mocks.state.sqlCalls).toHaveLength(0);
  });
});
