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
  async function witness(tx: Db, text = DOC, at: { institutionId?: number; documentId?: number; capturedAt?: string } = {}) {
    const institutionId = at.institutionId ?? randomInt(1_000_000_000, 2_000_000_000);
    const artifactId = randomInt(1_000_000_000, 2_000_000_000);
    const textHash = createHash("sha256").update(text).digest("hex");
    await tx`
      INSERT INTO agent_source_text_witnesses (artifact_id, text_hash, source_document_id, institution_id, normalized_text,
        observed_artifact_status, capture_kind, captured_at)
      VALUES (${artifactId}, ${textHash}, ${at.documentId ?? institutionId + 7}, ${institutionId}, ${text}, 'completed', 'incumbent',
              ${at.capturedAt ?? "2026-11-01T00:00:00Z"}::timestamptz)
    `;
    if (!at.institutionId) await addPilotInstitution({ institutionId, cohort: "bank", reason: "fixture", addedBy: "test" }, tx);
    return { institutionId, artifactId, textHash };
  }
  const versionsOf = (tx: Db, obligationId: number) => tx`
    SELECT amount, to_char(valid_from, 'YYYY-MM-DD') AS from, to_char(valid_to, 'YYYY-MM-DD') AS to, valid_from_basis AS basis
      FROM fee_obligation_versions WHERE obligation_id = ${obligationId} AND superseded_at IS NULL ORDER BY valid_from`;
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
      const score = await scoreEvidencePilot({ asOf: "2026-11-01", institutionIds: [w.institutionId] }, tx);
      expect(score).toEqual({ versions: 2, versionsMatched: 1, sourceFees: 3, sourceFeesMatched: 1, precision: 0.5,
        recall: 1 / 3, versionsWithoutEvidence: 0, meetsTargets: false });
      expect((await scoreEvidencePilot({ asOf: "2025-12-31", institutionIds: [w.institutionId] }, tx)).versions).toBe(0);
    });
  });

  it("scores only each document's latest capture, so a changed price leaves no stale source fee", async () => {
    await rolledBack(async (tx) => {
      const old = await witness(tx, "NSF fee: $30.00", { documentId: 41, capturedAt: "2026-03-01T00:00:00Z" });
      const now = await witness(tx, "NSF fee: $35.00", { institutionId: old.institutionId, documentId: 41, capturedAt: "2026-10-01T00:00:00Z" });
      const base = { institutionId: old.institutionId, canonicalKey: "nsf", audience: "consumer" as const, amountKind: "fixed" as const,
        ratePercent: null, validFromBasis: "document_first_seen" as const, producedBy: "test" };
      for (const [w, amount, validFrom] of [[old, 30, "2026-03-01"], [now, 35, "2026-10-01"]] as const) {
        const segment = (await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: `NSF fee: $${amount}.00` }, tx))!;
        await recordSourceFee({ evidenceSegmentId: segment.id, canonicalKey: "nsf", audience: "consumer", amountKind: "fixed", amount, ratePercent: null, method: "agreed" }, tx);
        await recordObligationVersion({ ...base, amount, validFrom, evidenceSegmentIds: [segment.id] }, tx);
      }
      await checkNow(tx);
      const scope = { institutionIds: [old.institutionId] };
      expect(await scoreEvidencePilot({ asOf: "2026-11-01", ...scope }, tx)).toMatchObject({ versions: 1, versionsMatched: 1, sourceFees: 1, sourceFeesMatched: 1 });
      expect(await scoreEvidencePilot({ asOf: "2026-05-01", ...scope }, tx)).toMatchObject({ versions: 1, versionsMatched: 1, sourceFees: 1, sourceFeesMatched: 1 });
    });
  });

  it("scores a price change that arrives as a new document by the document current on each date", async () => {
    await rolledBack(async (tx) => {
      const [inst] = await tx`
        INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
        VALUES ('Evidence pilot fixture', 'bank', 'ZW', 'e2e', 'https://fixture.example/fees') RETURNING id`;
      const institutionId = Number(inst.id);
      await addPilotInstitution({ institutionId, cohort: "bank", reason: "fixture", addedBy: "test" }, tx);
      const doc = async () => Number((await tx`
        INSERT INTO source_documents (institution_id, status, document_url, content_hash)
        VALUES (${institutionId}, 'success', 'https://fixture.example/fees', ${String(Math.random())}) RETURNING id`)[0].id);
      const oldDoc = await doc();
      const newDoc = await doc();
      await tx`UPDATE source_documents SET superseded_by_id = ${newDoc} WHERE id = ${oldDoc}`;
      const old = await witness(tx, "NSF fee: $30.00", { institutionId, documentId: oldDoc, capturedAt: "2026-03-01T00:00:00Z" });
      const now = await witness(tx, "NSF fee: $35.00\nEffective December 1, 2026 the NSF fee: $40.00",
        { institutionId, documentId: newDoc, capturedAt: "2026-10-01T00:00:00Z" });
      const base = { institutionId, canonicalKey: "nsf", audience: "consumer" as const, amountKind: "fixed" as const, ratePercent: null, producedBy: "test" };
      const record = async (w: typeof old, quote: string, amount: number, validFrom: string, stated: boolean) => {
        const segment = (await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote }, tx))!;
        await recordSourceFee({ evidenceSegmentId: segment.id, canonicalKey: "nsf", audience: "consumer", amountKind: "fixed", amount,
          ratePercent: null, method: "agreed", validFrom: stated ? validFrom : null }, tx);
        await recordObligationVersion({ ...base, amount, validFrom, validFromBasis: stated ? "stated_effective_date" : "document_first_seen",
          evidenceSegmentIds: [segment.id] }, tx);
      };
      await record(old, "NSF fee: $30.00", 30, "2026-03-01", false);
      await record(now, "NSF fee: $35.00", 35, "2026-10-01", false);
      await record(now, "the NSF fee: $40.00", 40, "2026-12-01", true);
      await checkNow(tx);
      const at = (asOf: string) => scoreEvidencePilot({ asOf, institutionIds: [institutionId] }, tx);
      const exact = { versions: 1, versionsMatched: 1, sourceFees: 1, sourceFeesMatched: 1 };
      expect(await at("2026-05-01")).toMatchObject(exact); // the old document was current then
      expect(await at("2026-11-01")).toMatchObject(exact); // the $40 is announced, not yet in effect
      expect(await at("2026-12-15")).toMatchObject(exact);
    });
  });

  it("matches free fees and rates, and splits a range that overlaps several versions", async () => {
    await rolledBack(async (tx) => {
      const w = await witness(tx, "Paper statement: free\nForeign transaction: 1.1% of the transaction", { capturedAt: "2026-01-01T00:00:00Z" });
      const free = (await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "Paper statement: free" }, tx))!.id;
      const rate = (await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "1.1% of the transaction" }, tx))!.id;
      await recordSourceFee({ evidenceSegmentId: free, canonicalKey: "paper_statement", audience: "consumer", amountKind: "free", amount: null, ratePercent: null, method: "agreed" }, tx);
      await recordSourceFee({ evidenceSegmentId: rate, canonicalKey: "foreign_transaction", audience: "consumer", amountKind: "rate", amount: null, ratePercent: 1.1, method: "agreed" }, tx);
      const base = { institutionId: w.institutionId, audience: "consumer" as const, validFromBasis: "stated_effective_date" as const, producedBy: "test" };
      await recordObligationVersion({ ...base, canonicalKey: "paper_statement", amountKind: "free", amount: 0, ratePercent: null, validFrom: "2026-01-01", evidenceSegmentIds: [free] }, tx);
      const fx = { ...base, canonicalKey: "foreign_transaction", amountKind: "rate" as const, amount: null, evidenceSegmentIds: [rate] };
      await recordObligationVersion({ ...fx, ratePercent: 1, validFrom: "2026-01-01", validTo: "2026-04-01" }, tx);
      const later = await recordObligationVersion({ ...fx, ratePercent: 1.2, validFrom: "2026-04-01" }, tx);
      // 1.1% from Mar to Sep overlaps both: Jan-Mar keeps 1%, Sep onward carries 1.2% forward.
      const mid = await recordObligationVersion({ ...fx, ratePercent: 1.1, validFrom: "2026-03-01", validTo: "2026-09-01" }, tx);
      await checkNow(tx);
      expect(mid.superseded).toHaveLength(2);
      expect((await versionsOf(tx, later.obligationId)).map((r) => [r.from, r.to, r.basis])).toEqual([
        ["2026-01-01", "2026-03-01", "stated_effective_date"], ["2026-03-01", "2026-09-01", "stated_effective_date"], ["2026-09-01", null, "carried_forward"],
      ]);
      expect(await scoreEvidencePilot({ asOf: "2026-06-01", institutionIds: [w.institutionId] }, tx)).toMatchObject({ precision: 1, recall: 1 });
    });
  });

  it("keeps one version when the same terms are seen again later, and refuses dates that are not YYYY-MM-DD", async () => {
    await rolledBack(async (tx) => {
      const w = await witness(tx);
      const seg = (await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote: "NSF fee: $35.00" }, tx))!;
      const base = { institutionId: w.institutionId, canonicalKey: "nsf", audience: "consumer" as const, amountKind: "fixed" as const, amount: 35,
        ratePercent: null, validFromBasis: "document_first_seen" as const, evidenceSegmentIds: [seg.id], producedBy: "test" };
      const first = await recordObligationVersion({ ...base, validFrom: "2026-01-01" }, tx);
      for (const validFrom of ["2026-02-01", "2026-03-01"]) {
        expect(await recordObligationVersion({ ...base, validFrom }, tx)).toMatchObject({ unchanged: true, versionId: first.versionId });
      }
      await checkNow(tx);
      expect(await versionsOf(tx, first.obligationId)).toHaveLength(1);
      for (const validFrom of ["2026-3-1", "2026-03-01T00:00:00Z", "2026-02-30"]) {
        await expect(recordObligationVersion({ ...base, validFrom }, tx)).rejects.toBeInstanceOf(EvidencePilotError);
      }
    });
  });

  it("never lets an obligation change identity or a version be superseded by another obligation", async () => {
    await rolledBack(async (tx) => {
      const w = await witness(tx);
      const seg = async (quote: string) => (await recordEvidenceSegment({ witnessArtifactId: w.artifactId, witnessTextHash: w.textHash, quote }, tx))!.id;
      const base = { institutionId: w.institutionId, audience: "consumer" as const, amountKind: "fixed" as const, ratePercent: null,
        validFrom: "2026-01-01", validFromBasis: "document_first_seen" as const, producedBy: "test" };
      const nsf = await recordObligationVersion({ ...base, canonicalKey: "nsf", amount: 35, evidenceSegmentIds: [await seg("NSF fee: $35.00")] }, tx);
      const od = await recordObligationVersion({ ...base, canonicalKey: "overdraft", amount: 35, evidenceSegmentIds: [await seg("Overdraft Fee $35.00")] }, tx);
      await rejects(tx, () => tx`UPDATE fee_obligations SET canonical_key = 'monthly_maintenance' WHERE id = ${nsf.obligationId}`, /identity never changes/);
      await rejects(tx, () => tx`DELETE FROM fee_obligations WHERE id = ${nsf.obligationId}`, /append-only/);
      await rejects(tx, () => tx`UPDATE fee_obligation_versions SET superseded_at = now(), superseded_by = ${od.versionId} WHERE id = ${nsf.versionId}`,
        /same obligation/);
      await rejects(tx, () => tx`DELETE FROM evidence_pilot_institutions WHERE institution_id = ${w.institutionId}`, /append-only/);
      await rejects(tx, () => tx`UPDATE evidence_pilot_institutions SET institution_id = institution_id + 1 WHERE institution_id = ${w.institutionId}`, /append-only/);
    });
  });
});
