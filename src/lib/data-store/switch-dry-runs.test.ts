import { describe, expect, it, vi } from "vitest";

import { runSwitchDryRuns } from "@/lib/agents/deming/switch-dry-runs/run";
import { DEFAULT_SWITCH_AUDIT_OPTIONS } from "@/lib/agents/deming/switch-dry-runs/types";
import type { sql } from "@/lib/data-store/connection";
import {
  createSwitchAuditReader,
  DASH_LINE_PG,
  EXCERPT_TAKEDOWN_PATTERNS,
  SECTION_PATH_PG,
  SWITCH_AUDIT_STATEMENTS,
  withReadOnlySwitchAudit,
} from "./switch-dry-runs";

type SqlTag = typeof sql;

/**
 * The only statements the audit may send: its SET and SHOW exactly, and reads that start with
 * SELECT or WITH and name no write, lock, sequence or procedure anywhere (a data-modifying CTE
 * starts with WITH too).
 */
const SET_TIMEOUT = /^SET LOCAL statement_timeout = \d+$/;
const SHOW_READ_ONLY = /^SHOW transaction_read_only$/;
const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|PREPARE|LOCK|VACUUM|ANALYZE|REFRESH|CLUSTER|REINDEX|COMMENT|SECURITY|LISTEN|NOTIFY|INTO|nextval|setval|pg_advisory\w*|lo_\w+|dblink\w*|pg_notify)\b/i;

function allowed(statement: string): boolean {
  const text = statement.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
  if (SET_TIMEOUT.test(text) || SHOW_READ_ONLY.test(text)) return true;
  return /^(WITH|SELECT)\b/i.test(text) && !FORBIDDEN.test(text) && !/\bFOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE|KEY\s+SHARE)\b/i.test(text);
}

/** A stand-in client that records every statement, tagged or unsafe, and answers each read with fixture rows. */
function fakeClient(readOnly = "on") {
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const begins: string[] = [];
  const answer = (text: string): unknown[] => {
    if (text.startsWith("SHOW transaction_read_only")) return [{ transaction_read_only: readOnly }];
    if (text.includes("WITH cap_raw")) {
      return [{ fee_raw_id: 1, institution_id: 10, institution_name: "Bank A", source_document_id: 100, raw_name: "Overdraft Daily Cap", raw_amount: 175,
        product_name: null, outlier_flags: ["canonical_hint:od_daily_cap"], conditions: null, fee_verified_id: null, fee_published_id: null, verify_decision: "needs_review" }];
    }
    if (text.includes("FROM agent_source_texts") && text.includes("DISTINCT ON (source_document_id)")) {
      return [{ source_document_id: 100, institution_id: 10, normalized_text: "Overdraft Daily Cap | $175\nStop Payment | $30.00" }];
    }
    if (text.includes("FROM published_fee_catalog")) {
      return [{ fee_id: 1, fee_published_id: 1, lineage_ref: 1, fee_raw_id: 1, institution_id: 10, source: "knox", source_document_id: 100,
        canonical_fee_key: "stop_payment", fee_name: "Stop Payment", amount: 30, document_url: null }];
    }
    return [];
  };
  const unsafe = vi.fn(async (text: string, params: unknown[] = []) => {
    statements.push({ text, params });
    return answer(text);
  });
  const tag = Object.assign(
    vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("$?");
      statements.push({ text, params: values });
      return answer(text);
    }),
    { unsafe },
  );
  const client = {
    begin: vi.fn(async (options: string, work: (tx: unknown) => Promise<unknown>) => {
      begins.push(options);
      return work(tag);
    }),
  };
  return { client: client as unknown as SqlTag, tag: tag as unknown as SqlTag, statements, begins };
}

