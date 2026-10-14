import { describe, expect, it, vi } from "vitest";

vi.mock("./assemble-and-render", () => ({ assembleAndRender: vi.fn() }));

import { reportArtifactKey, runReportCloseStep, runReportReconcileStep, runReportRenderStep } from "./render-job";
import type { PrintedFigures } from "./reconcile";

type Call = { text: string; values: unknown[] };

/**
 * `raced`: the job left 'rendering' (a cancel, say) between the step's opening read and its
 * write, so a write guarded by `status = 'rendering'` changes no row, and a later status read
 * sees this status.
 */
function fakeDb(job: Record<string, unknown> | null, liveRows: Record<string, unknown>[] = [], raced?: string) {
  const calls: Call[] = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (raced && text.includes("SELECT status FROM report_jobs")) return [{ status: raced }];
    if (text.includes("FROM report_jobs WHERE id")) return job ? [job] : [];
    if (text.includes("UPDATE report_jobs") && text.includes("RETURNING id")) {
      return raced && text.includes("AND status = 'rendering'") ? [] : [{ id: job?.id }];
    }
    return [];
  }) as unknown as Record<string, unknown>;
  db.json = (value: unknown) => ({ json: value });
  db.unsafe = vi.fn(async (text: string) => (text.includes("published_fee_catalog") ? liveRows : []));
  return { db: db as unknown as Parameters<typeof runReportRenderStep>[0], calls };
}

const rendered = (html: string, printed: PrintedFigures | null = null) => ({ html, printed, manifest: null });

describe("report render step", () => {
  it("renders, stores the HTML and saves the printed figures; reconciliation completes it", async () => {
    const { db, calls } = fakeDb({ id: "job-1", report_type: "monthly_pulse", status: "pending", params: { scheduled: true } });
    const printed: PrintedFigures = { report_type: "monthly_pulse", figures: [], unchecked: [] };
    const render = vi.fn(async () => rendered("<html>report</html>", printed));
    const put = vi.fn(async () => undefined);

    const result = await runReportRenderStep(db, "job-1", { render, store: { put } });

    expect(render).toHaveBeenCalledWith("monthly_pulse", { scheduled: true }, "job-1");
    expect(put).toHaveBeenCalledWith("reports/monthly_pulse/job-1.html", "<html>report</html>", "text/html; charset=utf-8");
    expect(result.status).toBe("completed");
    expect(calls.some((call) => call.text.includes("status = 'complete'"))).toBe(false);
    const saved = calls.find((call) => call.text.includes("data_manifest ="));
    expect(saved?.values[0]).toBe(reportArtifactKey("monthly_pulse", "job-1"));
    expect(saved?.values[1]).toEqual({ json: { printed, reconciliation: null } });
  });

  it("fails visibly when storage is not configured", async () => {
    const { db, calls } = fakeDb({ id: "job-2", report_type: "national_index", status: "pending", params: null });

    await expect(runReportRenderStep(db, "job-2", { render: vi.fn(), store: null })).rejects.toThrow(/not configured/);
    expect(calls.some((call) => call.text.includes("status = 'failed'"))).toBe(true);
  });

  it("marks the job failed and rethrows when storing fails", async () => {
    const { db, calls } = fakeDb({ id: "job-3", report_type: "national_index", status: "pending", params: "{}" });
    const put = vi.fn(async () => {
      throw new Error("bucket missing");
    });

    await expect(
      runReportRenderStep(db, "job-3", { render: vi.fn(async () => rendered("<html/>")), store: { put } }),
    ).rejects.toThrow(/could not be stored: bucket missing/);
    expect(calls.some((call) => call.text.includes("status = 'complete'"))).toBe(false);
  });

  it("skips a job that is already complete", async () => {
    const { db } = fakeDb({ id: "job-4", report_type: "national_index", status: "complete", params: null });
    const render = vi.fn();

    const result = await runReportRenderStep(db, "job-4", { render, store: { put: vi.fn() } });
    expect(result.status).toBe("skipped");
    expect(render).not.toHaveBeenCalled();
  });

  it("refuses peer briefs, which Hamilton Reports owns", async () => {
    const { db } = fakeDb({ id: "job-5", report_type: "peer_brief", status: "pending", params: null });
    await expect(runReportRenderStep(db, "job-5", { render: vi.fn(), store: { put: vi.fn() } })).rejects.toThrow(
      /not rendered by this step/,
    );
  });
});

