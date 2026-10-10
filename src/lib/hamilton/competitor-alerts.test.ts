import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn((text: string) => text) }),
  getInstitutionById: vi.fn(),
  getLocalMarketCompetitors: vi.fn(),
  recordHamiltonMonitorSignal: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/data-store/core", () => ({ getInstitutionById: mocks.getInstitutionById }));
vi.mock("@/lib/data-store/local-market", () => ({
  FEE_MOVES_TRACKED_SINCE: "2026-10-05T06:43:00Z",
  getLocalMarketCompetitors: mocks.getLocalMarketCompetitors,
}));
vi.mock("@/lib/hamilton/monitor-signals", () => ({ recordHamiltonMonitorSignal: mocks.recordHamiltonMonitorSignal }));

import {
  COMPETITOR_CHANGE_SIGNAL,
  competitorAlertDedupeKey,
  planCompetitorAlerts,
  runCompetitorAlerts,
  summarizeCompetitorAlerts,
  type CompetitorChangeRow,
} from "./competitor-alerts";

function change(overrides: Partial<CompetitorChangeRow> = {}): CompetitorChangeRow {
  return {
    change_id: 501,
    competitor_id: 9,
    new_fee_published_id: 7001,
    institution_name: "Lone  Star CU",
    state_code: "TX",
    charter_type: "credit_union",
    fee_key: "overdraft",
    fee_name: "Overdraft fee",
    old_fee_name: "Overdraft fee",
    old_amount: "30.00",
    new_amount: "35.00",
    changed_at: "2026-10-06T00:00:00Z",
    source_url: "https://lonestar.example/fees",
    old_document_text: "Overdraft fee $30.00\nStop payment $25.00",
    new_document_text: "Overdraft fee $35.00\nStop payment $25.00",
    ...overrides,
  };
}

describe("planCompetitorAlerts", () => {
  it("alerts on a change the schedules bear out, with the bank's own price beside it", () => {
    const plan = planCompetitorAlerts({
      bankId: 1,
      bankName: "Home Bank",
      ownFees: { overdraft: 32 },
      changes: [change()],
      alreadyAlerted: new Set(),
    });
    expect(plan.alerts).toHaveLength(1);
    const [alert] = plan.alerts;
    expect(alert.title).toBe("Lone Star CU raised its overdraft fee from $30.00 to $35.00");
    expect(alert.body).toContain("Home Bank charges $32.00, $3.00 lower.");
    expect(alert.body).toContain("12-hour second look");
    expect(alert.dedupeKey).toBe(competitorAlertDedupeKey(1, 501));
    expect(`${alert.title} ${alert.body}`).not.toMatch(/cheapest|dearest|Bank Fee Index/i);
  });

  it("drops a reread of the same schedule, a renamed line and a change already shown", () => {
    const plan = planCompetitorAlerts({
      bankId: 1,
      bankName: "Home Bank",
      ownFees: {},
      changes: [
        change({ new_document_text: "Overdraft fee $30.00\nStop payment $25.00" }),
        change({ change_id: 502, old_fee_name: "Paid item fee" }),
        change({ change_id: 503 }),
      ],
      alreadyAlerted: new Set([competitorAlertDedupeKey(1, 503)]),
    });
    expect(plan).toMatchObject({ alerts: [], notConfirmed: 2, alreadyShown: 1 });
  });

  it("drops a price from a different schedule and a jumbled re-read of the same edition (prod, Oct 7)", () => {
    // Tidemark FCU: old price from the business schedule, new from the consumer one.
    const otherPage = change({
      old_source_url: "https://tidemark.example/Business-Fee-Schedule.pdf",
      source_url: "https://tidemark.example/Truth-in-Savings.pdf",
    });
    // Net FCU: one Feb 2026 schedule read twice; the second read paired the wrong column.
    const sameEdition = change({
      change_id: 502,
      fee_key: "stop_payment",
      fee_name: "Stop Payments",
      old_fee_name: "Stop Payments",
      old_amount: "35.00",
      new_amount: "30.00",
      old_document_text: "Duplicate Item Fee | $30.00\nStop Payments | $35.00 | Plastic Cards",
      new_document_text: "Duplicate Item Fee $35.00Stop Payments $30.00 Plastic Cards",
    });
    const plan = planCompetitorAlerts({ bankId: 1, bankName: "Home Bank", ownFees: {}, changes: [otherPage, sameEdition], alreadyAlerted: new Set() });
    expect(plan).toMatchObject({ alerts: [], notConfirmed: 2 });
  });

  it("says when the bank has no published fee to compare", () => {
    const plan = planCompetitorAlerts({ bankId: 1, bankName: "Home Bank", ownFees: {}, changes: [change()], alreadyAlerted: new Set() });
    expect(plan.alerts[0].body).toContain("Home Bank has no published overdraft fee on file.");
  });
});

