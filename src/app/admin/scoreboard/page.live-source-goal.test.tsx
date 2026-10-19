// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { poolAccuracyDays } from "@/lib/agents/deming/accuracy-measure";
import { LIVE_SOURCE_AUDIT_SERIES } from "@/lib/agents/deming/live-source-audit";
import { validateLiveAuditComponent, type LiveAuditComponent } from "@/lib/agents/deming/live-source-audit-records";
import { goalHeadline, type GoalScorecard } from "@/lib/agents/goal-scorecard";

const reads = vi.hoisted(() => ({
  ready: true,
  rows: [] as unknown[],
  current: null as LiveAuditComponent | null,
  auth: vi.fn(),
  snapshots: vi.fn(),
  live: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAuth: reads.auth }));
vi.mock("../answer-key/actions", () => ({ runScoreboardNowAction: vi.fn() }));
vi.mock("@/lib/data-store/answer-key", () => ({
  scoreboardSchemaReady: async () => reads.ready,
  listScoreboardSnapshots: reads.snapshots,
  seriesBreaks: () => [],
}));
vi.mock("@/lib/agents/deming/accuracy-history", () => ({ readAccuracyHistory: async () => null }));
vi.mock("@/lib/data-store/live-source-audit-read", async original => ({
  ...await original<typeof import("@/lib/data-store/live-source-audit-read")>(),
  readLiveSourceAudit: reads.live,
}));
import ScoreboardPage from "./page";

function live({ supported = 1, mismatch = 1, unknown = 0, unattempted = 0,
  state = "complete" }: { supported?: number; mismatch?: number; unknown?: number; unattempted?: number;
    state?: LiveAuditComponent["summary"]["state"] } = {}): LiveAuditComponent {
  const selected = supported + mismatch + unknown + unattempted;
  const expired = state === "expired";
  return { summary: {
    protocol: 1, series: LIVE_SOURCE_AUDIT_SERIES, drawId: 1, day: "2026-10-19",
    asOf: "2026-10-19T12:00:00.000Z", componentAsOf: "2026-10-19T12:01:00.000Z",
    deadline: "2026-10-20T12:00:00.000Z", frameFingerprint: "a".repeat(64), state, reason: null,
    population: selected, selected, attempted: selected - unattempted, supported, mismatch, unknown, unattempted,
    institutions: selected ? 1 : 0, support: !expired && supported + mismatch ? supported / (supported + mismatch) : null,
    envelope: !expired && selected ? { low: supported / selected, high: (supported + unknown + unattempted) / selected } : null,
    byReason: { ...(supported ? { own_current_fee_supported: supported } : {}),
      ...(mismatch ? { positive_current_contradiction: mismatch } : {}),
      ...(unknown ? { live_observation_failed: unknown } : {}) },
    byDimension: mismatch ? { amount: mismatch } : {},
    capture: { requested: 0, pending: 0, captured: 0, failed: 0, blocked: 0, oldestPendingAt: null },
    archiveState: "pending",
  }, archive: null, archiveEventId: null };
}
function goal(component: LiveAuditComponent | null = null): GoalScorecard {
  return {
    readAt: "2026-10-19T12:01:00.000Z", windowDays: 7,
    coverageCells: null, liveInstitutions: null,
    accuracy: { ...poolAccuracyDays([{ at: "2026-10-19T00:00:00Z", right: 999, scorable: 1000,
      accuracy: 0.999, amount: 1, category: 0, evidence: 0, notAFee: 0, name: 0 }]),
      query: "goal.deming_accuracy_7d" },
    wrongAfterPublish: null, spend: null, knoxPasses: null, unstatedAudience: null,
    liveSourceAudit: component,
  };
}
function snapshot(value: GoalScorecard | null) {
  return { snapshot_date: "2026-10-19", goal: value };
}
async function page() {
  document.body.innerHTML = renderToStaticMarkup(await ScoreboardPage({ searchParams: Promise.resolve({}) }));
}
function primary() {
  const heading = [...document.querySelectorAll("h2")].find(node => node.textContent === "The goal");
  expect(heading, "schema-ready live evidence belongs in the primary goal even without a snapshot").toBeDefined();
  return heading!.closest("section")!;
}
function diagnostic() {
  const summary = [...document.querySelectorAll("summary")].find(node => node.textContent?.startsWith("Pipeline diagnostics"));
  expect(summary).toBeDefined();
  return summary!.closest("details")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  reads.ready = true;
  reads.rows = [snapshot(goal(live({ supported: 2, mismatch: 0 })))];
  reads.current = live();
  reads.auth.mockResolvedValue(undefined);
  reads.snapshots.mockImplementation(async () => reads.rows);
  reads.live.mockImplementation(async () => reads.current);
});

