// @vitest-environment node
/** Real hot SQL, canonical identity reads and checked in-memory cold files; loopback only. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  db: null as unknown,
  refs: [] as Array<{ source: string; period: string; objectKey: string; rowCount: number; sha256: string }>,
  files: new Map<string, Uint8Array>(),
  members: [] as number[],
}));
vi.mock("@/lib/data-store/connection", async (original) => ({
  ...(await original<typeof import("@/lib/data-store/connection")>()),
  withTransaction: (callback: (tx: unknown) => Promise<unknown>) =>
    (context.db as { begin: (fn: (tx: unknown) => Promise<unknown>) => unknown }).begin(callback),
}));
vi.mock("./cold-reads", async (original) => ({
  ...(await original<typeof import("./cold-reads")>()),
  prunedCallFiles: async () => context.refs,
}));
vi.mock("@/lib/data-store/peer-sets", async (original) => ({
  ...(await original<typeof import("@/lib/data-store/peer-sets")>()),
  getPeerSubject: async (id: number) => ({ id }),
  resolvePeerRequest: async () => ({ definition: { states: ["VA"] }, filters: { institutionIds: context.members }, label: "Institutions in Virginia", market: null }),
  peerSetMemberIds: async () => context.members,
}));
vi.mock("@/lib/agents/hoovie/cold-files", async (original) => ({
  ...(await original<typeof import("@/lib/agents/hoovie/cold-files")>()),
  getColdStore: () => ({ configured: true, bucket: "test", put: async () => { throw new Error("No cold writes in read tests"); },
    get: async (key: string) => { const bytes = context.files.get(key); if (!bytes) throw new Error("Unknown test file"); return bytes; } }),
}));

import { ColdFileWriter } from "@/lib/agents/hoovie/cold-files";
import { CALL_ITEM_COLUMNS } from "@/lib/agents/hoovie/storage-tiers";
import { writtenAnswerCheck } from "@/lib/hamilton/answer-save";
import { queryData } from "./query-data";

const connection = process.env.E2E_DATABASE_URL;
const itemKey = "service_charges_deposits_ytd";
const measure = `call:${itemKey}`;
const period = "2026-06-30";

describe.skipIf(!connection)("canonical cold call-report reads in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Cold SQL tests require a loopback database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, onnotice: () => {} });
    context.db = db;
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, charter_type text, source text, cert_number text,
      ncua_charter_id text, institution_name text, regulatory_status text, closed_date date)`;
    await db`CREATE TEMP TABLE institution_call_report_items (
      institution_id bigint, source text, report_date date, item_code text, item_key text,
      item_description text, schedule text, value numeric, unit text, period_basis text,
      source_url text, fetched_at timestamptz)`;
    await db`CREATE TEMP TABLE institution_structure_events (id bigint, source text, event_key text, institution_id bigint,
      cert text, acquirer_cert text, outgoing_cert text, survivor_cert text, effective_date date,
      change_code text, change_description text, source_url text)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    context.refs = [];
    context.files.clear();
    context.members = [];
    await db`TRUNCATE pg_temp.institution_sources, pg_temp.institution_call_report_items, pg_temp.institution_structure_events`;
  });

  async function seed(hot: "ffiec" | "ncua", cold: "ffiec" | "ncua") {
    context.members = [1, 2, 3, 4, 5, 11, 12, 13, 14, 15];
    const hotCharter = hot === "ffiec" ? "bank" : "credit_union";
    const coldCharter = cold === "ffiec" ? "bank" : "credit_union";
    for (let id = 1; id <= 5; id++) {
      await db`INSERT INTO institution_sources (id, charter_type) VALUES (${id}, ${hotCharter}), (${id + 10}, ${coldCharter})`;
      await db`INSERT INTO institution_call_report_items VALUES (${id}, ${hot}, ${period}, 'TEST', ${itemKey}, 'Fee income', 'RI', 1000, 'dollars', 'ytd', 'https://hot.test', '2026-10-19')`;
    }
    await db`INSERT INTO institution_sources (id, charter_type) VALUES (21, 'unknown')`;
    const writer = new ColdFileWriter(CALL_ITEM_COLUMNS);
    const base = { source: cold, report_date: period, item_code: "TEST", item_key: itemKey,
      item_description: "Fee income", schedule: "RI", unit: "dollars", period_basis: "ytd",
      source_url: "https://cold.test", fetched_at: "2026-10-19", agent_run_id: null };
    writer.push([
      ...Array.from({ length: 5 }, (_, i) => ({ ...base, id: String(i + 1), institution_id: String(i + 11), value: "200" })),
      // Valid archive integrity does not make these wrong-charter/unknown/missing IDs eligible.
      ...[1, 21, 22].map((id) => ({ ...base, id: String(id + 20), institution_id: String(id), value: "999999" })),
    ]);
    const file = writer.finish();
    context.files.set(cold, file.bytes);
    context.refs = [{ source: cold, period, objectKey: cold, rowCount: file.rowCount, sha256: file.sha256 }];
  }

  it.each([
    { hot: "ffiec" as const, cold: "ncua" as const },
    { hot: "ncua" as const, cold: "ffiec" as const },
  ])("returns separate hot $hot and archived $cold medians for the same period", async ({ hot, cold }) => {
    await seed(hot, cold);
    const result = await queryData({ measure, scope: { kind: "national" } });
    expect(result).toMatchObject({ ok: true, rows: [
      expect.objectContaining({ period, sources: hot, median: 1000, institution_count: 5 }),
      expect.objectContaining({ period, sources: cold, median: 200, institution_count: 5 }),
    ] });
    if (result.ok) expect(result.peer_comparison?.cohort_history.periods.map((row) => [row.source, row.reporting_institution_ids, row.reporter_ids_complete])).toEqual([
      [hot, [1, 2, 3, 4, 5], true], [cold, [11, 12, 13, 14, 15], true],
    ]);
  });

  it.each([
    { hot: "ffiec" as const, cold: "ncua" as const },
    { hot: "ncua" as const, cold: "ffiec" as const },
  ])("excludes archived $cold rows for a canonical $hot institution and unknown identity", async ({ hot, cold }) => {
    await seed(hot, cold);
    const result = await queryData({ measure, scope: { kind: "institution", id: "1" } });
    expect(result).toMatchObject({ ok: true, rows: [expect.objectContaining({ source: hot, value: 1000 })] });
    const unknown = await queryData({ measure, scope: { kind: "institution", id: "21" } });
    expect(unknown).toMatchObject({ ok: true, rows: [], unit: null });
  });

  it.each([1, 11, 99])("reports actual source-specific hot/cold inclusion for subject %s", async (subjectId) => {
    await seed("ncua", "ffiec");
    const result = await queryData({ measure, scope: { kind: "peer_set", id: String(subjectId), peer: { states: ["VA"] } } });
    expect(result).toMatchObject({ ok: true, peer_comparison: {
      subject_institution_id: subjectId, subject_in_requested_cohort: subjectId !== 99,
      definition: { states: ["VA"] }, member_count: 10,
    }, rows: [
      expect.objectContaining({ period, sources: "ncua", subject_included: subjectId === 1, reported_count: 5, minimum_median_count: 5 }),
      expect.objectContaining({ period, sources: "ffiec", subject_included: subjectId === 11, reported_count: 5, minimum_median_count: 5 }),
    ] });
  });

  it("keeps a missing subject false in a thin latest filing instead of assuming requested membership", async () => {
    await seed("ncua", "ffiec");
    await db`DELETE FROM pg_temp.institution_call_report_items WHERE institution_id = 1`;
    expect(await queryData({ measure, scope: { kind: "peer_set", id: "1", peer: { states: ["VA"] } } })).toMatchObject({ ok: true,
      peer_comparison: { subject_in_requested_cohort: true, subject_institution_id: 1 },
      rows: [
        expect.objectContaining({ sources: "ncua", subject_included: false, reported_count: 4, median: null }),
        expect.objectContaining({ sources: "ffiec", subject_included: false, reported_count: 5, median: 200 }),
      ],
    });
  });

  it("describes a changing hot/cold historical cohort without dropping an inactive predecessor or creating pro forma growth", async () => {
    context.members = [1, 2, 3, 4, 5, 6, 7];
    for (const id of context.members) {
      await db`INSERT INTO institution_sources (id, charter_type, source, cert_number, ncua_charter_id, institution_name, regulatory_status, closed_date)
        VALUES (${id}, 'credit_union', 'ncua', ${String(100 + id)}, ${String(100 + id)}, ${`Current name ${id}`}, ${id === 1 ? "inactive" : "active"}, ${id === 1 ? "2026-01-01" : null}::date)`;
    }
    // A bank with the same numeric cert must not contaminate the NCUA lifecycle references.
    await db`INSERT INTO institution_sources (id, charter_type, source, cert_number) VALUES (99, 'bank', 'fdic', '102')`;
    for (const id of [2, 3, 4, 5, 6, 7]) {
      await db`INSERT INTO institution_call_report_items VALUES (${id}, 'ncua', '2026-06-30', 'ACCT_131', 'acct_131', 'FEE INCOME', 'IS', ${id === 7 ? 0 : id * 100}, 'dollars', 'ytd', 'https://ncua.gov/new', '2026-10-19')`;
    }
    const writer = new ColdFileWriter(CALL_ITEM_COLUMNS);
    writer.push([1, 2, 3, 4, 5, 6].map((id) => ({ id: String(id), institution_id: String(id), source: "ncua", report_date: "2025-06-30",
      item_code: "ACCT_131", item_key: "acct_131", item_description: "FEE INCOME", schedule: "IS", value: String(id * 100),
      unit: "dollars", period_basis: "ytd", source_url: "https://ncua.gov/old", fetched_at: "2026-10-19", agent_run_id: null })));
    const file = writer.finish(); context.files.set("historical", file.bytes);
    context.refs = [{ source: "ncua", period: "2025-06-30", objectKey: "historical", rowCount: file.rowCount, sha256: file.sha256 }];
    await db`INSERT INTO institution_structure_events VALUES
      (1, 'ncua-mergers', 'completed-reference', NULL, '101', '102', '101', '102', '2026-01-01', 'merger', 'Published event', 'https://ncua.gov/event'),
      (2, 'ncua-proposed-mergers', 'vote', NULL, '101', '102', '101', '102', '2025-12-08', 'proposed_merger', 'Member vote', 'https://ncua.gov/vote'),
      (3, 'ncua-mergers', 'early-ytd-window', NULL, '101', '102', '101', '102', '2025-02-01', 'merger', 'Diagnostic event', 'https://ncua.gov/early'),
      (4, 'ncua-mergers', 'before-window', NULL, '101', '102', '101', '102', '2024-12-31', 'merger', 'Before income period', NULL),
      (5, 'fdic-history', 'wrong-namespace', NULL, '102', NULL, NULL, NULL, '2026-01-01', 'merger', 'Bank event', NULL)`;
    // More than the event cap, newer than valid events: a post-LIMIT filter would lose the real references.
    await db`INSERT INTO institution_structure_events (id, source, event_key, institution_id, cert, effective_date, change_code)
      SELECT id + 1000, CASE WHEN id % 2 = 0 THEN 'unknown-regulator' ELSE 'fdic-history' END,
        'corrupt-link-' || id, 1, '999', '2026-06-01'::date, 'merger' FROM generate_series(1, 220) AS id`;
    const request = { measure: "call:acct_131", scope: { kind: "peer_set", id: "1", peer: { states: ["VA"] } }, period: { from: "2025", to: "2026" } };
    const result = await queryData(request);
    expect(result).toMatchObject({ ok: true, rows: [
      expect.objectContaining({ period: "2026-06-30", median: 350, reported_count: 6, subject_included: false }),
      expect.objectContaining({ period: "2025-06-30", median: 350, reported_count: 6, subject_included: true }),
    ] });
    if (!result.ok) throw new Error(result.reason);
    const history = result.peer_comparison!.cohort_history;
    expect(history.periods.map((row) => row.reporting_institution_ids)).toEqual([[2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6]]);
    expect(history.charter_refs.find((row) => row.institution_id === 1)).toMatchObject({ current_regulatory_status: "inactive", cert_number: "101", identity_state: "resolved" });
    expect(history.charter_refs_complete).toBe(true);
    expect(history.membership_changes).toEqual([expect.objectContaining({ common_ids: [2, 3, 4, 5, 6], added_ids: [7], dropped_ids: [1], complete: true })]);
    expect(history.lifecycle).toMatchObject({ read_status: "complete", coverage: "not_established", window_start: "2025-01-01", window_end: "2026-06-30" });
    expect(history.lifecycle.events.map((row) => row.event_key)).toEqual(["completed-reference", "vote", "early-ytd-window"]);
    expect(history.lifecycle.events[1]).toMatchObject({ certainty: "proposal_not_completion", date_basis: "member_vote" });
    expect(history).toMatchObject({ growth_status: "not_established", merger_adjusted: false, eligibility_basis: "reported_curated_line" });
    // Arrays live only in the history manifest; chart/stat rows keep their scalar contract.
    expect(result.rows.every((row) => Object.values(row).every((value) => value === null || ["number", "string", "boolean"].includes(typeof value)))).toBe(true);
    const reads = [{ toolName: "queryData", input: request, output: result }];
    const check = (text: string) => writtenAnswerCheck(text, [result], "Compare this credit union and its peers over time", { institutionId: 1, toolResults: reads });
    expect(check("The June 2026 peer median NCUA broad fee income was $350 year-to-date. The June 2025 peer median was $350 year-to-date.").passed).toBe(true);
    expect(check("These are separate dated cross-sections. Peer growth cannot be established without membership and merger treatment.").passed).toBe(true);
    for (const text of [
      "The peer income benchmark grew over the year.",
      "The same-charter cohort grew faster than the institution.",
      "The reporting population is unchanged.",
      "Matching charter IDs proves merger-adjusted growth.",
      "The peer median standalone Q2 2026 broad fee income was $350.",
      "FDIC reports the June 2026 peer median bank deposit-account service charges as $350 year-to-date.",
    ]) expect(check(text).passed, text).toBe(false);
  });

});
