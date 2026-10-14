// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ calls: [] as Array<{ text: string; values: unknown[] }>, job: null as Record<string, unknown> | null }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/report-engine/presign", () => ({ generatePresignedUrl: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => {
  const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    m.calls.push({ text, values });
    if (text.includes("SELECT data_manifest")) return m.job ? [m.job] : [];
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

  it("rejects a missing secret", async () => {
    const response = await PATCH(new Request("https://example.invalid/x", { method: "PATCH", body: "{}" }), {
      params: Promise.resolve({ id: "job-1" }),
    });
    expect(response.status).toBe(401);
  });
});
