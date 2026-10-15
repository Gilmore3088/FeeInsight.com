// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1259: Publish checks the job and inserts into published_reports in one transaction with
 * the job row locked, and its gate is reconciliationTiesOut (a JSON-string manifest too).
 */
const m = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; values: unknown[]; inTx: boolean }>,
  job: null as Record<string, unknown> | null,
  slugTaken: false,
  inTx: false,
  outsideTx: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (read: unknown) => read }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/lib/agents/run-store", () => ({ cancelAgentRun: vi.fn() }));
vi.mock("@/lib/report-agent-runs", () => ({ triggerReportJob: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => {
  const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    m.calls.push({ text, values, inTx: m.inTx });
    if (text.includes("FROM report_jobs")) return m.job ? [m.job] : [];
    if (text.includes("ON CONFLICT (slug) DO NOTHING")) return m.slugTaken ? [] : [{ slug: values[2] }];
    return [];
  };
  return {
    getSql: () => {
      m.outsideTx += 1;
      return tx;
    },
    withTransaction: async (callback: (t: typeof tx) => Promise<unknown>) => {
      m.inTx = true;
      try {
        return await callback(tx);
      } finally {
        m.inTx = false;
      }
    },
  };
});

import { publishReport } from "./actions";

const tied = { printed: { figures: [] }, reconciliation: { ties_out: true } };
const inserts = () => m.calls.filter((call) => call.text.includes("INSERT INTO published_reports"));

beforeEach(() => {
  m.calls.length = 0;
  m.job = null;
  m.slugTaken = false;
  m.outsideTx = 0;
});

describe("publishReport (#1259)", () => {
  it("locks the job, checks it and inserts in one transaction", async () => {
    m.job = { status: "complete", data_manifest: tied };
    const result = await publishReport("job-1", "National Fee Index", "national_index");
    expect(result).toEqual({ success: true, slug: "national-fee-index" });
    expect(m.calls[0].text).toContain("FOR UPDATE");
    expect(m.calls.every((call) => call.inTx)).toBe(true);
    expect(m.outsideTx).toBe(0);
    expect(inserts()).toHaveLength(1);
  });

  it("reads a manifest saved as a JSON string the same way reconciliationTiesOut does", async () => {
    m.job = { status: "complete", data_manifest: JSON.stringify(tied) };
    expect((await publishReport("job-1", "Pulse", "monthly_pulse")).success).toBe(true);
    m.calls.length = 0;
    m.job = { status: "complete", data_manifest: JSON.stringify({ reconciliation: { ties_out: false } }) };
    const refused = await publishReport("job-1", "Pulse", "monthly_pulse");
    expect(refused.success).toBe(false);
    expect(refused.error).toMatch(/no reconciliation that tied out/);
    expect(inserts()).toHaveLength(0);
  });

  it("refuses a job that is not complete, a manifest that is not JSON, and an unknown job, inserting nothing", async () => {
    m.job = { status: "rendering", data_manifest: tied };
    expect((await publishReport("job-1", "X", "national_index")).error).toMatch(/is rendering, not complete/);
    m.job = { status: "complete", data_manifest: "not json" };
    expect((await publishReport("job-1", "X", "national_index")).success).toBe(false);
    m.job = { status: "complete", data_manifest: null };
    expect((await publishReport("job-1", "X", "national_index")).success).toBe(false);
    m.job = null;
    expect((await publishReport("job-1", "X", "national_index")).error).toMatch(/not found/);
    expect(inserts()).toHaveLength(0);
  });

  it("falls back to a timestamped slug inside the same transaction", async () => {
    m.job = { status: "complete", data_manifest: tied };
    m.slugTaken = true;
    const result = await publishReport("job-1", "National Fee Index", "national_index");
    expect(result.success).toBe(true);
    expect(result.slug).toMatch(/^national-fee-index-\d+$/);
    expect(inserts()).toHaveLength(2);
    expect(inserts().every((call) => call.inTx)).toBe(true);
  });
});
