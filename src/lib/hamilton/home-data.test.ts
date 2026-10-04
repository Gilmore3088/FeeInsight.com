import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
let queuedRows: unknown[][] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ text: strings.join("?"), values });
  return Promise.resolve(queuedRows.shift() ?? []);
});

vi.mock("@/lib/data-store/connection", () => ({
  sql: sqlMock,
}));

vi.mock("@/lib/data-store/fee-index", () => ({
  getNationalIndexCached: vi.fn(),
  getSourcedInstitutionCount: vi.fn(),
}));

vi.mock("./generate", () => ({
  generateGlobalThesis: vi.fn(),
}));

describe("Hamilton home signal data", () => {
  beforeEach(() => {
    sqlCalls.length = 0;
    queuedRows = [];
    sqlMock.mockClear();
  });

  it("scopes home signals and priority alerts to the selected institution", async () => {
    const { fetchHomeBriefingSignals } = await import("./home-data");

    queuedRows = [
      [
        {
          id: "signal-1",
          institution_id: "2945",
          signal_type: "fee_change",
          severity: "high",
          title: "Fee movement",
          body: "Review the selected institution.",
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
          title: "Fee movement",
          body: "Review the selected institution.",
          evidence_policy: "verified-only",
          provider_call_queued: false,
        },
      ],
      [],
    ];

    const data = await fetchHomeBriefingSignals(7, {
      institutionIds: ["2945", "legacy-name", "2945"],
    });

    expect(data.whatChanged[0]).toMatchObject({
      institutionId: "2945",
      evidencePolicy: "verified-only",
      providerCallQueued: false,
    });
    expect(data.priorityAlerts[0]).toMatchObject({
      institutionId: "2945",
      signalType: "fee_change",
    });
    expect(sqlCalls).toHaveLength(3);
    expect(sqlCalls.every((call) => call.text.includes("ANY"))).toBe(true);
    expect(sqlCalls[0].values).toEqual([["2945"], 5]);
    expect(sqlCalls[1].values).toEqual([7, ["2945"], 3]);
    expect(sqlCalls[2].values).toEqual([["2945"], 3]);
  });

  it("shows no signals (and runs no signal query) when no canonical institution is selected", async () => {
    const { fetchHomeBriefingSignals } = await import("./home-data");

    queuedRows = [[]];

    const signals = await fetchHomeBriefingSignals(7, {
      institutionIds: ["legacy-name", "0", "-1"],
    });

    expect(signals.whatChanged).toEqual([]);
    expect(signals.monitorFeed).toEqual([]);
    // Only the user's own priority alerts are read; never another customer's signals.
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].values).toEqual([7, 3]);
  });

  it("gives the thesis the distinct institution count, not the per-category sum", async () => {
    const feeIndex = await import("@/lib/data-store/fee-index");
    const generate = await import("./generate");
    const entry = (fee_category: string, institution_count: number) => ({
      fee_category, institution_count, median_amount: 30, p25_amount: 25, p75_amount: 35,
      maturity_tier: "strong", fee_family: null, min_amount: 0, max_amount: 40,
      observation_count: institution_count, approved_count: institution_count, bank_count: 0, cu_count: 0, last_updated: null,
    });
    vi.mocked(feeIndex.getNationalIndexCached).mockResolvedValue([entry("overdraft", 300), entry("nsf", 280)] as never);
    vi.mocked(feeIndex.getSourcedInstitutionCount).mockResolvedValue(335);
    vi.mocked(generate.generateGlobalThesis).mockRejectedValue(new Error("offline"));

    const { fetchHomeBriefingData } = await import("./home-data");
    await fetchHomeBriefingData();

    const payload = vi.mocked(generate.generateGlobalThesis).mock.calls[0][0] as { data: { total_institutions: number } };
    expect(payload.data.total_institutions).toBe(335);
  });
});

describe("fetchCacheableHomeBriefing", () => {
  it("throws instead of returning a briefing with no thesis, so the failure is never cached", async () => {
    const feeIndex = await import("@/lib/data-store/fee-index");
    const generate = await import("./generate");
    vi.mocked(feeIndex.getNationalIndexCached).mockResolvedValue([
      { fee_category: "overdraft", institution_count: 30, median_amount: 30, p25_amount: 25, p75_amount: 35, maturity_tier: "strong" },
    ] as never);
    vi.mocked(feeIndex.getSourcedInstitutionCount).mockResolvedValue(30);
    vi.mocked(generate.generateGlobalThesis).mockRejectedValue(new Error("provider down"));

    const { fetchCacheableHomeBriefing } = await import("./home-data");
    await expect(fetchCacheableHomeBriefing()).rejects.toThrow("thesis generation failed");
  });

  it("does not call the provider when the thesis is not requested", async () => {
    const generate = await import("./generate");
    vi.mocked(generate.generateGlobalThesis).mockClear();
    const { fetchHomeBriefingData } = await import("./home-data");
    const data = await fetchHomeBriefingData({ includeThesis: false });
    expect(data.thesis).toBeNull();
    expect(generate.generateGlobalThesis).not.toHaveBeenCalled();
  });
});
