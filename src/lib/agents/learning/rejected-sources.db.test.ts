// @vitest-environment node
/**
 * Real PostgreSQL check of the playbook's rejected-list rule (#1105): no writer makes an address
 * on the profile's own `rejected_source_urls` its current source, except a read that judged the
 * page (which drops the reject); and Knox's rules read records the layout fingerprint. Loopback
 * database only; every case runs in a transaction that is rolled back.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReadResult } from "@/lib/agents/rosetta/read";

const connection = process.env.E2E_DATABASE_URL;
const REJECTED = "https://fixture.example/fees.pdf";
const OTHER = "https://fixture.example/old-page";

describe.skipIf(!connection)("rejected sources never become current (#1105)", () => {
  let db: typeof import("@/lib/data-store/connection").sql;
  let reader: typeof import("@/lib/agents/rosetta/read");
  let fetcher: typeof import("@/lib/agents/magellan/fetch");
  let lanes: typeof import("@/lib/agents/state-lane-memory");
  let attempts: typeof import("@/lib/agents/learning/attempts");
  let vault: typeof import("@/lib/agents/document-vault");
  const priorUrl = process.env.DATABASE_URL;
  const priorPool = process.env.DATABASE_POOL_MAX;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Only an isolated loopback database is allowed");
    }
    process.env.DATABASE_URL = connection;
    process.env.DATABASE_POOL_MAX = "5";
    vi.resetModules();
    ({ sql: db } = await import("@/lib/data-store/connection"));
    reader = await import("@/lib/agents/rosetta/read");
    fetcher = await import("@/lib/agents/magellan/fetch");
    lanes = await import("@/lib/agents/state-lane-memory");
    attempts = await import("@/lib/agents/learning/attempts");
    vault = await import("@/lib/agents/document-vault");
  });
  afterAll(async () => {
    await db?.end();
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
    if (priorPool === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = priorPool;
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

  const rejectedList = [
    { url: REJECTED, reason: "No fee lines and only 0 dollar amounts: not a fee schedule", at: "2026-10-07T15:00:45.306Z" },
    { url: OTHER, reason: "HTTP 404", at: "2026-10-05T00:00:00.000Z" },
  ];

  /** One bank whose saved link is the rejected address, with a profile that has no current source. */
  async function seed(scope: Db, canonical: string | null = null, list: ReadonlyArray<{ url: string; reason: string; at: string }> = rejectedList) {
    const [inst] = await scope`
      INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
      VALUES ('Rejected source fixture', 'bank', 'ZR', 'e2e', ${REJECTED}) RETURNING id
    `;
    const institutionId = Number(inst.id);
    await scope`
      INSERT INTO institution_source_profiles (institution_id, state_code, canonical_source_url, rejected_source_urls)
      VALUES (${institutionId}, 'ZR', ${canonical}, ${JSON.stringify(list)}::jsonb)
    `;
    const [doc] = await scope`
      INSERT INTO source_documents (institution_id, status, document_url, content_hash)
      VALUES (${institutionId}, 'success', ${REJECTED}, ${`hash-${institutionId}`}) RETURNING id
    `;
    const [run] = await scope`INSERT INTO agent_runs (agent_name, run_kind) VALUES ('rosetta', 'manual_repair') RETURNING id`;
    return { institutionId, documentId: Number(doc.id), runId: Number(run.id) };
  }

  async function profile(scope: Db, institutionId: number) {
    const [row] = await scope`
      SELECT canonical_source_url, rejected_source_urls, layout_fingerprint
        FROM institution_source_profiles WHERE institution_id = ${institutionId}
    `;
    const rejected = typeof row.rejected_source_urls === "string" ? JSON.parse(row.rejected_source_urls) : row.rejected_source_urls;
    return { canonical: row.canonical_source_url as string | null, rejectedUrls: (rejected as Array<{ url: string }>).map((entry) => entry.url), layout: row.layout_fingerprint as string | null };
  }

  function readResult(fixture: Awaited<ReturnType<typeof seed>>, status: ReadResult["status"]): ReadResult {
    return {
      sourceDocumentId: fixture.documentId, institutionId: fixture.institutionId, institutionName: "Rejected source fixture",
      sourceUrl: REJECTED, status, documentType: "pdf", contentType: "application/pdf",
      sourceHash: `hash-${fixture.institutionId}`, textHash: null, charCount: status === "completed" ? 40 : 0,
      error: status === "completed" ? null : "Scanned PDF", attemptOutcome: status === "completed" ? "ok" : "scanned_pdf",
      strategy: "read.pdf_text", format: status === "completed" ? "pdf_text" : "pdf_scanned", routerReason: null, fromVault: true,
      pageCheck: null, tableRows: 0, rows: [], reader: "read.pdf_text", followUps: [], handoff: null, reread: false, durationMs: 0,
    };
  }

  it("a completed read judged the page: the reject is dropped and the address is current", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const text = "Fee Schedule\nWire transfer $25.00 per item\nStop payment $30.00";
    await reader.recordReadResult(scope, fixture.runId, { ...readResult(fixture, "completed"), textHash: reader.hashText(text) }, text, true);
    expect(await profile(scope, fixture.institutionId)).toMatchObject({ canonical: REJECTED, rejectedUrls: [OTHER] });
  }));

  it.each(["document_owner", "other_bank_host", "unconfirmed_document_host", "hand_link_repair: another bank's pages"])(
    "a completed read never overturns an ownership reject (%s): the address stays rejected and off the current source",
    async (reason) => rolledBack(async (scope) => {
      const fixture = await seed(scope, null, [{ url: REJECTED, reason, at: "2026-10-20T00:00:00.000Z" }, rejectedList[1]]);
      const text = "Fee Schedule\nWire transfer $25.00 per item\nStop payment $30.00";
      await reader.recordReadResult(scope, fixture.runId, { ...readResult(fixture, "completed"), textHash: reader.hashText(text) }, text, true);
      expect(await profile(scope, fixture.institutionId)).toMatchObject({ canonical: null, rejectedUrls: [REJECTED, OTHER] });
    }),
  );

  it("a read that did not complete leaves a rejected address off the current source", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    await reader.recordReadResult(scope, fixture.runId, readResult(fixture, "needs_ocr"), null, true);
    expect(await profile(scope, fixture.institutionId)).toMatchObject({ canonical: null, rejectedUrls: [REJECTED, OTHER] });
  }));

  it("a fetch of a rejected address stores the document but does not make it current", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const fetchImpl = vi.fn(async () => new Response("%PDF-1.7 new bytes", { status: 200, headers: { "content-type": "application/pdf" } }));
    const { result, sourceDocumentId } = await fetcher.fetchAndRecordLink(scope, {
      id: fixture.institutionId, institution_name: "Rejected source fixture", fee_schedule_url: REJECTED,
      asset_size: null, last_crawl_at: null, consecutive_failures: 0, profile_canonical_source_url: null,
    }, fetchImpl as unknown as typeof fetch, {
      learning: true, vaultSchema: false, vault: vault.getDocumentVault(), vaultOn: false, dryRun: false,
      runId: fixture.runId, stepId: null, strategy: fetcher.MAGELLAN_FETCH_STRATEGY,
    });
    expect(result.outcome).toBe("success");
    expect(sourceDocumentId).not.toBeNull();
    expect(await profile(scope, fixture.institutionId)).toMatchObject({ canonical: null, rejectedUrls: [REJECTED, OTHER] });
  }));

  it("the profile sync does not fill an empty current source with a rejected saved link", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope);
    const [clean] = await scope`
      INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url)
      VALUES ('Clean fixture', 'bank', 'ZR', 'e2e', 'https://clean.example/fees.pdf') RETURNING id
    `;
    await scope`INSERT INTO institution_source_profiles (institution_id, state_code) VALUES (${clean.id}, 'ZR')`;
    await lanes.syncStateLaneProfiles(scope, "ZR");
    expect((await profile(scope, fixture.institutionId)).canonical).toBeNull();
    expect((await profile(scope, Number(clean.id))).canonical).toBe("https://clean.example/fees.pdf");
  }));

  it("Knox's rules read records the layout fingerprint on the playbook", async () => rolledBack(async (scope) => {
    const fixture = await seed(scope, REJECTED);
    await attempts.recordAttempt(scope, {
      institutionId: fixture.institutionId, sourceDocumentId: fixture.documentId, stage: "extract", strategy: "extract.rules",
      version: 1, fingerprint: "text-hash", outcome: "ok", yieldCount: 12, costMicrousd: 0, layoutFingerprint: "table/short@1",
    });
    // An attempt that names no layout keeps the one recorded.
    await attempts.recordAttempt(scope, {
      institutionId: fixture.institutionId, sourceDocumentId: fixture.documentId, stage: "fetch", strategy: "fetch.http",
      version: 2, fingerprint: REJECTED, outcome: "unchanged", yieldCount: 0, costMicrousd: 0,
    });
    expect((await profile(scope, fixture.institutionId)).layout).toBe("table/short@1");
  }));
});
