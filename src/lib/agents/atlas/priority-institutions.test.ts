import { beforeEach, describe, expect, it, vi } from "vitest";

const { startAgentRunMock, loadMarketLeaderIdsMock } = vi.hoisted(() => ({
  startAgentRunMock: vi.fn(),
  loadMarketLeaderIdsMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock, currentDeploy: () => "deploy-now" }));
vi.mock("@/lib/data-store/market-leaders", () => ({ loadMarketLeaderIds: loadMarketLeaderIdsMock }));
vi.mock("@/lib/agents/darwin/verify", () => ({ DARWIN_VERIFY_MAX_LIMIT: 500 }));
vi.mock("@/lib/agents/hamilton/publish", () => ({ HAMILTON_PUBLISH_MAX_LIMIT: 500 }));

import {
  PRIORITY_INSTITUTION_REQUESTS,
  requestWindows,
  PRIORITY_FIXED_BREAK_RUNS,
  PRIORITY_REAPER_RETRY_HOURS,
  PRIORITY_INSTITUTION_SOURCE,
  PRIORITY_MAX_ACTIVE,
  PRIORITY_RULES_REREAD_HOURS,
  PRIORITY_RULES_REREADS_PER_HOUR,
  PRO_INSTITUTION_MIN_FEES,
  priorityInstitutionSteps,
  schedulePriorityInstitutionRuns,
  selectPriorityInstitutions,
} from "./priority-institutions";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";

type Db = Parameters<typeof selectPriorityInstitutions>[0];

function createDb(handler: (text: string) => unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return Promise.resolve(handler(text));
  });
  return { db: db as unknown as Db, calls };
}

