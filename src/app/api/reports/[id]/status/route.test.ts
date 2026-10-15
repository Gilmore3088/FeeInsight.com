// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; values: unknown[] }>,
  job: null as Record<string, unknown> | null,
  // The job's status, for the guarded in-progress write; null means no such job.
  status: "pending" as string | null,
}));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/report-engine/presign", () => ({ generatePresignedUrl: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => {
  const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    m.calls.push({ text, values });
    if (text.includes("SELECT data_manifest")) return m.job ? [m.job] : [];
    if (text.includes("SELECT status")) return m.status ? [{ status: m.status }] : [];
    if (text.includes("UPDATE report_jobs") && text.includes("RETURNING id")) {
      return m.status && ["pending", "assembling", "rendering"].includes(m.status) ? [{ id: "job-1" }] : [];
    }
    return [];
  };
  return { getSql: () => tx, withTransaction: async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx) };
});

import { PATCH } from "./route";

const SECRET = "fixture-secret";
const patch = (body: Record<string, unknown>) =>
  PATCH(
    new Request("https://example.invalid/api/reports/job-1/status", {
      method: "PATCH",
      headers: { "x-internal-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "job-1" }) },
  );
const tied = { reconciliation: { ties_out: true } };

beforeEach(() => {
  process.env.REPORT_INTERNAL_SECRET = SECRET;
  m.calls.length = 0;
  m.job = null;
  m.status = "pending";
});

describe("PATCH /api/reports/[id]/status (#1249)", () => {
  it("refuses complete for a job without a reconciliation, and writes nothing", async () => {
    m.job = { data_manifest: { printed: { figures: [] }, reconciliation: null } };
    const response = await patch({ status: "complete", artifact_key: "k" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/no reconciliation that tied out/);
    expect(m.calls.some((call) => call.text.includes("UPDATE report_jobs") || call.text.includes("UPDATE agent_runs"))).toBe(false);
  });

  it("refuses complete when the saved reconciliation did not tie out", async () => {
    m.job = { data_manifest: JSON.stringify({ reconciliation: { ties_out: false } }) };
    expect((await patch({ status: "complete" })).status).toBe(409);
    expect(m.calls.some((call) => call.text.includes("UPDATE report_jobs") || call.text.includes("UPDATE agent_runs"))).toBe(false);
  });

  it("returns 404 for complete on an unknown job", async () => {
    expect((await patch({ status: "complete" })).status).toBe(404);
  });

  it("allows complete for a job whose reconciliation tied out", async () => {
    m.job = { data_manifest: tied };
    const response = await patch({ status: "complete", artifact_key: "k" });
    expect(response.status).toBe(200);
    expect(m.calls[0].text).toContain("FOR UPDATE");
    expect(m.calls.some((call) => call.text.includes("UPDATE report_jobs") && call.values[0] === "complete")).toBe(true);
  });

  it("still accepts failed and in-progress statuses without a reconciliation", async () => {
    expect((await patch({ status: "failed", error: "boom" })).status).toBe(200);
    expect((await patch({ status: "rendering" })).status).toBe(200);
    expect(m.calls.some((call) => call.text.includes("SELECT data_manifest"))).toBe(false);
  });

  // #1259: a failed PATCH without an artifact key keeps the saved one.
  it("keeps the saved artifact key when a terminal PATCH sends none", async () => {
    expect((await patch({ status: "failed", error: "boom" })).status).toBe(200);
    const write = m.calls.find((call) => call.text.includes("UPDATE report_jobs"));
    expect(write?.text).toMatch(/artifact_key = COALESCE\(\?, artifact_key\)/);
    expect(write?.values[1]).toBeNull();
  });

  it("still writes a key a terminal PATCH sends", async () => {
    expect((await patch({ status: "failed", artifact_key: "reports/x.html" })).status).toBe(200);
    const write = m.calls.find((call) => call.text.includes("UPDATE report_jobs"));
    expect(write?.values[1]).toBe("reports/x.html");
  });

  // #1271: a finished or cancelled job is never moved back to an in-progress status.
  it("refuses to reopen a complete, failed or cancelled job, and leaves its agent run alone", async () => {
    for (const status of ["complete", "failed", "cancel_requested", "cancelled"]) {
      m.calls.length = 0;
      m.status = status;
      const response = await patch({ status: "assembling" });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe(`Report job is ${status}, so it cannot be moved back to assembling.`);
      const write = m.calls.find((call) => call.text.includes("UPDATE report_jobs"));
      expect(write?.text).toContain("AND status IN ('pending', 'assembling', 'rendering')");
      expect(m.calls.some((call) => call.text.includes("UPDATE agent_runs"))).toBe(false);
    }
  });

  it("returns 404 for an in-progress status on an unknown job", async () => {
    m.status = null;
    expect((await patch({ status: "rendering" })).status).toBe(404);
  });

  it("rejects a missing secret", async () => {
    const response = await PATCH(new Request("https://example.invalid/x", { method: "PATCH", body: "{}" }), {
      params: Promise.resolve({ id: "job-1" }),
    });
    expect(response.status).toBe(401);
  });
});