describe("runCompetitorAlerts", () => {
  function install({
    banks = [{ institution_id: 1, user_ids: [20, 21] }],
    changes = [change()],
    alerted = [] as string[],
    stale = [] as Array<{ id: string; reason: string }>,
  } = {}) {
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("NOT (s.source_json ? 'withdrawn_at')")) return Promise.resolve(stale);
      if (text.includes("FROM institution_workspace_memberships")) return Promise.resolve(banks);
      if (text.includes("FROM published_fee_catalog")) return Promise.resolve([{ fee_category: "overdraft", amount: "32.00" }]);
      if (text.includes("FROM fee_change_records")) return Promise.resolve(changes);
      if (text.includes("FROM hamilton_signals")) return Promise.resolve(alerted.map((dedupe_key) => ({ dedupe_key })));
      return Promise.resolve([]);
    });
  }

  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.sql.unsafe.mockClear();
    mocks.recordHamiltonMonitorSignal.mockReset();
    mocks.getInstitutionById.mockResolvedValue({ institution_name: "Home Bank", cert_number: "123", city: "Austin", state_code: "TX" });
    mocks.getLocalMarketCompetitors.mockResolvedValue({ competitors: [{ institution_id: 9 }, { institution_id: 10 }] });
  });

  it("counts a Pro reader's saved bank as well as paid seats", async () => {
    install({ banks: [] });
    await runCompetitorAlerts({ now: new Date("2026-10-07T12:00:00Z") });
    const query = (mocks.sql.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(query).toContain("FROM institution_workspace_memberships");
    expect(query).toContain("FROM hamilton_workspace_contexts");
  });

  it("raises one Monitor signal per change and an alert for every workspace member", async () => {
    install();
    mocks.recordHamiltonMonitorSignal.mockResolvedValue("00000000-0000-0000-0000-000000000001");
    const result = await runCompetitorAlerts({ now: new Date("2026-10-07T12:00:00Z") });
    expect(result).toMatchObject({ banks: 1, banksWithMarket: 1, competitorsChecked: 2, agedChanges: 1, alerts: 1, memberAlerts: 2 });
    const [input] = mocks.recordHamiltonMonitorSignal.mock.calls[0];
    expect(input).toMatchObject({ institutionId: 1, signalType: COMPETITOR_CHANGE_SIGNAL });
    expect(input.sourceJson).toMatchObject({ dedupe_key: "competitor_change:1:501", competitor_institution_id: 9 });
    const inserts = mocks.sql.mock.calls.filter((c) => (c[0] as TemplateStringsArray).join("?").includes("INSERT INTO hamilton_priority_alerts"));
    expect(inserts).toHaveLength(1);
    expect(summarizeCompetitorAlerts(result)).toContain("Raised 1 alert(s)");
  });

  it("asks only for changes older than the 12-hour second look with no pending takedown", async () => {
    install();
    mocks.recordHamiltonMonitorSignal.mockResolvedValue("x");
    await runCompetitorAlerts({ now: new Date("2026-10-07T12:00:00Z") });
    const call = mocks.sql.mock.calls.find((c) => (c[0] as TemplateStringsArray).join("?").includes("FROM fee_change_records"));
    const text = (call![0] as TemplateStringsArray).join("?");
    expect(text).toContain("takedown_pending");
    expect(text).toContain("agentic_darwin_verified");
    expect(text).toContain("consumer_live.fee_audience IN ('consumer', 'both')");
    expect(text).toContain("consumer_previous.fee_audience = consumer_live.fee_audience");
    expect(call).toContain("2026-10-07T00:00:00.000Z");
  });

  it("writes nothing on a dry run and can preview an institution without a workspace", async () => {
    install({ banks: [] });
    const result = await runCompetitorAlerts({ dryRun: true, institutionId: 224 });
    expect(result).toMatchObject({ dryRun: true, banks: 1, alerts: 1, memberAlerts: 0 });
    expect(result.previews[0].title).toContain("raised its overdraft fee");
    expect(mocks.recordHamiltonMonitorSignal).not.toHaveBeenCalled();
  });

  it("withdraws an earlier alert whose new price is waiting on a takedown, keeping the signal", async () => {
    install({ banks: [], stale: [{ id: "00000000-0000-0000-0000-000000000009", reason: "new price has a pending takedown" }] });
    const result = await runCompetitorAlerts();
    expect(result.withdrawn).toBe(1);
    const texts = mocks.sql.mock.calls.map((c) => (c[0] as TemplateStringsArray).join("?"));
    const find = texts.find((t) => t.includes("NOT (s.source_json ? 'withdrawn_at')"))!;
    expect(find).toContain("takedown_pending");
    expect(find).toContain("like_for_like IS NOT TRUE");
    expect(find).toContain("rolled_back_at IS NOT NULL");
    expect(texts.some((t) => t.includes("UPDATE hamilton_signals") && t.includes("withdrawn_at"))).toBe(true);
    expect(texts.some((t) => t.includes("UPDATE hamilton_priority_alerts") && t.includes("'dismissed'"))).toBe(true);
    expect(texts.some((t) => t.includes("DELETE"))).toBe(false);
    expect(summarizeCompetitorAlerts(result)).toContain("Withdrew 1 earlier alert(s)");
  });

  it("only counts alerts it would withdraw on a dry run", async () => {
    install({ banks: [], stale: [{ id: "00000000-0000-0000-0000-000000000009", reason: "change is not like for like" }] });
    const result = await runCompetitorAlerts({ dryRun: true });
    expect(result.withdrawn).toBe(1);
    const texts = mocks.sql.mock.calls.map((c) => (c[0] as TemplateStringsArray).join("?"));
    expect(texts.some((t) => t.includes("UPDATE"))).toBe(false);
    expect(summarizeCompetitorAlerts(result)).toContain("Would withdraw 1");
  });

  it("says plainly when no institution has a workspace", async () => {
    install({ banks: [] });
    const result = await runCompetitorAlerts();
    expect(summarizeCompetitorAlerts(result)).toContain("No institution has an active workspace");
  });
});
