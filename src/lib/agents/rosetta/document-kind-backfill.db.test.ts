// @vitest-environment node
/** #1094: stored texts with no kind get one from Rosetta's read step. Real PostgreSQL, no production connection. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const connection = process.env.E2E_DATABASE_URL;
const SCHEDULE = "Schedule of Fees and Charges\nStop payment $30.00\nWire transfer outgoing $25.00\nOverdraft item $32.00\nCashier's check $10.00\nAccount research $25.00 per hour\nStatement copy $5.00";

describe.skipIf(!connection)("document kind backfill", () => {
  let db: typeof import("@/lib/data-store/connection").sql;
  let backfill: typeof import("./document-kind-backfill");
  let kinds: typeof import("@/lib/agents/learning/document-kind");
  const priorUrl = process.env.DATABASE_URL;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Only an isolated loopback database is allowed");
    }
    process.env.DATABASE_URL = connection;
    vi.resetModules();
    ({ sql: db } = await import("@/lib/data-store/connection"));
    backfill = await import("./document-kind-backfill");
    kinds = await import("@/lib/agents/learning/document-kind");
  });
  afterAll(async () => {
    await db?.end();
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
  });

  type Db = typeof db;
  async function rolledBack(work: (scope: Db) => Promise<void>) {
    const rollback = new Error("intentional fixture rollback");
    try {
      await db.begin(async (tx) => { await work(tx as unknown as Db); throw rollback; });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  async function text(scope: Db, institutionId: number, url: string, body: string, kind: string | null, version: number | null) {
    const [doc] = await scope`
      INSERT INTO source_documents (institution_id, status, document_url, content_hash)
      VALUES (${institutionId}, 'success', ${url}, ${`hash-${url}`}) RETURNING id
    `;
    const [row] = await scope`
      INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count, document_kind, document_kind_version)
      VALUES (${doc.id}, ${institutionId}, ${url}, 'pdf', 'completed', ${body}, ${`t-${url}`}, ${body.length}, ${kind}, ${version}) RETURNING id
    `;
    return Number(row.id);
  }

  it("classifies texts with no kind or an old version, and leaves current kinds alone", async () => {
    await rolledBack(async (scope) => {
      const [inst] = await scope`
        INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
        VALUES ('Kind backfill fixture', 'bank', 'ZW', 'e2e', 'https://fixture.example/fees.pdf') RETURNING id
      `;
      const institutionId = Number(inst.id);
      const unclassified = await text(scope, institutionId, "https://fixture.example/fees.pdf", SCHEDULE, null, null);
      const stale = await text(scope, institutionId, "https://fixture.example/old.pdf", SCHEDULE, "other", kinds.DOCUMENT_KIND_VERSION - 1);
      const current = await text(scope, institutionId, "https://fixture.example/current.pdf", SCHEDULE, "other", kinds.DOCUMENT_KIND_VERSION);

      const result = await backfill.backfillDocumentKinds(scope, { dryRun: false, institutionId });
      expect(result.classified).toBe(2);
      expect(result.byKind.fee_schedule).toBe(2);

      const rows = await scope<Array<{ id: number | string; document_kind: string; document_kind_version: number }>>`
        SELECT id, document_kind, document_kind_version FROM agent_source_texts WHERE institution_id = ${institutionId}
      `;
      const byId = new Map(rows.map((row) => [Number(row.id), row]));
      expect(byId.get(unclassified)?.document_kind).toBe("fee_schedule");
      expect(byId.get(stale)?.document_kind).toBe("fee_schedule");
      expect(Number(byId.get(stale)?.document_kind_version)).toBe(kinds.DOCUMENT_KIND_VERSION);
      expect(byId.get(current)?.document_kind).toBe("other");

      expect((await backfill.backfillDocumentKinds(scope, { dryRun: false, institutionId })).classified).toBe(0);
      expect((await backfill.backfillDocumentKinds(scope, { dryRun: true })).classified).toBe(0);
    });
  });

  it("decides a companion page's kind as a read does: a disclosure, not the bank's product page", async () => {
    await rolledBack(async (scope) => {
      const [inst] = await scope`
        INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
        VALUES ('Kind companion fixture', 'bank', 'ZW', 'e2e', 'https://fixture.example/checking') RETURNING id
      `;
      const institutionId = Number(inst.id);
      const body = "Disclosure of Account Terms\nMinimum balance to open $25\nMonthly maintenance fee $5.00\nOverdraft item $32.00";
      const main = await text(scope, institutionId, "https://fixture.example/checking", body, null, null);
      const companion = await text(scope, institutionId, "https://fixture.example/personal/checking", body, null, null);
      await scope`
        UPDATE source_documents SET companion_source_id = 1
         WHERE id = (SELECT source_document_id FROM agent_source_texts WHERE id = ${companion})
      `;
      const empty = await text(scope, institutionId, "https://fixture.example/empty.pdf", "", null, null);

      await backfill.backfillDocumentKinds(scope, { dryRun: false, institutionId });
      const rows = await scope<Array<{ id: number | string; document_kind: string | null }>>`
        SELECT id, document_kind FROM agent_source_texts WHERE institution_id = ${institutionId}
      `;
      const byId = new Map(rows.map((row) => [Number(row.id), row.document_kind]));
      for (const [id, feeSchedule] of [[main, true], [companion, false]] as const) {
        expect(byId.get(id)).toBe(kinds.documentKind({ text: body, url: id === main ? "https://fixture.example/checking" : "https://fixture.example/personal/checking", feeSchedule }).kind);
      }
      expect(byId.get(main)).not.toBe(byId.get(companion));
      // A read stores no kind for an empty text; neither does the backfill.
      expect(byId.get(empty)).toBeNull();
    });
  });
});