describe("priority institutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMarketLeaderIdsMock.mockResolvedValue([7, 9]);
    startAgentRunMock.mockImplementation(async (input: { params: { institution_id: number } }) => ({
      run: { id: 1000 + input.params.institution_id },
      steps: [],
      reused: false,
    }));
  });

  it("lists each requested institution once, the v57 and v62 re-reads, Marketing's outreach batch, then the Tennessee report's largest banks first", () => {
    const ids = PRIORITY_INSTITUTION_REQUESTS.map((request) => request.institutionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 5)).toEqual([78, 41, 25, 124, 135]);
    expect(ids.slice(5, 19)).toEqual([1223, 767, 4715, 8085, 4522, 3331, 4779, 850, 400, 599, 348, 424, 7034, 5579]);
    expect(ids.slice(19, 29)).toEqual([37, 47, 27, 122, 5, 251, 393, 19, 371, 255]);
    expect(ids).toContain(8109);
  });

  it("ranks hand-found schedules, then requests, then large banks with no live overdraft fee", async () => {
    const { db, calls } = createDb(() => [
      { id: "1", institution_name: "JPMorgan Chase Bank, N.A.", state_code: "oh ", tier: "1", hand_link_id: "2070" },
      { id: "8109", institution_name: "Space Coast Federal Credit Union", state_code: "FL", tier: 2, hand_link_id: null },
    ]);

    const rows = await selectPriorityInstitutions(db, { limit: 2, leaderIds: [7, 9] });

    expect(rows).toEqual([
      { id: 1, institution_name: "JPMorgan Chase Bank, N.A.", state_code: "OH", tier: "hand_found", hand_link_id: 2070, paid_document_id: null, rules_version: null },
      { id: 8109, institution_name: "Space Coast Federal Credit Union", state_code: "FL", tier: "requested", hand_link_id: null, paid_document_id: null, rules_version: null },
    ]);
    const { text, values } = calls[0];
    const hand = text.indexOf("hand.found_by_strategy = 'discover.operator_schedule'");
    const requested = text.indexOf("THEN 2");
    const gap = text.indexOf("live.canonical_fee_key = 'overdraft'");
    expect(hand).toBeGreaterThan(0);
    expect(requested).toBeGreaterThan(hand);
    expect(gap).toBeGreaterThan(requested);
    expect(text).toContain("hand.last_fetched_at IS NULL");
    expect(text).toContain("r.status IN ('queued', 'running', 'cancel_requested')");
    expect(text).toContain("CASE WHEN c.tier = 2 THEN array_position(");
    expect(text).toContain("c.tier <> 1 OR c.hand_found_at IS NULL OR r.started_at >= c.hand_found_at");
    expect(values).toContain(PRIORITY_INSTITUTION_SOURCE);
    expect(values).toContainEqual([7, 9]);
    expect(values).toContainEqual(requestWindows(PRIORITY_INSTITUTION_REQUESTS).institutionIds);
  });

  it("ends a request only on a run since it was asked that read a document, and caps a rules version's re-reads an hour", async () => {
    const { db, calls } = createDb(() => []);
    await selectPriorityInstitutions(db, { limit: 2, leaderIds: [] });
    const { text, values } = calls[0];
    // Tier 2 only while no completed request run, started since the request, read a text of the bank.
    const requested = text.indexOf("THEN 2");
    const served = text.indexOf("served.params_json->>'tier' = 'requested'");
    expect(served).toBeGreaterThan(0);
    expect(served).toBeLessThan(requested);
    expect(text).toContain("served.status = 'completed'");
    expect(text).toContain("served.started_at >= asked.since::timestamptz");
    expect(text).toMatch(/read\.agent_run_id = served\.id\s+AND read\.institution_id = inst\.id\s+AND read\.stage = 'extract'\s+AND read\.strategy = /);
    // A lineup correction alone is no read: only Knox's rules pass on a stored text ends a request.
    expect(values).toContain(KNOX_RULES_STRATEGY.strategy);
    expect(values).toContainEqual(requestWindows(PRIORITY_INSTITUTION_REQUESTS).since);
    // A page this version has not read bypasses the retry window only under the hourly cap.
    expect(text).toMatch(/OR NOT c\.rules_unread\s+--[^\n]*\n\s+OR \(\s+SELECT COUNT\(\*\) FROM agent_runs reread/);
    expect(text).toContain("reread.started_at > NOW() - INTERVAL '1 hour'");
    expect(values).toContain(`atlas:priority:%:knox:${KNOX_RULES_STRATEGY.version}`);
    expect(values).toContain(PRIORITY_RULES_REREADS_PER_HOUR);
    expect(PRIORITY_RULES_REREADS_PER_HOUR).toBe(6);
  });

  it("ranks an unread document from the paid fetch right after hand-found schedules, keyed by the document", async () => {
    const { db, calls } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [{ id: 18, institution_name: "Citizens Bank, National Association", state_code: "RI", tier: 4, hand_link_id: null, paid_document_id: 21028 }];
    });

    const result = await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-07T11:30:00Z") });

    expect(result.runs).toEqual([{ institutionId: 18, runId: 1018, tier: "paid_fetched" }]);
    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({
      stateCode: "RI",
      idempotencyKey: "atlas:priority:18:paid:21028",
      params: { institution_id: 18, tier: "paid_fetched" },
    });
    const select = calls.find((call) => call.text.includes("WITH candidates"))!.text;
    expect(select).toContain("paid.strategy LIKE 'fetch.paid_web_fetch%'");
    expect(select).toContain("NOT EXISTS (SELECT 1 FROM agent_source_texts text WHERE text.source_document_id = doc.id)");
    expect(select).toContain("CASE WHEN c.tier = 1 THEN 1 WHEN c.tier = 5 THEN 2 WHEN c.tier = 2 AND c.rules_unread THEN 3 WHEN c.tier = 4 THEN 4 WHEN c.tier = 2 THEN 5 ELSE 6 END");
    expect(select).toContain("c.tier <> 4 OR c.paid_at IS NULL OR r.started_at >= c.paid_at");
    // A hand-found schedule fetched in another state's lane is unread work too (First United, 8 Oct).
    expect(select).toContain("JOIN source_documents hand_doc ON hand_doc.companion_source_id = hand.id");
    expect(select).toContain("NOT EXISTS (SELECT 1 FROM agent_source_texts text WHERE text.source_document_id = hand_doc.id)");
    // A dormant bank with a hand-found schedule still gets its run; a closed charter does not.
    expect(select).toContain("OR (inst.status = 'dormant' AND EXISTS (");
    // A request by name does not wait out the retry window of an earlier overdraft-gap run.
    expect(select).toContain("c.tier <> 2 OR r.params_json->>'tier' = 'requested'");
  });

  it("gives a Pro account's own institution under the fee minimum a direct run, right after hand-found schedules (#1078)", async () => {
    const { db, calls } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [{ id: 8109, institution_name: "Space Coast Federal Credit Union", state_code: "FL", tier: 5, hand_link_id: null, paid_document_id: null, rules_unread: true }];
    });

    const result = await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-13T11:00:00Z") });

    expect(result.runs).toEqual([{ institutionId: 8109, runId: 9109, tier: "pro_institution" }]);
    // Keyed by day, never by a rules version: it runs again after the 24-hour retry window.
    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({
      idempotencyKey: "atlas:priority:8109:2026-10-13",
      params: { institution_id: 8109, tier: "pro_institution" },
    });
    const { text, values } = calls.find((call) => call.text.includes("WITH candidates"))!;
    expect(text).toContain("FROM institution_workspace_memberships pro");
    expect(text).toContain("pro.membership_status = 'active'");
    expect(text.indexOf("FROM institution_workspace_memberships pro")).toBeLessThan(text.indexOf("paid_new.paid_document_id IS NOT NULL THEN 4"));
    expect(values).toContain(PRO_INSTITUTION_MIN_FEES);
    expect(PRO_INSTITUTION_MIN_FEES).toBe(3);
  });

  it("reruns a large bank with no live overdraft fee once per Knox rules version, keyed by the version", async () => {
    const { db, calls } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [{ id: 78, institution_name: "Arvest Bank", state_code: "AR", tier: 3, hand_link_id: null, paid_document_id: null, rules_unread: true }];
    });

    const result = await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-09T06:10:00Z") });

    expect(result.runs).toEqual([{ institutionId: 78, runId: 1078, tier: "overdraft_gap" }]);
    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({
      idempotencyKey: `atlas:priority:78:knox:${KNOX_RULES_STRATEGY.version}`,
      params: { institution_id: 78, tier: "overdraft_gap" },
    });
    const { text, values } = calls.find((call) => call.text.includes("WITH candidates"))!;
    expect(text).toContain("rules_read.strategy_version = ");
    expect(text).toContain("unread_doc.superseded_by_id IS NULL");
    expect(text).toContain("OR NOT c.rules_unread");
    expect(text).toContain("OR r.idempotency_key = ");
    expect(values).toContain(`:knox:${KNOX_RULES_STRATEGY.version}`);
    expect(values).toContain(KNOX_RULES_STRATEGY.strategy);
    expect(values).toContain(KNOX_RULES_STRATEGY.version);
    expect(values).toContain(PRIORITY_RULES_REREAD_HOURS);
  });

  it("reruns a request whose page this Knox version has not read, ahead of paid pages", async () => {
    const { db, calls } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [{ id: 41, institution_name: "Old National Bank", state_code: "IN", tier: 2, hand_link_id: null, paid_document_id: null, rules_unread: true }];
    });

    const result = await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-09T07:50:00Z") });

    expect(result.runs).toEqual([{ institutionId: 41, runId: 1041, tier: "requested" }]);
    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({
      idempotencyKey: `atlas:priority:41:knox:${KNOX_RULES_STRATEGY.version}`,
      params: { institution_id: 41, tier: "requested" },
    });
    const { text } = calls.find((call) => call.text.includes("WITH candidates"))!;
    expect(text).toContain("c.tier NOT IN (2, 3)");
  });

  it("keys an overdraft-gap run its current rules already read by the day", async () => {
    const { db } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [{ id: 78, institution_name: "Arvest Bank", state_code: "AR", tier: 3, hand_link_id: null, paid_document_id: null, rules_unread: false }];
    });

    await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-09T06:10:00Z") });

    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({ idempotencyKey: "atlas:priority:78:2026-10-09" });
  });

  it("runs only free steps, each scoped to the one institution", () => {
    const steps = priorityInstitutionSteps(1);
    expect(steps.map((step) => step.key)).toEqual(["fetch", "read", "extract", "classify", "publish"]);
    expect(steps[0].input).toEqual({ institution_id: 1 });
  });

  it("fills only the free slots, one idempotent run per institution per day", async () => {
    const { db } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 1 }];
      return [{ id: 1, institution_name: "JPMorgan Chase Bank, N.A.", state_code: "OH", tier: 3, hand_link_id: null }];
    });

    const result = await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-07T06:10:00Z") });

    expect(loadMarketLeaderIdsMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ active: 1, selected: 1, scheduled: 1, reused: 0, failed: [] });
    expect(startAgentRunMock).toHaveBeenCalledTimes(1);
    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({
      agent: "atlas",
      kind: "manual_repair",
      stateCode: "OH",
      triggerSource: "schedule",
      idempotencyKey: "atlas:priority:1:2026-10-07",
      params: { source: PRIORITY_INSTITUTION_SOURCE, institution_id: 1, tier: "overdraft_gap" },
    });
  });

  it("keys a hand-found run by its link, so a link added after today's run still runs", async () => {
    const { db } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [{ id: 3, institution_name: "Citibank, N.A.", state_code: "SD", tier: 1, hand_link_id: 2070 }];
    });

    await schedulePriorityInstitutionRuns({ db, now: new Date("2026-10-07T07:30:00Z") });

    expect(startAgentRunMock.mock.calls[0][0]).toMatchObject({
      idempotencyKey: "atlas:priority:3:hand:2070",
      params: { institution_id: 3, tier: "hand_found" },
    });
  });

  it("starts nothing while the slots are full", async () => {
    const { db, calls } = createDb(() => [{ active: PRIORITY_MAX_ACTIVE }]);

    const result = await schedulePriorityInstitutionRuns({ db });

    expect(result).toMatchObject({ active: PRIORITY_MAX_ACTIVE, selected: 0, scheduled: 0 });
    expect(calls).toHaveLength(1);
    expect(loadMarketLeaderIdsMock).not.toHaveBeenCalled();
    expect(startAgentRunMock).not.toHaveBeenCalled();
  });

  it("records a failed start and keeps going", async () => {
    const { db } = createDb((text) => {
      if (text.includes("COUNT(*)::int AS active")) return [{ active: 0 }];
      return [
        { id: 1, institution_name: "A", state_code: "OH", tier: 1 },
        { id: 3, institution_name: "B", state_code: "SD", tier: 1 },
      ];
    });
    startAgentRunMock.mockRejectedValueOnce(new Error("constraint"));

    const result = await schedulePriorityInstitutionRuns({ db });

    expect(result.failed).toEqual([{ institutionId: 1, error: "constraint" }]);
    expect(result.scheduled).toBe(1);
  });

  it("does not let a run that failed on a since-fixed break hold its institution (2877, Oct 8)", async () => {
    const { db, calls } = createDb(() => []);
    await selectPriorityInstitutions(db, { limit: 2, leaderIds: [], deploy: "abc123" });
    const { text, values } = calls[0];
    expect(text).toContain("r.status = 'failed'");
    expect(text).toContain("event.detail->>'deploy' = ?::text");
    expect(values).toContain("abc123");
    expect(values).toContain(PRIORITY_FIXED_BREAK_RUNS);

    // Off Vercel there is no deploy to compare, so every failed run still holds.
    const off = createDb(() => []);
    await selectPriorityInstitutions(off.db, { limit: 2, leaderIds: [], deploy: null });
    expect(off.calls[0].values).toContain(null);
  });

  it("lets a run the reaper failed rerun once, and a reaper failure counts against its own deploy (#2014)", async () => {
    const { db, calls } = createDb(() => []);
    await selectPriorityInstitutions(db, { limit: 2, leaderIds: [], deploy: "abc123" });
    const { text, values } = calls[0];
    // A reaper death (step.dead) holds nothing unless an earlier priority run of the same
    // institution also died by the reaper inside the window.
    expect(text).toContain("dead.event_type = 'step.dead'");
    expect(text).toContain("prev_dead.event_type = 'step.dead'");
    expect(text).toContain("prev.params_json->>'institution_id' = c.id::text");
    expect(values).toContain(PRIORITY_REAPER_RETRY_HOURS);
    // The fixed-break check reads the deploy from reaper deaths too, so a reaper death under
    // the current deploy is not mistaken for a since-fixed break.
    expect(text).toContain("event.event_type IN ('step.failed', 'step.dead')");
  });
});

