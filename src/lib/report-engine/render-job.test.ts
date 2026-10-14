import { describe, expect, it, vi } from "vitest";

vi.mock("./assemble-and-render", () => ({ assembleAndRender: vi.fn() }));

import { reportArtifactKey, runReportCloseStep, runReportReconcileStep, runReportRenderStep } from "./render-job";
import type { PrintedFigures } from "./reconcile";

type Call = { text: string; values: unknown[] };

function fakeDb(job: Record<string, unknown> | null, liveRows: Record<string, unknown>[] = []) {
  const calls: Call[] = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("FROM report_jobs WHERE id")) return job ? [job] : [];
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
