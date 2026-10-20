// @vitest-environment node
// A cancelled account keeps read-only access to its own report jobs (James, 2026-10-20; #1999).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  job: null as Record<string, unknown> | null,
  queries: [] as string[],
  trigger: vi.fn(),
}));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user, hasPermission: (u: { role: string }) => u.role === "admin" }));
vi.mock("@/lib/report-engine/presign", () => ({ generatePresignedUrl: vi.fn(async () => "https://r2.example.invalid/report.pdf") }));
vi.mock("@/lib/report-agent-runs", () => ({ triggerReportJob: m.trigger }));
vi.mock("@/lib/report-engine/freshness", () => ({ checkFreshness: vi.fn(async () => ({ fresh: true })) }));
vi.mock("@/lib/data-store/connection", () => {
  const db = async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    m.queries.push(text);
    if (text.includes("FROM report_jobs")) return m.job ? [m.job] : [];
    return [];
  };
  return { getSql: () => db, sql: db, withTransaction: async (cb: (t: typeof db) => unknown) => cb(db) };
});

import { GET as download } from "./[id]/download/route";
import { GET as status } from "./[id]/status/route";
import { POST as generate } from "./generate/route";
import { REPORT_START_BLOCKED_MESSAGE } from "@/lib/report-access";

const cancelled = { id: 7, role: "viewer", subscription_status: "canceled", stripe_customer_id: "cus_x" };
const params = { params: Promise.resolve({ id: "job-1" }) };
const req = (path: string, init?: RequestInit) => new Request(`https://example.invalid${path}`, init);
const completeJob = (userId: number) => ({
  id: "job-1", user_id: userId, status: "complete", artifact_key: "reports/job-1.pdf",
  report_type: "national_index", created_at: "2026-09-01", completed_at: "2026-09-01", error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.queries.length = 0;
  m.job = null;
  m.user.mockResolvedValue(cancelled);
});

describe("cancelled account and its legacy report jobs (#1999)", () => {
  it("should_read_and_download_own_completed_report_when_cancelled", async () => {
    m.job = completeJob(7);
    const polled = await status(req("/api/reports/job-1/status"), params);
    expect(polled.status).toBe(200);
    expect((await polled.json()).presigned_url).toBe("https://r2.example.invalid/report.pdf");

    const downloaded = await download(req("/api/reports/job-1/download"), params);
    expect(downloaded.status).toBe(302);
    expect(downloaded.headers.get("location")).toBe("https://r2.example.invalid/report.pdf");
  });

  it("should_deny_another_users_report_job_when_cancelled", async () => {
    m.job = completeJob(8);
    expect((await status(req("/api/reports/job-1/status"), params)).status).toBe(403);
    expect((await download(req("/api/reports/job-1/download"), params)).status).toBe(403);
  });

  it("should_block_starting_a_new_report_job_when_cancelled", async () => {
    const res = await generate(req("/api/reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report_type: "national_index", params: {} }),
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(REPORT_START_BLOCKED_MESSAGE);
    expect(body.href).toMatch(/^\/subscribe\?from=%2Fpro%2Freports/);
    expect(m.queries.some((q) => q.includes("INSERT INTO report_jobs"))).toBe(false);
    expect(m.trigger).not.toHaveBeenCalled();
  });
});
