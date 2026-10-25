/**
 * Rollback rehearsal for Hamilton's feature switches (#1921, V5 item O1).
 *
 * Each switch Hamilton reads is listed here with what "off" (unset) must mean: the behaviour
 * from before the feature. The runbook (docs/runbooks/hamilton-incident.md, "Switches and
 * rollback") points at this file. Turning a switch off is a Vercel environment change and a
 * redeploy, which is James's call; this test shows that doing so restores the prior behaviour.
 *
 * The O1 work itself (task budgets, fault handling, durable report runs) has no switch and no
 * migration: its rollback is a revert of its PR, and these tests also show that code outside a
 * task scope, or with no run ledger, behaves as it did before O1.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(async () => []) }));

import { DEFAULT_HAMILTON_MODEL, getHamiltonModel } from "@/lib/ai-provider";
import { GATE_REPAIR_SWITCH, isGateRepairEnabled, runGatedAnswer } from "./output-gate-repair";
import { reportFindingReadingEnabled } from "./report-saved-finding";
import { currentHamiltonTask, withHamiltonTask } from "./task-budget";
import { openReportRun } from "./report-run";

const OFF_VALUES = [undefined, "", "false", "0", "off", "no", "TRUE-ish"];

describe("Hamilton rollback rehearsal: every switch off restores the prior behaviour", () => {
  it("HAMILTON_GATE_REPAIR off: no repair call, the first draft and its verdict stand", async () => {
    for (const value of OFF_VALUES) {
      const env = value === undefined ? {} : { [GATE_REPAIR_SWITCH]: value };
      expect(isGateRepairEnabled(env)).toBe(false);
      const repair = vi.fn();
      const held = { status: "held", repairable: true, failures: [] } as unknown as ReturnType<Parameters<typeof runGatedAnswer>[0]["gate"]>;
      const result = await runGatedAnswer({ draft: { text: "draft" }, gate: () => held, repair, allowRepair: () => isGateRepairEnabled(env) });
      expect(result).toMatchObject({ repair: "not_allowed", repairCalls: 0, draft: { text: "draft" } });
      expect(repair).not.toHaveBeenCalled();
    }
    for (const value of ["true", "1", "on", " ON "]) expect(isGateRepairEnabled({ [GATE_REPAIR_SWITCH]: value })).toBe(true);
  });

  it("HAMILTON_REPORT_FINDING_READING off: a saved answer's reading is not printed in reports", () => {
    // The report path is covered end to end in report-actions.test.ts ("with the switch off (default) nothing else changes").
    for (const value of OFF_VALUES) {
      expect(reportFindingReadingEnabled(value === undefined ? {} : { HAMILTON_REPORT_FINDING_READING: value })).toBe(false);
    }
    expect(reportFindingReadingEnabled({ HAMILTON_REPORT_FINDING_READING: "on" })).toBe(true);
  });

  it("HAMILTON_MODEL unset: Hamilton uses its default model", () => {
    const saved = process.env.HAMILTON_MODEL;
    try {
      delete process.env.HAMILTON_MODEL;
      expect(getHamiltonModel()).toBe(DEFAULT_HAMILTON_MODEL);
      process.env.HAMILTON_MODEL = "  ";
      expect(getHamiltonModel()).toBe(DEFAULT_HAMILTON_MODEL);
    } finally {
      if (saved === undefined) delete process.env.HAMILTON_MODEL;
      else process.env.HAMILTON_MODEL = saved;
    }
  });

  // The global provider stop (automation control, /admin) is checked first and unchanged by O1:
  // task-budget.test.ts "leaves the global provider stop first and unchanged".

  it("O1 task budgets: a wrapped route returns exactly what its handler returns, and nothing is scoped outside it", async () => {
    const response = new Response("same", { status: 207 });
    const handler = vi.fn(async () => response);
    expect(await withHamiltonTask("ask", handler)()).toBe(response);
    expect(currentHamiltonTask()).toBeNull();
  });

  it("O1 durable report runs: with no run ledger the report path falls back to the pre-O1 flow", async () => {
    // report-actions.test.ts "writes the report without checkpoints when the run ledger is unavailable, as before".
    const opened = await openReportRun({ userId: 1, institutionId: 1, title: "t", taskKey: "k", sectionTitles: ["A"] });
    expect(opened.kind).toBe("unavailable");
  });
});
