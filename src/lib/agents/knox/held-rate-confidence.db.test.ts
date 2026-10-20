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
  let publish: typeof import("../hamilton/publish");
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
    publish = await import("../hamilton/publish");
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

  it("re-scores rates promoted at the placeholder, and Hamilton decides them once more", async () => {
    await rolledBack(async (scope) => {
      const url = "https://fixture.example/old-rate.pdf";
      const hash = createHash("sha256").update(TEXT).digest("hex");
      const [inst] = await scope`
        INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
        VALUES ('Old promoted rate fixture', 'bank', 'ZW', 'e2e', ${url}) RETURNING id
      `;
      const institutionId = Number(inst.id);
      const [doc] = await scope`
        INSERT INTO source_documents (institution_id, status, document_url, content_hash)
        VALUES (${institutionId}, 'success', ${url}, ${hash}) RETURNING id
      `;
      const note = `Knox rate rules v2 read a percentage fee held for review from Rosetta artifact #1. canonical_hint=card_foreign_txn; text_hash=${hash}; excerpt="${LINE}"`;
      const [raw] = await scope`
        INSERT INTO raw_fee_observations (institution_id, source_document_id, source_url, extraction_confidence, fee_name, amount, extraction_note,
                                          outlier_flags, source, agent_event_id, amount_kind, rate_percent)
        VALUES (${institutionId}, ${doc.id}, ${url}, 0.5, 'Foreign Transaction Fee', NULL, ${note},
                ${JSON.stringify(["needs_darwin_verification", "canonical_hint:card_foreign_txn", held.HELD_RECHECK_PROMOTED_FLAG, "knox_rate_fee"])}::jsonb,
                'knox', '00000000-0000-4000-8000-000000001055', 'percent', 1)
        RETURNING fee_raw_id
      `;
      const [verified] = await scope`
        INSERT INTO verified_fee_observations (fee_raw_id, institution_id, source_url, verified_by_agent_event_id, canonical_fee_key, fee_name,
                                               extraction_confidence, review_status, outlier_flags, amount_kind, rate_percent)
        VALUES (${raw.fee_raw_id}, ${institutionId}, ${url}, gen_random_uuid(), 'card_foreign_txn', 'Foreign Transaction Fee',
                0.5, 'verified', '["agentic_darwin_verified"]'::jsonb, 'percent', 1)
        RETURNING fee_verified_id
      `;
      const fingerprint = publish.verifiedFeeFingerprint(verified.fee_verified_id);
      await scope`
        INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
        VALUES (${institutionId}, 'publish', ${publish.HAMILTON_PUBLISH_STRATEGY.strategy}, ${publish.HAMILTON_PUBLISH_STRATEGY.version},
                ${fingerprint}, 'rejected', ${JSON.stringify({ reason: publish.BELOW_CONFIDENCE_REASON })}::jsonb)
      `;
      const [{ id: runId }] = await scope`
        INSERT INTO agent_runs (id, agent_name, run_kind, title, status)
        VALUES (-105500001, 'hamilton', 'state_agent', 'Held rate confidence fixture', 'running') RETURNING id
      `;
      const attempts = async () => Number((await scope`
        SELECT count(*)::int AS n FROM pipeline_attempts
         WHERE input_fingerprint = ${fingerprint} AND strategy = ${publish.HAMILTON_PUBLISH_STRATEGY.strategy}
      `)[0].n);
      const publishOnce = () => publish.runHamiltonPublish({ db: scope, runId: Number(runId), institutionId, limit: 100, minInstitutionFees: 1 });

      // Still at 0.5: the refusal stands and Hamilton does not decide it again.
      await publishOnce();
      expect(await attempts()).toBe(1);

      expect((await held.rescorePromotedRates(scope, { institutionId, dryRun: true })).rescored).toBe(1);
      const result = await held.rescorePromotedRates(scope, { institutionId, dryRun: false });
      expect(result).toMatchObject({ checked: 1, rescored: 1, verifiedRescored: 1 });
      const expected = rules.confidenceFor(LINE);
      const [rawRow] = await scope`SELECT extraction_confidence FROM raw_fee_observations WHERE fee_raw_id = ${raw.fee_raw_id}`;
      const [verifiedRow] = await scope`SELECT extraction_confidence FROM verified_fee_observations WHERE fee_verified_id = ${verified.fee_verified_id}`;
      expect(Number(rawRow.extraction_confidence)).toBeCloseTo(expected, 4);
      expect(Number(verifiedRow.extraction_confidence)).toBeCloseTo(expected, 4);
      expect((await held.rescorePromotedRates(scope, { institutionId, dryRun: false })).checked).toBe(0);

      // Above the floor now: Hamilton decides the row once more.
      await publishOnce();
      expect(await attempts()).toBe(2);
    });
  });
});