const tiedFigure: PrintedFigures = {
  report_type: "state_index",
  figures: [{ kind: "coverage", id: "state:VT.coverage.fee_rows", label: "VT fee rows with live fees", scope: { state: "VT" }, statistic: "fee_rows", printed: 2 }],
  unchecked: [],
};
const liveVt = [
  { institution_id: 1, fee_category: "nsf", amount: 30, charter_type: "bank", state_code: "VT", fed_district: 1, asset_size_tier: null },
  { institution_id: 2, fee_category: "nsf", amount: 25, charter_type: "bank", state_code: "VT", fed_district: 1, asset_size_tier: null },
];

describe("report reconcile step", () => {
  it("completes a rendered job whose figures tie out and records the result", async () => {
    const { db, calls } = fakeDb(
      { id: "job-8", report_type: "state_index", status: "rendering", params: null, artifact_key: "k", data_manifest: { printed: tiedFigure } },
      liveVt,
    );
    const result = await runReportReconcileStep(db, "job-8");
    expect(result.status).toBe("completed");
    expect(result.summary).toMatch(/all 1 printed fee figures tie out/);
    const complete = calls.find((call) => call.text.includes("status = 'complete'"));
    expect((complete?.values[0] as { json: { reconciliation: { ties_out: boolean } } }).json.reconciliation.ties_out).toBe(true);
  });

  it("fails the job, names the figure and throws when a figure does not tie out", async () => {
    const off = { ...tiedFigure, figures: [{ ...tiedFigure.figures[0], printed: 9 } as PrintedFigures["figures"][number]] };
    const { db, calls } = fakeDb(
      { id: "job-9", report_type: "state_index", status: "rendering", params: null, artifact_key: "k", data_manifest: JSON.stringify({ printed: off }) },
      liveVt,
    );
    await expect(runReportReconcileStep(db, "job-9")).rejects.toThrow(/1 of 1 printed fee figures do not tie out. VT fee rows with live fees: printed 9, live 2/);
    const failed = calls.find((call) => call.text.includes("status = 'failed'"));
    expect(failed?.values[0]).toMatch(/blocked the report/);
    expect((failed?.values[1] as { json: { reconciliation: { finding_count: number } } }).json.reconciliation.finding_count).toBe(1);
    expect(calls.some((call) => call.text.includes("status = 'complete'"))).toBe(false);
  });

  it("blocks a rendered job that saved no printed figures", async () => {
    const { db, calls } = fakeDb({ id: "job-10", report_type: "national_index", status: "rendering", params: null, artifact_key: "k", data_manifest: null });
    await expect(runReportReconcileStep(db, "job-10")).rejects.toThrow(/saved no printed figures/);
    expect(calls.some((call) => call.text.includes("status = 'failed'"))).toBe(true);
  });

  it("fails the job, not leaves it rendering, when the live read throws", async () => {
    const { db, calls } = fakeDb({ id: "job-13", report_type: "state_index", status: "rendering", params: null, artifact_key: "k", data_manifest: { printed: tiedFigure } });
    const load = vi.fn(async () => {
      throw new Error("connection reset");
    });
    await expect(runReportReconcileStep(db, "job-13", { load })).rejects.toThrow("Reconcile could not read live data: connection reset");
    const failed = calls.find((call) => call.text.includes("status = 'failed'"));
    expect(failed?.values).toEqual(["Reconcile could not read live data: connection reset", "job-13"]);
  });

  // #1249: a job is never left 'rendering' by an unexpected database error.
  function throwingDb(job: Record<string, unknown>, fail: (text: string) => boolean) {
    const { db: base, calls } = fakeDb(job, liveVt);
    const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (fail(text)) {
        calls.push({ text, values });
        throw new Error("statement timeout");
      }
      return (base as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
    }) as unknown as Record<string, unknown>;
    db.json = (value: unknown) => ({ json: value });
    db.unsafe = (base as unknown as Record<string, unknown>).unsafe;
    return { db: db as unknown as Parameters<typeof runReportRenderStep>[0], calls };
  }
  const renderingJob = { id: "job-14", report_type: "state_index", status: "rendering", params: null, artifact_key: "k", data_manifest: { printed: tiedFigure } };

  it("fails the job and rethrows when the opening read of the job throws", async () => {
    const { db, calls } = throwingDb(renderingJob, (text) => text.includes("SELECT id, report_type"));
    await expect(runReportReconcileStep(db, "job-14")).rejects.toThrow("Reconcile could not read the report job: statement timeout");
    const failed = calls.find((call) => call.text.includes("status = 'failed'"));
    expect(failed?.text).toContain("AND status = 'rendering'");
    expect(failed?.values).toEqual(["Reconcile could not read the report job: statement timeout", "job-14"]);
  });

  it("fails the job and rethrows when marking it complete throws", async () => {
    const { db, calls } = throwingDb(renderingJob, (text) => text.includes("status = 'complete'"));
    const load = vi.fn(async () => ({ feeRows: liveVt, rateRows: [], changeRows: [], pulseCoverage: null }));
    await expect(runReportReconcileStep(db, "job-14", { load })).rejects.toThrow(
      "Reconciled, but the report could not be marked complete: statement timeout",
    );
    const failed = calls.find((call) => call.text.includes("status = 'failed'"));
    expect(failed?.text).toContain("AND status = 'rendering'");
    expect(failed?.values).toEqual(["Reconciled, but the report could not be marked complete: statement timeout", "job-14"]);
  });

  it("still fails a blocked job when saving its findings throws", async () => {
    const off = { ...tiedFigure, figures: [{ ...tiedFigure.figures[0], printed: 9 } as PrintedFigures["figures"][number]] };
    const { db, calls } = throwingDb({ ...renderingJob, data_manifest: { printed: off } }, (text) => text.includes("data_manifest = ?"));
    const load = vi.fn(async () => ({ feeRows: liveVt, rateRows: [], changeRows: [], pulseCoverage: null }));
    await expect(runReportReconcileStep(db, "job-14", { load })).rejects.toThrow(/do not tie out/);
    const fallback = calls.find((call) => call.text.includes("AND status = 'rendering'") && !call.text.includes("data_manifest"));
    expect(fallback?.values[0]).toMatch(/do not tie out.*The findings could not be saved: statement timeout/);
  });

  it("throws the step's own error when the cleanup write fails too", async () => {
    const { db } = throwingDb(renderingJob, (text) => text.includes("SELECT id, report_type") || text.includes("status = 'failed'"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runReportReconcileStep(db, "job-14")).rejects.toThrow("Reconcile could not read the report job: statement timeout");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  // #1259: every write the reconcile step makes is guarded, so a cancel sent mid-step stands.
  it("guards every reconcile write with status = 'rendering'", async () => {
    const off = { ...tiedFigure, figures: [{ ...tiedFigure.figures[0], printed: 9 } as PrintedFigures["figures"][number]] };
    const cases: Array<{ job: Record<string, unknown>; load?: () => Promise<never> }> = [
      { job: { ...renderingJob } },
      { job: { ...renderingJob, data_manifest: { printed: off } } },
      { job: { ...renderingJob, data_manifest: null } },
      { job: { ...renderingJob }, load: async () => Promise.reject(new Error("connection reset")) },
    ];
    for (const { job, load } of cases) {
      const { db, calls } = fakeDb(job, liveVt);
      await runReportReconcileStep(db, "job-14", load ? { load } : {}).catch(() => undefined);
      const writes = calls.filter((call) => call.text.includes("UPDATE report_jobs"));
      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) expect(write.text).toContain("AND status = 'rendering'");
    }
  });

  it("leaves a cancel sent during reconcile in place, and says so, when the figures tie out", async () => {
    const { db, calls } = fakeDb(renderingJob, liveVt, "cancel_requested");
    const result = await runReportReconcileStep(db, "job-14");
    expect(result.status).toBe("skipped");
    expect(result.summary).toMatch(/cancelled during reconciliation.*now cancel_requested\), so it was not marked complete/);
    expect(result.detail).toMatchObject({ lost_race: true, report_status: "cancel_requested", ties_out: true });
    const complete = calls.find((call) => call.text.includes("status = 'complete'"));
    expect(complete?.text).toContain("AND status = 'rendering'");
  });

  it("leaves a cancel in place when the figures do not tie out", async () => {
    const off = { ...tiedFigure, figures: [{ ...tiedFigure.figures[0], printed: 9 } as PrintedFigures["figures"][number]] };
    const { db } = fakeDb({ ...renderingJob, data_manifest: { printed: off } }, liveVt, "cancelled");
    const result = await runReportReconcileStep(db, "job-14");
    expect(result.status).toBe("skipped");
    expect(result.summary).toMatch(/now cancelled\), so it was not marked failed. Reconciliation blocked the report: 1 of 1 printed fee figures do not tie out/);
  });

  it("leaves a cancel in place when the live read fails", async () => {
    const { db } = fakeDb(renderingJob, liveVt, "cancel_requested");
    const load = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const result = await runReportReconcileStep(db, "job-14", { load });
    expect(result.status).toBe("skipped");
    expect(result.summary).toMatch(/not marked failed. Reconcile could not read live data: connection reset/);
  });

  it("throws, naming the status, when the job left rendering for anything but a cancel", async () => {
    const { db } = fakeDb(renderingJob, liveVt, "failed");
    await expect(runReportReconcileStep(db, "job-14")).rejects.toThrow(/it is now failed\), so it was not marked complete/);
  });

  it("throws the step's own reason, not the database error, when the failure write throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const noPrinted = throwingDb({ ...renderingJob, data_manifest: null }, (text) => text.includes("status = 'failed'"));
    await expect(runReportReconcileStep(noPrinted.db, "job-14")).rejects.toThrow(/saved no printed figures to check/);
    const liveDown = throwingDb(renderingJob, (text) => text.includes("status = 'failed'"));
    const load = vi.fn(async () => {
      throw new Error("connection reset");
    });
    await expect(runReportReconcileStep(liveDown.db, "job-14", { load })).rejects.toThrow(
      "Reconcile could not read live data: connection reset",
    );
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("skips a job that was never rendered", async () => {
    const { db, calls } = fakeDb({ id: "job-11", report_type: "national_index", status: "failed", params: null, artifact_key: null, data_manifest: null });
    const result = await runReportReconcileStep(db, "job-11");
    expect(result.status).toBe("skipped");
    expect(calls.some((call) => call.text.includes("UPDATE"))).toBe(false);
  });
});

describe("report close step", () => {
  it("fails a job rendered but not reconciled", async () => {
    const { db, calls } = fakeDb({ id: "job-12", report_type: "state_index", status: "rendering", params: null });
    const result = await runReportCloseStep(db, "job-12");
    expect(result.summary).toMatch(/not reconciled/);
    expect(calls.some((call) => call.text.includes("status = 'failed'"))).toBe(true);
  });

  it("fails a job the render step left pending, with the reason", async () => {
    const { db, calls } = fakeDb({ id: "job-6", report_type: "monthly_pulse", status: "pending", params: null });

    const result = await runReportCloseStep(db, "job-6");
    expect(result.summary).toMatch(/not rendered/);
    expect(calls.some((call) => call.text.includes("status = 'failed'"))).toBe(true);
  });

  it("leaves a complete job alone", async () => {
    const { db, calls } = fakeDb({ id: "job-7", report_type: "monthly_pulse", status: "complete", params: null });

    await runReportCloseStep(db, "job-7");
    expect(calls.some((call) => call.text.includes("UPDATE"))).toBe(false);
  });
});
