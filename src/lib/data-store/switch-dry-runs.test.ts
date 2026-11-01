import { describe, expect, it, vi } from "vitest";

import type { sql } from "@/lib/data-store/connection";
import {
  createSwitchAuditReader,
  DASH_LINE_PG,
  EXCERPT_TAKEDOWN_PATTERNS,
  SWITCH_AUDIT_STATEMENTS,
  withReadOnlySwitchAudit,
} from "./switch-dry-runs";

type SqlTag = typeof sql;

/** A stand-in client: records every statement, answers `SHOW transaction_read_only` with `readOnly`. */
function fakeClient(readOnly = "on") {
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const begins: string[] = [];
  const unsafe = vi.fn(async (text: string, params: unknown[] = []) => {
    statements.push({ text, params });
    return text.startsWith("SHOW transaction_read_only") ? [{ transaction_read_only: readOnly }] : [];
  });
  const tag = Object.assign(vi.fn(async () => []), { unsafe });
  const client = {
    begin: vi.fn(async (options: string, work: (tx: unknown) => Promise<unknown>) => {
      begins.push(options);
      return work(tag);
    }),
  };
  return { client: client as unknown as SqlTag, tag: tag as unknown as SqlTag, statements, begins };
}

describe("switch dry-run reads", () => {
  it("should_send_only_reads", () => {
    for (const statement of SWITCH_AUDIT_STATEMENTS) {
      expect(statement.trim()).toMatch(/^(WITH|SELECT)\b/);
      expect(statement).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|GRANT|COPY|LOCK)\b/i);
      expect(statement).not.toMatch(/\bFOR\s+(UPDATE|SHARE)\b/i);
    }
  });

  it("should_run_in_a_read_only_repeatable_read_transaction_with_a_statement_timeout", async () => {
    const fake = fakeClient();
    const result = await withReadOnlySwitchAudit(fake.client, async () => "done", { statementTimeoutMs: 30_000 });
    expect(result).toBe("done");
    expect(fake.begins).toEqual(["isolation level repeatable read read only"]);
    expect(fake.statements.map((s) => s.text)).toEqual(["SET LOCAL statement_timeout = 30000", "SHOW transaction_read_only"]);
  });

  it("should_refuse_to_run_when_the_session_is_not_read_only", async () => {
    const fake = fakeClient("off");
    const work = vi.fn(async () => "never");
    await expect(withReadOnlySwitchAudit(fake.client, work)).rejects.toThrow(/not read-only/);
    expect(work).not.toHaveBeenCalled();
  });

  it("should_pass_each_read_its_caps_and_patterns", async () => {
    const fake = fakeClient();
    const reader = createSwitchAuditReader(fake.tag);
    await reader.dailyCapRows(7);
    await reader.dashListDocuments(8);
    await reader.limitRows(9);
    await reader.excerptLimitTakedowns(10);
    expect(await reader.liveFeesAt([])).toEqual([]);
    await reader.liveFeesAt([3, 4]);
    expect(fake.statements.map((s) => s.params)).toEqual([
      [7],
      [DASH_LINE_PG, 8],
      [9, 100, expect.any(String)],
      [10, EXCERPT_TAKEDOWN_PATTERNS],
      [[3, 4]],
    ]);
    expect(EXCERPT_TAKEDOWN_PATTERNS).toEqual(["limit_as_fee:transaction_amount:%", "limit_as_fee:source_states_limit:%"]);
  });

  it("should_prefilter_every_dash_list_line_knox_reads", () => {
    // Postgres reads the pattern as an ARE; these JavaScript stand-ins use the same tokens.
    const pattern = new RegExp(DASH_LINE_PG);
    for (const line of ["‍$25.00 - NSF Check/ACH/ATM item", "$20.00 - Stop Payment (single check)", "- $5 – Notary", "$1,000.50 — Wire Transfer"]) {
      expect(pattern.test(line), line).toBe(true);
    }
    expect(pattern.test("Stop Payment | $35.00")).toBe(false);
  });
});