describe("switch dry-run reads", () => {
  it("should_refuse_a_data_modifying_statement_in_the_allowlist_check", () => {
    for (const write of [
      "WITH x AS (UPDATE published_fee_records SET amount = 1 RETURNING *) SELECT * FROM x",
      "INSERT INTO agent_run_events (detail) VALUES ('{}')",
      "DELETE FROM published_fee_records",
      "COPY published_fee_records TO STDOUT",
      "CALL refresh_everything()",
      "SELECT nextval('seq')",
      "SELECT pg_advisory_lock(1)",
      "SELECT * FROM published_fee_records FOR UPDATE",
      "SELECT * INTO copy_table FROM published_fee_records",
      "SET statement_timeout = 0",
    ]) {
      expect(allowed(write), write).toBe(false);
    }
  });

  it("should_send_only_allowlisted_statements_in_a_whole_run", async () => {
    const fake = fakeClient();
    const report = await withReadOnlySwitchAudit(
      fake.client,
      (reader) => runSwitchDryRuns(reader, { ...DEFAULT_SWITCH_AUDIT_OPTIONS, accuracySample: 5 }, new Date("2026-11-01T12:00:00Z")),
      { statementTimeoutMs: 30_000, now: new Date("2026-11-01T12:00:00Z") },
    );
    // The run reached every reader: the cap rows, their texts, the fresh audit's sample and its evidence.
    expect(report.dailyCapLines.summary.rows).toBe(1);
    expect(report.liveAccuracy.sampled).toBe(1);
    const texts = fake.statements.map((statement) => statement.text);
    expect(texts.some((text) => text.includes("FROM published_fee_catalog"))).toBe(true);
    expect(texts.some((text) => text.includes("takedown_pending"))).toBe(true);
    for (const text of texts) expect(allowed(text), text).toBe(true);
    for (const statement of SWITCH_AUDIT_STATEMENTS) expect(allowed(statement), statement).toBe(true);
    expect(fake.begins).toEqual(["isolation level repeatable read read only"]);
    expect(texts.slice(0, 2)).toEqual(["SET LOCAL statement_timeout = 30000", "SHOW transaction_read_only"]);
  });

  it("should_refuse_to_run_when_the_session_is_not_read_only", async () => {
    const fake = fakeClient("off");
    const work = vi.fn(async () => "never");
    await expect(withReadOnlySwitchAudit(fake.client, work)).rejects.toThrow(/not read-only/);
    expect(work).not.toHaveBeenCalled();
  });

  it("should_pass_each_read_its_caps_patterns_and_scope", async () => {
    const fake = fakeClient();
    const reader = createSwitchAuditReader(fake.tag, { institutionIds: [3] });
    await reader.dailyCapRows(7);
    await reader.dashListDocuments(8, 16);
    await reader.sectionPathDocuments(11, 2);
    await reader.limitRows(9);
    await reader.excerptLimitTakedowns(10);
    expect(await reader.liveFeesAt([])).toEqual([]);
    await reader.liveFeesAt([3, 4]);
    expect(fake.statements.map((s) => s.params)).toEqual([
      [7, [3]],
      [DASH_LINE_PG, 8, [3], 16],
      [SECTION_PATH_PG, 11, [3], 2],
      [9, 100, expect.any(String), [3]],
      [10, EXCERPT_TAKEDOWN_PATTERNS, [3]],
      [[3, 4]],
    ]);
    expect(EXCERPT_TAKEDOWN_PATTERNS).toEqual(["limit_as_fee:transaction_amount:%", "limit_as_fee:source_states_limit:%"]);
  });

  it("should_prefilter_every_dash_list_line_knox_reads_no_break_spaces_too", () => {
    // Postgres reads the pattern as an ARE; JavaScript reads the same tokens alike.
    const pattern = new RegExp(DASH_LINE_PG);
    for (const line of ["‍$25.00 - NSF Check/ACH/ATM item", "$20.00 - Stop Payment (single check)", "$1,000.50 — Wire Transfer", "$20.00 - Stop Payment"]) {
      expect(pattern.test(line), line).toBe(true);
    }
    // Postgres's own \s misses U+00A0 (8a80f4c used it); the class names it.
    expect(DASH_LINE_PG).toContain("\\u00a0");
    expect(pattern.test("Stop Payment | $35.00")).toBe(false);
  });

  it("should_prefilter_the_texts_the_section_path_can_change", () => {
    // Postgres reads the leading (?i) as the ARE's case-insensitive option; JavaScript takes it as a flag.
    expect(SECTION_PATH_PG.startsWith("(?i)")).toBe(true);
    const pattern = new RegExp(SECTION_PATH_PG.slice(4), "i");
    for (const line of ["Grandfathered Checking Account Types:", "Previously Offered Products", "BUSINESS CUSTOMERS", "Legacy Accounts", "Prior Fee Schedule"]) {
      expect(pattern.test(line), line).toBe(true);
    }
    expect(pattern.test("Stop Payment | $35.00")).toBe(false);
  });
});
