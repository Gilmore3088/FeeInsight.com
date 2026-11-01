// @vitest-environment node
/** Evidence-first pilot schema (migration 083) and store, on an isolated loopback PostgreSQL. */
import { createHash, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "./connection";
import {
  addPilotInstitution, EVIDENCE_PILOT_MAX_INSTITUTIONS, EvidencePilotError, recordEvidenceSegment, recordObligationVersion,
  recordSourceFee, scoreEvidencePilot,
} from "./evidence-pilot";

const connection = process.env.E2E_DATABASE_URL;
const migrations = join(__dirname, "../../../supabase/migrations");
const DOC = "Fee Schedule\n🏦 Overdraft Fee   $35.00 per item\nNSF fee: $35.00\nStop Payment – $30.00";

describe.skipIf(!connection)("evidence pilot layer in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  type Db = NonNullable<Parameters<typeof recordEvidenceSegment>[1]>;

  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Evidence pilot SQL tests require a loopback fixture");
    }
    db = postgres(connection, { ssl: "require", prepare: false, onnotice: () => undefined,
      types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    const [ready] = await db`SELECT to_regclass('public.agent_source_text_witnesses') IS NOT NULL AS witness,
                                    to_regclass('public.fee_obligation_versions') IS NOT NULL AS pilot`;
    if (!ready.witness) await db.unsafe(readFileSync(join(migrations, "20270110000067_normalized_source_text_witnesses.sql"), "utf8"));
    if (!ready.pilot) await db.unsafe(readFileSync(join(migrations, "20270110000083_evidence_pilot.sql"), "utf8"));
  });
  afterAll(async () => { await db?.end(); });

  /** Every case runs in a transaction that is rolled back, so append-only tables keep no fixture. */
  async function rolledBack(work: (tx: Db) => Promise<void>) {
    const rollback = new Error("intentional fixture rollback");
    try {
      await db.begin(async (tx) => { await work(tx as unknown as Db); throw rollback; });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  async function witness(tx: Db, text = DOC) {
    const institutionId = randomInt(1_000_000_000, 2_000_000_000);
    const artifactId = randomInt(1_000_000_000, 2_000_000_000);
    const textHash = createHash("sha256").update(text).digest("hex");
    await tx`
      INSERT INTO agent_source_text_witnesses (artifact_id, text_hash, source_document_id, institution_id, normalized_text,
        observed_artifact_status, capture_kind)
      VALUES (${artifactId}, ${textHash}, ${institutionId + 7}, ${institutionId}, ${text}, 'completed', 'incumbent')
    `;
    await addPilotInstitution({ institutionId, cohort: "bank", reason: "fixture", addedBy: "test" }, tx);
    return { institutionId, artifactId, textHash };
  }
  const checkNow = (tx: Db) => tx`SET CONSTRAINTS ALL IMMEDIATE`;
  const deferAgain = (tx: Db) => tx`SET CONSTRAINTS ALL DEFERRED`;
  async function rejects(tx: Db, work: () => Promise<unknown>, message: RegExp) {
    await expect((tx as unknown as postgres.TransactionSql).savepoint(async () => { await work(); })).rejects.toThrow(message);
  }

  it("stores a quote as the exact witness characters, and the database refuses any other text", async () => {
    await rolledBack(async (tx) => {
      const w = await witness(tx);
      const segment = await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "overdraft fee $35.00 per item" }, tx);
      expect(segment?.text).toBe("Overdraft Fee   $35.00 per item");
      const again = await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "Overdraft Fee $35.00 per item" }, tx);
      expect(again?.id).toBe(segment?.id);
      expect(await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "Overdraft Fee $36.00" }, tx)).toBeNull();
      const [dash] = [await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "Stop Payment - $30.00" }, tx)];
      expect(dash?.text).toBe("Stop Payment – $30.00");
      await rejects(tx, () => tx`
        INSERT INTO evidence_segments (institution_id, source_document_id, witness_artifact_id, witness_text_hash, char_start, char_end, segment_text)
        VALUES (${w.institutionId}, ${w.institutionId + 7}, ${w.artifactId}, ${w.textHash}, ${segment!.start}, ${segment!.end}, 'Overdraft Fee   $25.00 per item')
      `, /not the witness text/);
      await rejects(tx, () => tx`UPDATE evidence_segments SET segment_text = segment_text WHERE id = ${segment!.id}`, /append-only/);
    });
  });

  it("keeps the pilot to its own institutions and to ten of them", async () => {
    await rolledBack(async (tx) => {
      const textHash = createHash("sha256").update(DOC).digest("hex");
      await tx`
        INSERT INTO agent_source_text_witnesses (artifact_id, text_hash, source_document_id, institution_id, normalized_text,
          observed_artifact_status, capture_kind)
        VALUES (1999999999, ${textHash}, 5, 6, ${DOC}, 'completed', 'incumbent')
      `;
      await expect(recordEvidenceSegment({ witnessArtifactId: 1999999999, witnessTextHash: textHash, quote: "NSF fee" }, tx))
        .rejects.toBeInstanceOf(EvidencePilotError);
      const [existing] = await tx`SELECT COUNT(*)::int AS n FROM evidence_pilot_institutions`;
      for (let i = Number(existing.n); i < EVIDENCE_PILOT_MAX_INSTITUTIONS; i += 1) {
        await addPilotInstitution({ institutionId: 900_000 + i, cohort: i % 2 ? "bank" : "credit_union", reason: "fixture", addedBy: "test" }, tx);
      }
      expect(await addPilotInstitution({ institutionId: 900_000, cohort: "bank", reason: "again", addedBy: "test" }, tx)).toEqual({ added: false });
      await expect(addPilotInstitution({ institutionId: 899_999, cohort: "bank", reason: "eleventh", addedBy: "test" }, tx))
        .rejects.toThrow(/already has 10/);
    });
  });

  it("keeps both time axes: a later price supersedes, the earlier range survives, and versions never change", async () => {
    await rolledBack(async (tx) => {
      const w = await witness(tx);
      const seg = await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "NSF fee: $35.00" }, tx);
      const base = { institutionId: w.institutionId, canonicalKey: "nsf", audience: "consumer" as const, amountKind: "fixed" as const,
        ratePercent: null, validFromBasis: "document_first_seen" as const, evidenceSegmentIds: [seg!.id], producedBy: "test" };
      const first = await recordObligationVersion({ ...base, amount: 30, validFrom: "2026-01-01" }, tx);
      await checkNow(tx); await deferAgain(tx);
      expect(await recordObligationVersion({ ...base, amount: 30, validFrom: "2026-01-01" }, tx)).toMatchObject({ unchanged: true, versionId: first.versionId });
      const second = await recordObligationVersion({ ...base, amount: 35, validFrom: "2026-11-01", validFromBasis: "stated_effective_date" }, tx);
      await checkNow(tx);
      expect(second.superseded).toEqual([first.versionId]);
      const current = await tx`
        SELECT amount, valid_from::text AS from, valid_to::text AS to FROM fee_obligation_versions
         WHERE obligation_id = ${first.obligationId} AND superseded_at IS NULL ORDER BY valid_from`;
      expect(current.map((r) => [Number(r.amount), r.from, r.to])).toEqual([[30, "2026-01-01", "2026-11-01"], [35, "2026-11-01", null]]);
      const [asRecorded] = await tx`SELECT amount FROM fee_obligation_versions WHERE id = ${first.versionId}`;
      expect(Number(asRecorded.amount)).toBe(30);
      await rejects(tx, () => tx`UPDATE fee_obligation_versions SET amount = 40 WHERE id = ${second.versionId}`, /append-only/);
      await rejects(tx, () => tx`DELETE FROM fee_obligation_versions WHERE id = ${second.versionId}`, /append-only/);
    });
  });

  it("refuses at commit a version with no evidence, or two current versions over the same dates", async () => {
    await rolledBack(async (tx) => {
      const w = await witness(tx);
      const [ob] = await tx`INSERT INTO fee_obligations (institution_id, canonical_key, audience) VALUES (${w.institutionId}, 'overdraft', 'consumer') RETURNING id`;
      await rejects(tx, async () => {
        await tx`INSERT INTO fee_obligation_versions (obligation_id, amount, amount_kind, valid_from, valid_from_basis, produced_by)
                 VALUES (${ob.id}, 35, 'fixed', '2026-01-01', 'document_first_seen', 'test')`;
        await checkNow(tx);
      }, /cites no evidence/);
      await deferAgain(tx);
      const seg = await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "Overdraft Fee $35.00" }, tx);
      await recordObligationVersion({ institutionId: w.institutionId, canonicalKey: "overdraft", audience: "consumer", amountKind: "fixed",
        amount: 35, ratePercent: null, validFrom: "2026-01-01", validFromBasis: "document_first_seen", evidenceSegmentIds: [seg!.id], producedBy: "test" }, tx);
      await rejects(tx, async () => {
        const [v] = await tx`INSERT INTO fee_obligation_versions (obligation_id, amount, amount_kind, valid_from, valid_from_basis, produced_by)
                             VALUES (${ob.id}, 36, 'fixed', '2026-06-01', 'document_first_seen', 'test') RETURNING id`;
        await tx`INSERT INTO fee_obligation_evidence (obligation_version_id, evidence_segment_id) VALUES (${v.id}, ${seg!.id})`;
        await checkNow(tx);
      }, /overlapping current versions/);
    });
  });

  it("scores precision against the source and recall from the source", async () => {
    await rolledBack(async (tx) => {
      const w = await witness(tx);
      const seg = async (quote: string) => (await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote }, tx))!.id;
      const od = await seg("Overdraft Fee $35.00 per item");
      const nsf = await seg("NSF fee: $35.00");
      const stop = await seg("Stop Payment – $30.00");
      for (const [segmentId, canonicalKey, amount] of [[od, "overdraft", 35], [nsf, "nsf", 35], [stop, "stop_payment", 30]] as const) {
        // Two reads of the same line count once.
        for (const method of ["read_a", "read_b"]) {
          await recordSourceFee({ evidenceSegmentId: segmentId, canonicalKey, audience: "consumer", amountKind: "fixed", amount, ratePercent: null, method }, tx);
        }
      }
      const version = { institutionId: w.institutionId, audience: "consumer" as const, amountKind: "fixed" as const, ratePercent: null,
        validFrom: "2026-01-01", validFromBasis: "document_first_seen" as const, producedBy: "test" };
      await recordObligationVersion({ ...version, canonicalKey: "overdraft", amount: 35, evidenceSegmentIds: [od] }, tx);
      await recordObligationVersion({ ...version, canonicalKey: "nsf", amount: 30, evidenceSegmentIds: [nsf] }, tx);
      await checkNow(tx);
      const others = await scoreEvidencePilot("2026-11-01", tx);
      expect(others).toMatchObject({ versionsWithoutEvidence: 0, meetsTargets: false });
      const [mine] = await tx`SELECT COUNT(*)::int AS n FROM fee_obligation_versions`;
      expect(others.versions).toBe(Number(mine.n));
      expect(others.versionsMatched).toBe(1);
      expect(others.sourceFees).toBe(3);
      expect(others.sourceFeesMatched).toBe(1);
      expect(others.precision).toBe(0.5);
      expect(others.recall).toBeCloseTo(1 / 3);
      expect((await scoreEvidencePilot("2025-12-31", tx)).versions).toBe(0);
    });
  });
});
