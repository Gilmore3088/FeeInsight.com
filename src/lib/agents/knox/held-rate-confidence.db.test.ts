// @vitest-environment node
/** #1055: a held rate Knox promotes scores its line, not the held 0.5 placeholder. Loopback rollback only. */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const connection = process.env.E2E_DATABASE_URL;
const LINE = "Foreign Transaction Fee 1% of the transaction amount";
const TEXT = `Schedule of Fees\nStop payment $30.00\n${LINE}\nWire transfer outgoing $25.00`;

describe.skipIf(!connection)("held rate promotion confidence", () => {
  let db: typeof import("@/lib/data-store/connection").sql;
  let held: typeof import("./held-recheck");
  let rules: typeof import("./rules");
  const priorUrl = process.env.DATABASE_URL;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Only an isolated loopback database is allowed");
    }
    process.env.DATABASE_URL = connection;
    vi.resetModules();
    ({ sql: db } = await import("@/lib/data-store/connection"));
    held = await import("./held-recheck");
    rules = await import("./rules");
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

  it("sets the promoted rate's confidence from its line", async () => {
    await rolledBack(async (scope) => {
      const url = "https://fixture.example/rate-fees.pdf";
      const hash = createHash("sha256").update(TEXT).digest("hex");
      const [inst] = await scope`
        INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
        VALUES ('Held rate fixture', 'bank', 'ZW', 'e2e', ${url}) RETURNING id
      `;
      const institutionId = Number(inst.id);
      const [doc] = await scope`
        INSERT INTO source_documents (institution_id, status, document_url, content_hash)
        VALUES (${institutionId}, 'success', ${url}, ${hash}) RETURNING id
      `;
      const [text] = await scope`
        INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
        VALUES (${doc.id}, ${institutionId}, ${url}, 'pdf', 'completed', ${TEXT}, ${hash}, ${TEXT.length}) RETURNING id
      `;
      const conditions = `Knox held for review (percentage) from Rosetta artifact #${text.id}. canonical_hint=card_foreign_txn; text_hash=${hash}; excerpt="${LINE}"`;
      const [raw] = await scope`
        INSERT INTO raw_fee_observations (institution_id, source_document_id, source_url, extraction_confidence, fee_name, amount, extraction_note, outlier_flags, source, agent_event_id)
        VALUES (${institutionId}, ${doc.id}, ${url}, 0.5, 'Foreign Transaction Fee', NULL, ${conditions},
                ${JSON.stringify(["knox_review:percentage", "canonical_hint:card_foreign_txn"])}::jsonb, 'knox', '00000000-0000-4000-8000-000000001055')
        RETURNING fee_raw_id
      `;

      const result = await held.recheckHeldRates(scope, { institutionId, dryRun: false });
      expect(result.promoted).toBe(1);

      const [row] = await scope<Array<{ extraction_confidence: number | string; amount_kind: string; outlier_flags: string[] }>>`
        SELECT extraction_confidence, amount_kind, outlier_flags FROM raw_fee_observations WHERE fee_raw_id = ${raw.fee_raw_id}
      `;
      expect(row.amount_kind).toBe("percent");
      expect(row.outlier_flags).toContain("needs_darwin_verification");
      expect(Number(row.extraction_confidence)).toBeCloseTo(rules.confidenceFor(LINE), 4);
      expect(Number(row.extraction_confidence)).toBeGreaterThanOrEqual(0.8);
    });
  });
});
