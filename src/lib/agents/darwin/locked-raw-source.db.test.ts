// @vitest-environment node
import postgres from "postgres";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { matchOriginalRawSource, withLockedRawSource, withLockedSourcePrefix, type SourceReference } from "./locked-raw-source";
import { darwinAudience } from "./audience";

type Db = typeof import("@/lib/data-store/connection").sql;
type Tx = Db & { savepoint<T>(work: (scope: Tx) => Promise<T>): Promise<T> };
const connection = process.env.E2E_DATABASE_URL;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const body = "Check Images\n• $10.00 (Consumer Only) per statement";
const url = "https://source-context.example.test/fees.pdf";
interface Fixture { institutionId: number; documentId: number; artifactId: number; rawId: number; textHash: string }

describe.skipIf(!connection)("current raw-owned source transaction context (#2342)", () => {
  let db: postgres.Sql;
  const owned: number[] = [];
  beforeAll(() => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Source-context fixtures require a disposable loopback PostgreSQL database");
    }
    db = postgres(connection, { max: 6, ssl: "require" });
  });
  afterEach(async () => {
    if (!owned.length) return;
    const ids = owned.splice(0);
    await transaction(async tx => {
      await tx`DELETE FROM raw_fee_observations WHERE institution_id=ANY(${ids}::bigint[])`;
      await tx`DELETE FROM agent_source_texts WHERE institution_id=ANY(${ids}::bigint[])`;
      await tx`DELETE FROM source_documents WHERE institution_id=ANY(${ids}::bigint[])`;
      await tx`DELETE FROM institution_sources WHERE id=ANY(${ids}::bigint[])`;
    });
  });
  afterAll(async () => { if (db) await db.end(); });

  function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return db.begin(scope => work(scope as unknown as Tx)) as Promise<T>;
  }

  async function seed(): Promise<Fixture> {
    const [institution] = await db`INSERT INTO institution_sources
      (institution_name, source, status, website_url, state_code, charter_type)
      VALUES (${`2342 owned source fixture ${process.pid}`},'e2e','active','https://source-context.example.test','MN','bank') RETURNING id`;
    const institutionId = Number(institution.id);
    owned.push(institutionId);
    const [document] = await db`INSERT INTO source_documents
      (institution_id,status,document_url,content_hash,content_type)
      VALUES (${institutionId},'success',${url},${hash("owned source bytes")},'application/pdf') RETURNING id`;
    const documentId = Number(document.id);
    const [artifact] = await db`INSERT INTO agent_source_texts
      (source_document_id,institution_id,source_url,source_hash,status,normalized_text,text_hash,char_count)
      VALUES (${documentId},${institutionId},${url},${hash("owned source bytes")},'completed',${body},${hash(body)},${body.length}) RETURNING id`;
    const artifactId = Number(artifact.id);
    const note = `Knox deterministic extraction from Rosetta artifact #${artifactId}. canonical_hint=check_image; text_hash=${hash(body)}; excerpt="Check Images | $10 (Consumer Only) per statement"`;
    const [raw] = await db`INSERT INTO raw_fee_observations
      (institution_id,agent_event_id,source,fee_name,amount,source_url,source_document_id,conditions,extraction_note,fee_audience,outlier_flags)
      VALUES (${institutionId},gen_random_uuid(),'knox','Check Images',10,${url},${documentId},${body},${note},'unknown',
        jsonb_build_array('needs_darwin_verification','canonical_hint:check_image')) RETURNING fee_raw_id`;
    return { institutionId, documentId, artifactId, rawId: Number(raw.fee_raw_id), textHash: hash(body) };
  }
  const app = (tx: Tx) => tx as unknown as Db;
  const rawState = async (f: Fixture) => (await db`SELECT to_jsonb(fr)::text AS state
    FROM raw_fee_observations fr WHERE fee_raw_id=${f.rawId}`)[0]?.state;
  async function exclusiveLocks(f: Fixture) {
    await transaction(async tx => {
      await tx`SELECT id FROM source_documents WHERE id=${f.documentId} FOR UPDATE NOWAIT`;
      await tx`SELECT id FROM agent_source_texts WHERE id=${f.artifactId} FOR UPDATE NOWAIT`;
      await tx`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${f.rawId} FOR UPDATE NOWAIT`;
    });
  }
  /** Delay a real query boundary, never replace its PostgreSQL execution or result. */
  function beforeQuery(tx: Tx, pattern: RegExp, once: () => Promise<void>): Db {
    let fired = false;
    const wrapped = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (!fired && pattern.test(strings.join("?"))) { fired = true; await once(); }
      return tx(strings, ...values as postgres.ParameterOrFragment<never>[]);
    };
    Object.assign(wrapped, { savepoint: (work: (scope: Db) => Promise<unknown>) =>
      tx.savepoint(scope => work(beforeQuery(scope, pattern, once))) });
    return wrapped as unknown as Db;
  }

  it("requires an actual transaction instead of silently releasing autocommit locks", async () => {
    await expect(withLockedRawSource(db as unknown as Db, 1)).rejects.toThrow("requires a transaction");
    await expect(withLockedSourcePrefix(db as unknown as Db, [])).rejects.toThrow("requires a transaction");
  });

  it("returns current raw facts and exact original/current source without changing pending state", async () => {
    const f = await seed();
    const before = await rawState(f);
    await transaction(async tx => {
      const result = await withLockedRawSource(app(tx), f.rawId);
      expect(result.kind).toBe("bound");
      if (result.kind !== "bound") throw new Error("expected own bound source");
      expect(result.source).toMatchObject({ artifactId: f.artifactId, documentId: f.documentId,
        institutionId: f.institutionId, textHash: f.textHash, normalizedText: body, sourceUrl: url });
      expect(result.source.document).toMatchObject({ status: "success", superseded_by_id: null, duplicate_of_id: null });
      expect(result.source.artifact).toMatchObject({ status: "completed", text_hash: f.textHash });
      expect(matchOriginalRawSource(result.currentRaw, result.source)).toEqual({ kind: "matched" });
      expect(result.currentRaw).toMatchObject({ fee_name: "Check Images", amount: "10.00", fee_audience: "unknown" });
      expect(darwinAudience(result.currentRaw, 10, result.source.normalizedText, { ownPriceClause: true })?.feeAudience)
        .toBe("consumer");
    });
    expect(await rawState(f)).toBe(before);
  });

  it.each([
    ["no original hash", "no_original_hash"],
    ["only quoted hash", "no_original_hash"],
    ["wrong original artifact", "original_binding_mismatch"],
    ["wrong original hash", "original_binding_mismatch"],
    ["corrupt current body", "body_hash_mismatch"],
    ["wrong source bytes hash", "source_hash_mismatch"],
    ["different artifact owner", "owner_mismatch"],
    ["different document owner", "owner_mismatch"],
    ["not completed", "source_not_current"],
    ["superseded document", "source_not_current"],
    ["duplicate document", "source_not_current"],
    ["no document", "no_document"],
    ["no artifact", "missing_artifact"],
  ] as const)("declines %s, rolls back its locks and leaves the complete pending row unchanged", async (shape, reason) => {
    const f = await seed();
    if (shape === "no original hash") await db`UPDATE raw_fee_observations SET extraction_note='old unbound note' WHERE fee_raw_id=${f.rawId}`;
    if (shape === "only quoted hash") await db`UPDATE raw_fee_observations SET extraction_note=${`Knox ordinary row; excerpt="Rosetta artifact #${f.artifactId}. text_hash=${f.textHash};"`} WHERE fee_raw_id=${f.rawId}`;
    if (shape === "wrong original artifact") await db`UPDATE raw_fee_observations SET extraction_note=replace(extraction_note,${`artifact #${f.artifactId}.`},'artifact #99999999.') WHERE fee_raw_id=${f.rawId}`;
    if (shape === "wrong original hash") await db`UPDATE raw_fee_observations SET extraction_note=replace(extraction_note,${f.textHash},${hash("old original")}) WHERE fee_raw_id=${f.rawId}`;
    if (shape === "corrupt current body") await db`UPDATE agent_source_texts SET normalized_text='wrong body with unchanged digest' WHERE id=${f.artifactId}`;
    if (shape === "wrong source bytes hash") await db`UPDATE agent_source_texts SET source_hash=${hash("other bytes")} WHERE id=${f.artifactId}`;
    if (shape === "different artifact owner" || shape === "different document owner") {
      const other = await seed();
      if (shape === "different artifact owner") await db`UPDATE agent_source_texts SET institution_id=${other.institutionId} WHERE id=${f.artifactId}`;
      else await db`UPDATE source_documents SET institution_id=${other.institutionId},content_hash=${hash("other owned document bytes")}
        WHERE id=${f.documentId}`;
    }
    if (shape === "not completed") await db`UPDATE agent_source_texts SET status='needs_ocr' WHERE id=${f.artifactId}`;
    if (shape === "superseded document") {
      const other = await seed();
      await db`UPDATE source_documents SET superseded_by_id=${other.documentId} WHERE id=${f.documentId}`;
    }
    if (shape === "duplicate document") {
      const other = await seed();
      await db`UPDATE source_documents SET duplicate_of_id=${other.documentId} WHERE id=${f.documentId}`;
    }
    if (shape === "no document") await db`UPDATE raw_fee_observations SET source_document_id=NULL WHERE fee_raw_id=${f.rawId}`;
    if (shape === "no artifact") await db`DELETE FROM agent_source_texts WHERE id=${f.artifactId}`;
    const before = await rawState(f);
    await transaction(async tx => {
      expect(await withLockedRawSource(app(tx), f.rawId)).toEqual({ kind: "unavailable", reason });
      expect((await tx`SELECT 1 AS usable`)[0].usable).toBe(1);
      await exclusiveLocks(f);
    });
    expect(await rawState(f)).toBe(before);
  });

  it.each(["document", "artifact", "raw"] as const)("returns busy for a competing %s lock and releases every acquired prefix lock", async target => {
    const f = await seed();
    const before = await rawState(f);
    await transaction(async holder => {
      if (target === "document") await holder`SELECT id FROM source_documents WHERE id=${f.documentId} FOR UPDATE`;
      if (target === "artifact") await holder`SELECT id FROM agent_source_texts WHERE id=${f.artifactId} FOR UPDATE`;
      if (target === "raw") await holder`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${f.rawId} FOR UPDATE`;
      await transaction(async tx => {
        expect(await withLockedRawSource(app(tx), f.rawId)).toEqual({ kind: "busy" });
        expect((await tx`SELECT 1 AS usable`)[0].usable).toBe(1);
        if (target !== "document") await transaction(other => other`SELECT id FROM source_documents WHERE id=${f.documentId} FOR UPDATE NOWAIT`);
        if (target === "raw") await transaction(other => other`SELECT id FROM agent_source_texts WHERE id=${f.artifactId} FOR UPDATE NOWAIT`);
      });
    });
    expect(await rawState(f)).toBe(before);
  });

  it("keeps all three bound locks through caller work and releases them only at outer settlement", async () => {
    const f = await seed();
    await transaction(async tx => {
      expect((await withLockedRawSource(app(tx), f.rawId)).kind).toBe("bound");
      for (const table of ["document", "artifact", "raw"]) {
        await expect(transaction(async other => {
          if (table === "document") return other`SELECT id FROM source_documents WHERE id=${f.documentId} FOR UPDATE NOWAIT`;
          if (table === "artifact") return other`SELECT id FROM agent_source_texts WHERE id=${f.artifactId} FOR UPDATE NOWAIT`;
          return other`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${f.rawId} FOR UPDATE NOWAIT`;
        })).rejects.toMatchObject({ code: "55P03" });
      }
      await tx`SELECT 1 AS later_caller_work`;
    });
    await exclusiveLocks(f);
  });

  it("defers a changed raw document without jumping sources or retaining old prefix locks", async () => {
    const f = await seed();
    const other = await seed();
    // Preserve the real source-wide raw uniqueness contract while moving the first pointer.
    await db`UPDATE raw_fee_observations SET fee_name='Other existing source fee' WHERE fee_raw_id=${other.rawId}`;
    await transaction(async tx => {
      const scoped = beforeQuery(tx, /FROM raw_fee_observations fr[\s\S]*FOR UPDATE NOWAIT/, async () => {
        await db`UPDATE raw_fee_observations SET source_document_id=${other.documentId} WHERE fee_raw_id=${f.rawId}`;
      });
      expect(await withLockedRawSource(scoped, f.rawId)).toEqual({ kind: "changed" });
      await exclusiveLocks(f);
      await exclusiveLocks(other);
    });
    const [raw] = await db`SELECT source_document_id,outlier_flags,fee_audience FROM raw_fee_observations WHERE fee_raw_id=${f.rawId}`;
    expect(Number(raw.source_document_id)).toBe(other.documentId);
    expect(raw.fee_audience).toBe("unknown");
    expect(raw.outlier_flags).toContain("needs_darwin_verification");
  });

  it("compares the complete raw snapshot, including name/price/scope changes before its final lock", async () => {
    const f = await seed();
    await transaction(async tx => {
      const scoped = beforeQuery(tx, /FROM raw_fee_observations fr[\s\S]*FOR UPDATE NOWAIT/, async () => {
        await db`UPDATE raw_fee_observations SET fee_name='Changed own fee',amount=20,conditions='changed scope' WHERE fee_raw_id=${f.rawId}`;
      });
      expect(await withLockedRawSource(scoped, f.rawId)).toEqual({ kind: "changed" });
      await exclusiveLocks(f);
    });
  });

  it("uses the current artifact after a competing source replacement rather than its old raw hash", async () => {
    const f = await seed();
    const changed = "Check Images | $10 (Business Only) per statement";
    await transaction(async tx => {
      const scoped = beforeQuery(tx, /FROM agent_source_texts[\s\S]*FOR SHARE NOWAIT/, async () => {
        await db`UPDATE agent_source_texts SET normalized_text=${changed},text_hash=${hash(changed)} WHERE id=${f.artifactId}`;
      });
      expect(await withLockedRawSource(scoped, f.rawId)).toEqual({ kind: "changed" });
      await exclusiveLocks(f);
    });
  });

  it("does not wait backwards on a Knox transaction holding rawA before inserting source-FK rawB", async () => {
    const f = await seed();
    await transaction(async knox => {
      await knox`SELECT fee_raw_id FROM raw_fee_observations WHERE fee_raw_id=${f.rawId} FOR UPDATE`;
      await transaction(async verifier => {
        const scoped = beforeQuery(verifier, /FROM raw_fee_observations fr[\s\S]*FOR UPDATE NOWAIT/, async () => {
          await knox`INSERT INTO raw_fee_observations (institution_id,agent_event_id,source,fee_name,amount,source_document_id)
            VALUES (${f.institutionId},gen_random_uuid(),'knox','Second owned fee',5,${f.documentId})`;
        });
        expect(await withLockedRawSource(scoped, f.rawId)).toEqual({ kind: "busy" });
        expect((await verifier`SELECT 1 AS usable`)[0].usable).toBe(1);
      });
    });
  });

  it("binds a reversed/duplicated source set in stable order without locking any raw row", async () => {
    const a = await seed();
    const b = await seed();
    await transaction(async tx => {
      const result = await withLockedSourcePrefix(app(tx), [
        { documentId: b.documentId, institutionId: b.institutionId },
        { documentId: a.documentId, institutionId: a.institutionId },
        { documentId: b.documentId, institutionId: b.institutionId },
      ]);
      expect(result.kind).toBe("bound");
      if (result.kind !== "bound") throw new Error("expected two factual sources");
      expect([...result.sources.keys()]).toEqual([a.documentId, b.documentId]);
      expect(result.sources.get(a.documentId)?.artifact.id).toBe(String(a.artifactId));
      await transaction(other => other`SELECT fee_raw_id FROM raw_fee_observations
        WHERE fee_raw_id=ANY(${[a.rawId, b.rawId]}::bigint[]) FOR UPDATE NOWAIT`);
      for (const f of [a, b]) {
        await expect(transaction(other => other`SELECT id FROM source_documents WHERE id=${f.documentId} FOR UPDATE NOWAIT`))
          .rejects.toMatchObject({ code: "55P03" });
        await expect(transaction(other => other`SELECT id FROM agent_source_texts WHERE id=${f.artifactId} FOR UPDATE NOWAIT`))
          .rejects.toMatchObject({ code: "55P03" });
      }
    });
  });

  it("rejects invalid/conflicting refs explicitly instead of binding an empty owner set", async () => {
    const f = await seed();
    await transaction(async tx => {
      expect(await withLockedSourcePrefix(app(tx), [{ documentId: 0, institutionId: f.institutionId }]))
        .toEqual({ kind: "unavailable", reason: "invalid_reference" });
      expect(await withLockedSourcePrefix(app(tx), [null] as unknown as SourceReference[]))
        .toEqual({ kind: "unavailable", reason: "invalid_reference" });
      expect(await withLockedSourcePrefix(app(tx), [
        { documentId: f.documentId, institutionId: f.institutionId },
        { documentId: f.documentId, institutionId: f.institutionId + 1 },
      ])).toEqual({ kind: "unavailable", reason: "conflicting_reference" });
      expect(await withLockedSourcePrefix(app(tx), [{ documentId: f.documentId, institutionId: f.institutionId + 1 }]))
        .toEqual({ kind: "unavailable", reason: "owner_mismatch" });
      await exclusiveLocks(f);
    });
  });

  it("releases the complete multi-document prefix when the last artifact is busy", async () => {
    const a = await seed();
    const b = await seed();
    await transaction(async holder => {
      await holder`SELECT id FROM agent_source_texts WHERE id=${b.artifactId} FOR UPDATE`;
      await transaction(async tx => {
        expect(await withLockedSourcePrefix(app(tx), [
          { documentId: a.documentId, institutionId: a.institutionId },
          { documentId: b.documentId, institutionId: b.institutionId },
        ])).toEqual({ kind: "busy" });
        await exclusiveLocks(a);
        await transaction(other => other`SELECT id FROM source_documents WHERE id=${b.documentId} FOR UPDATE NOWAIT`);
      });
    });
  });

  it("lets a consumer's own rollback release a bound prefix after its suffix defers", async () => {
    const f = await seed();
    const deferred = new Error("owned consumer identity CAS deferred");
    await transaction(async tx => {
      await tx.savepoint(async scope => {
        expect((await withLockedSourcePrefix(app(scope), [{ documentId: f.documentId, institutionId: f.institutionId }])).kind)
          .toBe("bound");
        throw deferred;
      }).catch(error => { if (error !== deferred) throw error; });
      await exclusiveLocks(f);
      expect((await tx`SELECT 1 AS usable`)[0].usable).toBe(1);
    });
  });

  it.each(["paid extraction (fixture-model)", "read a free fee"])("accepts the actual %s writer header without invoking a provider", async method => {
    const f = await seed();
    await db`UPDATE raw_fee_observations SET extraction_note=replace(extraction_note,'deterministic extraction',${method}) WHERE fee_raw_id=${f.rawId}`;
    const before = await rawState(f);
    await transaction(async tx => {
      const result = await withLockedRawSource(app(tx), f.rawId);
      expect(result.kind).toBe("bound");
    });
    expect(await rawState(f)).toBe(before);
  });

  it("returns changed after a concurrent raw update violates a repeatable-read snapshot", async () => {
    const f = await seed();
    await db.begin("isolation level repeatable read", async native => {
      const tx = native as unknown as Tx;
      const scoped = beforeQuery(tx, /FROM raw_fee_observations fr[\s\S]*FOR UPDATE NOWAIT/, async () => {
        await db`UPDATE raw_fee_observations SET conditions='concurrent own condition' WHERE fee_raw_id=${f.rawId}`;
      });
      expect(await withLockedRawSource(scoped, f.rawId)).toEqual({ kind: "changed" });
      expect((await tx`SELECT 1 AS usable`)[0].usable).toBe(1);
      await exclusiveLocks(f);
    });
  });
});
