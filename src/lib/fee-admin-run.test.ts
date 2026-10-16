import { describe, expect, it, vi } from "vitest";

import { recordPublicCacheRefresh, retryAdminFeeRefresh } from "./fee-admin-run";

// H03-T08 (#978): a refresh retry is its own visible run linked to the original, rebuilds the
// national index, changes no fee, and refuses a run that is not an operator's fee action.

type Call = { query: string; values: unknown[] };

function createDb(rowsFor: (query: string) => unknown[]) {
  const calls: Call[] = [];
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    return Promise.resolve(rowsFor(query));
  });
  const db = Object.assign(tag, { begin: vi.fn((callback: (tx: typeof tag) => unknown) => callback(tag)) });
  return { db: db as never, calls };
}

const actor = { id: 1, name: "James" };

describe("admin fee refresh retry", () => {
  it("should_refuse_a_run_that_is_not_an_operator_fee_action", async () => {
    const { db, calls } = createDb((query) => (query.includes("FROM agent_runs") ? [] : [{ id: 1 }]));
    const result = await retryAdminFeeRefresh(db, 99, actor);
    expect(result).toEqual({ ok: false, error: "That run is not an operator's fee action." });
    expect(calls.some((c) => c.query.includes("INSERT"))).toBe(false);
  });

  it("should_record_a_linked_run_rebuild_the_index_and_touch_no_fee", async () => {
    const { db, calls } = createDb((query) => {
      if (query.includes("FROM agent_runs")) return [{ id: 41, institution_id: "7" }];
      return [{ id: 50 }];
    });
    const result = await retryAdminFeeRefresh(db, 41, actor);
    expect(result).toMatchObject({ ok: true, runId: 50, retryOf: 41, institutionId: 7 });
    const run = calls.find((c) => c.query.includes("INSERT INTO agent_runs"));
    expect(run?.values).toContain("admin.fee_refresh");
    expect(String(run?.values.find((v) => typeof v === "string" && v.includes("retry_of")))).toContain('"retry_of":41');
    const link = calls.find((c) => c.query.includes("'refresh.retry'"));
    expect(link?.values[0]).toBe(41);
    expect(calls.some((c) => c.query.includes("'index.refresh'"))).toBe(true);
    expect(calls.some((c) => /published_fee_records|published_fee_corrections|pipeline_feedback/.test(c.query))).toBe(false);
  });

  it("should_record_whether_the_page_caches_were_cleared", async () => {
    const { db, calls } = createDb(() => []);
    await recordPublicCacheRefresh(db, 41, false);
    const event = calls[0];
    expect(event.query).toContain("'cache.invalidate'");
    expect(event.values).toContain("failed");
  });
});
