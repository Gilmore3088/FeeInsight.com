import { describe, expect, it, vi } from "vitest";

vi.mock("./assemble-and-render", () => ({ assembleAndRender: vi.fn() }));

import { reportArtifactKey, runReportCloseStep, runReportRenderStep } from "./render-job";

type Call = { text: string; values: unknown[] };

function fakeDb(job: Record<string, unknown> | null) {
  const calls: Call[] = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("SELECT id, report_type, status, params FROM report_jobs")) return job ? [job] : [];
    return [];
  });
  return { db: db as unknown as Parameters<typeof runReportRenderStep>[0], calls };
}

describe("report render step", () => {
  it("renders, stores the HTML and marks the job complete", async () => {
    const { db, calls } = fakeDb({ id: "job-1", report_type: "monthly_pulse", status: "pending", params: { scheduled: true } });
    const render = vi.fn(async () => "<html>report</html>");
    const put = vi.fn(async () => undefined);

    const result = await runReportRenderStep(db, "job-1", { render, store: { put } });

    expect(render).toHaveBeenCalledWith("monthly_pulse", { scheduled: true }, "job-1");
    expect(put).toHaveBeenCalledWith("reports/monthly_pulse/job-1.html", "<html>report</html>", "text/html; charset=utf-8");
    expect(result.status).toBe("completed");
    const complete = calls.find((call) => call.text.includes("status = 'complete'"));
    expect(complete?.values).toEqual([reportArtifactKey("monthly_pulse", "job-1"), "job-1"]);
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
      runReportRenderStep(db, "job-3", { render: vi.fn(async () => "<html/>"), store: { put } }),
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

describe("report close step", () => {
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