describe("actual scorecard primary live-source consumer (#2061)", () => {
  it("renders the real page with valid fixtures, preserves the stored diagnostic and authenticates before data reads", async () => {
    expect(validateLiveAuditComponent(reads.current)).not.toBeNull();
    expect(goal().accuracy?.accuracy).toBe(0.999);
    await page();
    expect(document.body.textContent).toContain("99.9%");
    expect(document.body.textContent).toContain("1 supported, 1 positively contradicted");
    expect(reads.auth).toHaveBeenCalledWith("operate");
    expect(reads.auth.mock.invocationCallOrder[0]).toBeLessThan(reads.live.mock.invocationCallOrder[0]);
    expect(reads.live).toHaveBeenCalledTimes(1);
    expect(reads.snapshots).toHaveBeenCalledWith(30);
  });

  it("makes fresh contradiction evidence primary and keeps 99.9% stored-copy support secondary", async () => {
    await page();
    const current = primary();
    expect(current.textContent).toContain("Live-source support");
    expect(current.textContent).toContain("50.00%");
    expect(current.textContent).toContain("1 positively contradicted");
    expect(current.textContent).not.toMatch(/99\.9%|99\.5|vs a week before/);
    expect(current.textContent).toContain("Missing-fee recall is unmeasured");
    expect(current.textContent).toContain("weekly 50 whole institutions");
    expect(diagnostic().textContent).toContain("Stored-copy support (secondary)");
    expect(diagnostic().textContent).toContain("99.9%");
  });

  it("shows the fresh goal when there are no snapshots", async () => {
    reads.rows = [];
    await page();
    expect(primary().textContent).toContain("50.00%");
    expect(primary().textContent).toContain("1 positively contradicted");
  });

  it("shows the fresh goal when the latest snapshot predates goal fields", async () => {
    reads.rows = [snapshot(null)];
    await page();
    expect(primary().textContent).toContain("50.00%");
  });

  it("never falls back to a high stored or snapshot-live score when the current read is null", async () => {
    reads.current = null;
    await page();
    expect(primary().textContent).toContain("no validated current draw");
    expect(primary().textContent).not.toMatch(/99\.9%|100\.00%|99\.5/);
    expect(diagnostic().textContent).toContain("99.9%");
  });

  it.each([
    ["all unknown", live({ supported: 0, mismatch: 0, unknown: 2 })],
    ["expired", live({ supported: 0, mismatch: 0, unknown: 2, state: "expired" })],
    ["no measurement", live({ supported: 0, mismatch: 0, state: "no_measurement" })],
  ])("keeps %s explicit without a stored-copy percentage", async (_label, component) => {
    expect(validateLiveAuditComponent(component)).not.toBeNull();
    reads.current = component;
    await page();
    expect(primary().textContent).toContain("Live-source support");
    expect(primary().textContent).not.toMatch(/99\.9%|99\.5|Conditional support among scorable fees/);
  });

  it("retains partial denominators without a generic week delta or certification", async () => {
    reads.current = live({ supported: 1, mismatch: 0, unattempted: 1, state: "partial" });
    expect(validateLiveAuditComponent(reads.current)).not.toBeNull();
    await page();
    expect(primary().textContent).toContain("partial");
    expect(primary().textContent).toContain("1 unattempted of 2 selected");
    expect(primary().textContent).toContain("not a confidence interval or certification");
    expect(primary().textContent).not.toMatch(/99\.5|vs a week before|target met/);
  });

  it("rejects malformed current arithmetic instead of reviving a prior high score", async () => {
    reads.current = { ...live(), summary: { ...live().summary, support: 0.999 } };
    expect(validateLiveAuditComponent(reads.current)).toBeNull();
    await page();
    expect(primary().textContent).toContain("no validated current draw");
    expect(primary().textContent).not.toContain("99.9%");
  });
});

describe("primary goal headline uses live evidence (#2061)", () => {
  it("uses fresh conditional support and counts rather than stored-copy support", () => {
    const value = goal(live());
    const text = goalHeadline(value);
    expect(text).toContain("live-source support 50.0%");
    expect(text).toContain("2 scorable of 2");
    expect(text).not.toMatch(/99\.9|stored-copy|99\.5/);
    expect(value.accuracy?.accuracy).toBe(0.999);
  });
  it.each([null, { ...live(), summary: { ...live().summary, support: 0.999 } }])("has no stored fallback when live evidence is absent or invalid", component => {
    const text = goalHeadline(goal(component));
    expect(text).toContain("live-source support unavailable");
    expect(text).not.toMatch(/99\.9|stored-copy/);
  });
  it.each([
    [live({ supported: 0, mismatch: 0, unknown: 2 }), "0 scorable of 2, 2 unknown, 0 unattempted"],
    [live({ supported: 1, mismatch: 0, unattempted: 1, state: "partial" }), "1 scorable of 2, 0 unknown, 1 unattempted"],
    [live({ supported: 0, mismatch: 0, unknown: 2, state: "expired" }), "expired"],
  ])("keeps live state and incomplete denominators in the headline", (component, expected) => {
    expect(validateLiveAuditComponent(component)).not.toBeNull();
    const text = goalHeadline(goal(component));
    expect(text).toContain(expected);
    expect(text).not.toMatch(/99\.9|stored-copy|99\.5|target/);
  });
});