describe("requestWindows (#1384 follow-up)", () => {
  const base = { institutionName: "Test Bank", reason: "test" };
  it("skips an entry whose requestedAt is not an ISO date, with a warning, so the select's cast never throws", () => {
    const warnings: string[] = [];
    const windows = requestWindows([
      { ...base, institutionId: 1, requestedAt: "Oct 15" },
      { ...base, institutionId: 2, requestedAt: "2026-13-40" },
      { ...base, institutionId: 3, requestedAt: "2026-10-15" },
    ], (message) => warnings.push(message));
    expect(windows).toEqual({ institutionIds: [3], since: ["2026-10-15T00:00:00.000Z"] });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("institution 1");
  });

  it("asks a bank listed twice from its latest dated entry, so asking again reopens it", () => {
    const windows = requestWindows([
      { ...base, institutionId: 7 },
      { ...base, institutionId: 7, requestedAt: "2026-10-16T09:00:00Z" },
      { ...base, institutionId: 7, requestedAt: "2026-10-15" },
      { ...base, institutionId: 8 },
    ]);
    expect(windows).toEqual({ institutionIds: [7, 8], since: ["2026-10-16T09:00:00.000Z", ""] });
  });

  it("reads today's list as one entry per bank, none skipped", () => {
    const warnings: string[] = [];
    const windows = requestWindows(PRIORITY_INSTITUTION_REQUESTS, (message) => warnings.push(message));
    expect(warnings).toEqual([]);
    expect(windows.institutionIds).toEqual([...new Set(PRIORITY_INSTITUTION_REQUESTS.map((request) => request.institutionId))]);
  });
});
