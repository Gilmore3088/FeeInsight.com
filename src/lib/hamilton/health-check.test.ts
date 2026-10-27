/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  HAMILTON_HEALTH_TABLES,
  HEALTH_ASK_QUESTION,
  HEALTH_EXPORT_FIXTURE,
  askVerdict,
  databaseVerdict,
  exportVerdict,
  hamiltonCheckSkippedReason,
  hamiltonCheckTimeoutMs,
  hamiltonHealthDetail,
  hamiltonHealthProblems,
  liveHamiltonHealthDeps,
  runHamiltonHealth,
  type HamiltonHealthDeps,
} from "./health-check";

const pdf = () => new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2_000, 32)]));

function deps(over: Partial<HamiltonHealthDeps> = {}): HamiltonHealthDeps {
  return {
    probeDatabase: async () => ({ missing: [] }),
    probeAsk: async () => ({ institutionId: 42, kind: "research", shortAnswer: "Your overdraft fee is $30.", hasResearch: true }),
    renderExport: async () => pdf(),
    now: () => 0,
    ...over,
  };
}

describe("Hamilton health check (#1921)", () => {
  it("passes when the database, Ask and export probes all pass", async () => {
    const report = await runHamiltonHealth(deps(), new Date("2026-10-25T12:00:00Z"));
    expect(report.failed).toBe(0);
    expect(report.checks.map((c) => [c.check, c.ok])).toEqual([["database", true], ["ask", true], ["export", true]]);
    expect(report.readAt).toBe("2026-10-25T12:00:00.000Z");
    expect(hamiltonHealthProblems(report)).toEqual([]);
  });

  it("asks the fixed question and checks every Hamilton table", async () => {
    const probeAsk = vi.fn(deps().probeAsk);
    const probeDatabase = vi.fn(deps().probeDatabase);
    const renderExport = vi.fn(deps().renderExport);
    await runHamiltonHealth(deps({ probeAsk, probeDatabase, renderExport }));
    expect(probeAsk).toHaveBeenCalledWith(HEALTH_ASK_QUESTION, "overdraft");
    expect(probeDatabase).toHaveBeenCalledWith(HAMILTON_HEALTH_TABLES);
    expect(renderExport).toHaveBeenCalledWith(HEALTH_EXPORT_FIXTURE);
    expect(HAMILTON_HEALTH_TABLES).toContain("published_fee_catalog");
  });

  it("turns a thrown probe into a failed check with its reason, without stopping the others", async () => {
    const report = await runHamiltonHealth(deps({ probeDatabase: async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:6543"); } }));
    expect(report.failed).toBe(1);
    expect(report.checks[0]).toMatchObject({ check: "database", ok: false, reason: "connect ECONNREFUSED 10.0.0.1:6543" });
    expect(report.checks.slice(1).every((c) => c.ok)).toBe(true);
    expect(hamiltonHealthProblems(report)).toEqual([
      "Hamilton database check failed: connect ECONNREFUSED 10.0.0.1:6543. See docs/runbooks/hamilton-incident.md.",
    ]);
    expect(hamiltonHealthDetail(report)).toMatchObject({ failed: 1, checks: [{ check: "database", ok: false }, { ok: true }, { ok: true }] });
  });

  it("fails a probe that runs past its time limit", async () => {
    vi.useFakeTimers();
    try {
      const pending = runHamiltonHealth(deps({ renderExport: () => new Promise<Uint8Array>(() => undefined) }));
      await vi.advanceTimersByTimeAsync(20_001);
      const report = await pending;
      expect(report.checks[2]).toMatchObject({ check: "export", ok: false, reason: "the export check took longer than 20 seconds" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds every probe to the time limit it is given", async () => {
    vi.useFakeTimers();
    try {
      const pending = runHamiltonHealth(deps({ probeAsk: () => new Promise(() => undefined) }), new Date(), { timeoutMs: 8_000 });
      await vi.advanceTimersByTimeAsync(8_001);
      const report = await pending;
      expect(report.checks[1]).toMatchObject({ check: "ask", ok: false, reason: "the ask check took longer than 8 seconds" });
      expect(report.failed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the probes the brief's time left, up to 20 seconds, and skips them when too little is left", () => {
    // Oct 24 to 26: the brief's other reads took about 20 seconds.
    expect(hamiltonCheckTimeoutMs(0)).toBe(20_000);
    expect(hamiltonCheckTimeoutMs(20_000)).toBe(20_000);
    expect(hamiltonCheckTimeoutMs(30_000)).toBe(15_000);
    expect(hamiltonCheckTimeoutMs(40_000)).toBe(5_000);
    expect(hamiltonCheckTimeoutMs(40_001)).toBeNull();
    expect(hamiltonCheckTimeoutMs(-5)).toBe(20_000);
    const skipped = hamiltonHealthProblems(null, hamiltonCheckSkippedReason(41_400));
    expect(skipped).toEqual([
      "Hamilton health check could not run: the brief's other reads took 41 seconds, leaving too little time to run the check. See docs/runbooks/hamilton-incident.md.",
    ]);
    expect(skipped.join("")).not.toContain("—");
  });

  it("reads each verdict plainly", () => {
    expect(databaseVerdict(["hamilton_reports"])).toEqual({ ok: false, reason: "missing table: hamilton_reports" });
    expect(databaseVerdict([]).ok).toBe(true);
    expect(askVerdict({ institutionId: null, kind: null, shortAnswer: null, hasResearch: false })).toEqual({ ok: false, reason: "no institution publishes an overdraft fee" });
    expect(askVerdict({ institutionId: 7, kind: "research", shortAnswer: "x", hasResearch: false }).ok).toBe(false);
    expect(askVerdict({ institutionId: 7, kind: "clarifying_question", shortAnswer: "Which fee?", hasResearch: true }).ok).toBe(false);
    expect(askVerdict({ institutionId: 7, kind: "research", shortAnswer: " ", hasResearch: true }).ok).toBe(false);
    expect(exportVerdict(new TextEncoder().encode("<html>")).ok).toBe(false);
    expect(exportVerdict(new TextEncoder().encode("%PDF-1.7")).reason).toBe("the analysis PDF was only 8 bytes");
    expect(exportVerdict(pdf()).ok).toBe(true);
  });

  it("names no internal pipeline agent and uses no em dash in what James reads", async () => {
    const report = await runHamiltonHealth(deps({ probeAsk: async () => { throw new Error("boom"); } }));
    const text = [...hamiltonHealthProblems(report), ...hamiltonHealthProblems(null, "down")].join("\n");
    expect(text).not.toMatch(/Atlas|Magellan|Rosetta|Knox|Darwin|Hoovie|Deming/);
    expect(text).not.toContain("—");
  });

  it("renders the real analysis PDF from the fixed answer", async () => {
    const bytes = await liveHamiltonHealthDeps().renderExport(HEALTH_EXPORT_FIXTURE);
    expect(exportVerdict(bytes)).toMatchObject({ ok: true });
  }, 30_000);
});
