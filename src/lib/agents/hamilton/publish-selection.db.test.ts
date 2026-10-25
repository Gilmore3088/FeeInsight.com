// @vitest-environment node
/**
 * Hamilton's publish selection (`selectVerifiedFees`) in real PostgreSQL, production schema,
 * loopback only. Pins which verified rows are picked and what each carries (re-check twins,
 * same-line re-selects, free reads, companion stream, whole-document batches), so a cheaper
 * query shape can never change what goes live. Every fixture rolls back.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;
type Selected = Awaited<ReturnType<typeof import("./publish").selectVerifiedFees>>;
const MIN_CONFIDENCE = 0.7;

interface Fixture {
  institutionId: number;
  companionId: number;
  docA: number;
  docB: number;
  ids: Record<string, number>;
}

describe.skipIf(!connection)("Hamilton publish selection in actual PostgreSQL", () => {
  let db: postgres.Sql;
  let appSql: Db;
  let publish: typeof import("./publish");

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Publish selection tests require a disposable loopback database; production is forbidden");
    }
    vi.stubEnv("DATABASE_URL", connection);
    const connectionModule = await import("@/lib/data-store/connection");
    appSql = connectionModule.sql;
    db = postgres(connection, { max: 1, ssl: "require", types: {
      numeric: connectionModule.NUMERIC_AS_NUMBER, json: connectionModule.JSON_TEXT_PASSTHROUGH, text: connectionModule.TEXT_WITHOUT_NUL,
    } }) as unknown as postgres.Sql;
    publish = await import("./publish");
  });
  afterAll(async () => { if (db) await db.end(); if (appSql) await appSql.end(); vi.unstubAllEnvs(); });

  async function rollback(test: (tx: Db) => Promise<void>) {
    const stop = new Error("rollback owned selection fixture");
    await db.begin(async (scope) => { await test(scope as unknown as Db); throw stop; })
      .catch((error) => { if (error !== stop) throw error; });
  }

  async function document(tx: Db, institutionId: number, url: string, crawledAt: string, companionId: number | null) {
    const [{ id }] = await tx`INSERT INTO source_documents
      (institution_id, status, document_url, content_hash, content_type, crawled_at, companion_source_id)
      VALUES (${institutionId}, 'success', ${url}, ${randomUUID()}, 'application/pdf', ${crawledAt}::timestamptz, ${companionId})
      RETURNING id`;
    return Number(id);
  }

  async function verified(tx: Db, institutionId: number, row: {
    documentId: number | null; name: string; key: string; amount: number; createdAt: string;
    confidence?: number; status?: string; flags?: string[]; note?: string | null;
  }) {
    const [{ fee_raw_id: rawId }] = await tx`INSERT INTO raw_fee_observations
      (institution_id, source_document_id, source_url, extraction_confidence, agent_event_id, fee_name, amount,
       frequency, source, extraction_note)
      VALUES (${institutionId}, ${row.documentId}, 'https://select.example/fees.pdf', ${row.confidence ?? 0.92},
        ${randomUUID()}, ${row.name}, ${row.amount}, 'per_item', 'knox', ${row.note ?? null})
      RETURNING fee_raw_id`;
    const [{ fee_verified_id: id }] = await tx`INSERT INTO verified_fee_observations
      (fee_raw_id, institution_id, source_url, extraction_confidence, canonical_fee_key, outlier_flags,
       verified_by_agent_event_id, fee_name, amount, frequency, review_status, created_at)
      VALUES (${rawId}, ${institutionId}, 'https://select.example/fees.pdf', ${row.confidence ?? 0.92}, ${row.key},
        ${JSON.stringify(row.flags ?? ["agentic_darwin_verified"])}::jsonb, ${randomUUID()}, ${row.name},
        ${row.amount}, 'per_item', ${row.status ?? "verified"}, ${row.createdAt}::timestamptz)
      RETURNING fee_verified_id`;
    return Number(id);
  }

  async function published(tx: Db, institutionId: number, lineage: number, name: string, rolledBack: string | null) {
    const [{ fee_published_id: id }] = await tx`INSERT INTO published_fee_records
      (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount,
       frequency, batch_id, source_url, rolled_back_at, rolled_back_reason)
      VALUES (${lineage}, ${institutionId}, 'nsf', ${randomUUID()}, ${name}, 30, 'per_item', 'agentic-run-select',
        'https://select.example/fees.pdf', ${rolledBack ? new Date("2026-10-05T00:00:00Z") : null}, ${rolledBack})
      RETURNING fee_published_id`;
    return Number(id);
  }

  async function attempt(tx: Db, institutionId: number, verifiedId: number, outcome: string, detail: object, version?: number) {
    await tx`INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
      VALUES (${institutionId}, 'publish', ${publish.HAMILTON_PUBLISH_STRATEGY.strategy},
        ${version ?? publish.HAMILTON_PUBLISH_STRATEGY.version}, ${publish.verifiedFeeFingerprint(verifiedId)},
        ${outcome}, ${JSON.stringify(detail)}::jsonb)`;
  }

  async function seed(tx: Db): Promise<Fixture> {
    const [{ id: inst }] = await tx`INSERT INTO institution_sources
      (institution_name, website_url, fee_schedule_url, charter_type, state, state_code, asset_size, source, status)
      VALUES ('Selection Fixture Bank', 'https://select.example/', 'https://select.example/fees.pdf',
        'bank', 'Texas', 'TX', 1000000, 'e2e', 'active') RETURNING id`;
    const institutionId = Number(inst);
    const [{ id: companion }] = await tx`INSERT INTO institution_additional_sources
      (institution_id, url, document_role, found_by_strategy)
      VALUES (${institutionId}, 'https://select.example/more-fees.pdf', 'consumer_supplement', 'fixture') RETURNING id`;
    const companionId = Number(companion);
    const docA = await document(tx, institutionId, "https://select.example/more-fees.pdf", "2026-10-01", companionId);
    const docB = await document(tx, institutionId, "https://select.example/fees.pdf", "2026-10-02", null);
    const ids: Record<string, number> = {};
    const add = async (label: string, row: Parameters<typeof verified>[2]) => { ids[label] = await verified(tx, institutionId, row); };

    // Document A (a companion page), oldest rows.
    await add("undecided", { documentId: docA, name: "Overdraft Fee", key: "overdraft", amount: 35, createdAt: "2026-10-01T00:00:01Z" });
    await add("decidedRejected", { documentId: docA, name: "Stop Payment Fee", key: "stop_payment", amount: 30, createdAt: "2026-10-01T00:00:02Z" });
    await add("alreadyLive", { documentId: docA, name: "Wire Fee", key: "wire_domestic_outgoing", amount: 25, createdAt: "2026-10-01T00:00:03Z" });
    await add("freeRead", { documentId: docA, name: "Online Banking", key: "overdraft", amount: 0, createdAt: "2026-10-01T00:00:04Z", note: "Knox read a free fee from the benefits list" });
    await add("olderVersion", { documentId: docA, name: "Paper Statement Fee", key: "paper_statement", amount: 3, createdAt: "2026-10-01T00:00:05Z" });
    await add("notAgentic", { documentId: docA, name: "Dormant Fee", key: "dormant_account", amount: 5, createdAt: "2026-10-01T00:00:06Z", flags: [] });
    await add("reviewRejected", { documentId: docA, name: "Coin Fee", key: "coin_counting", amount: 5, createdAt: "2026-10-01T00:00:07Z", status: "rejected" });
    await published(tx, institutionId, ids.alreadyLive, "Wire Fee", null);
    await attempt(tx, institutionId, ids.decidedRejected, "rejected", { reason: "Missing fee name" });
    await attempt(tx, institutionId, ids.olderVersion, "rejected", { reason: "Missing fee name" }, publish.HAMILTON_PUBLISH_STRATEGY.version - 1);

    // Document B: re-check twin, same-line re-select, low confidence now cleared.
    await add("twinSource", { documentId: docB, name: "NSF Charge", key: "nsf", amount: 30, createdAt: "2026-10-02T00:00:00Z", status: "rejected" });
    const twin = await published(tx, institutionId, ids.twinSource, "NSF Fee", "rules_recheck_unreproduced");
    await add("twin", { documentId: docB, name: "NSF Fee", key: "nsf", amount: 30, createdAt: "2026-10-02T00:00:01Z" });
    await attempt(tx, institutionId, ids.twin, "unchanged", { previous_fee_published_id: String(twin) });
    await add("sameLineLive", { documentId: docB, name: "ATM Adjustment", key: "atm_non_network", amount: 5, createdAt: "2026-10-02T00:00:02Z" });
    const sameLine = await published(tx, institutionId, ids.sameLineLive, "ATM Adjustment", null);
    await add("sameLine", { documentId: docB, name: "ATM Balance Inquiry", key: "atm_non_network", amount: 5, createdAt: "2026-10-02T00:00:03Z" });
    await attempt(tx, institutionId, ids.sameLine, "unchanged", { previous_fee_published_id: String(sameLine) });
    await add("sameLineSettled", { documentId: docB, name: "ATM Inquiry", key: "atm_non_network", amount: 5, createdAt: "2026-10-02T00:00:04Z" });
    await attempt(tx, institutionId, ids.sameLineSettled, "unchanged", { previous_fee_published_id: String(sameLine), same_line_check: 4 });
    await add("confidenceCleared", { documentId: docB, name: "Returned Item Fee", key: "nsf", amount: 30, createdAt: "2026-10-02T00:00:05Z", confidence: 0.9 });
    await attempt(tx, institutionId, ids.confidenceCleared, "rejected", { reason: publish.BELOW_CONFIDENCE_REASON });
    await add("confidenceLow", { documentId: docB, name: "Returned Deposit Fee", key: "nsf", amount: 30, createdAt: "2026-10-02T00:00:06Z", confidence: 0.5 });
    await attempt(tx, institutionId, ids.confidenceLow, "rejected", { reason: publish.BELOW_CONFIDENCE_REASON });
    // #1915: skipped as identical to a next-edition fee Darwin has since held as not yet in effect.
    await add("heldTwinSource", { documentId: docB, name: "Late Charge", key: "nsf", amount: 30, createdAt: "2026-10-02T00:00:07Z", status: "rejected" });
    const heldTwin = await published(tx, institutionId, ids.heldTwinSource, "Late Fee", "not_yet_effective: 2027-01-01 #28999");
    await add("editionTwin", { documentId: docB, name: "Late Fee", key: "nsf", amount: 30, createdAt: "2026-10-02T00:00:08Z" });
    await attempt(tx, institutionId, ids.editionTwin, "unchanged", { previous_fee_published_id: String(heldTwin) });
    // #1945: skipped as identical to an older edition's line Darwin retired for document B, the newer
    // edition (Cedar Falls' 2026 lines behind its 2024 ones). A copy of another document skipped behind
    // the same line stays decided.
    await add("olderEditionSource", { documentId: docA, name: "Wire Fee Outgoing", key: "nsf", amount: 30, createdAt: "2026-10-01T00:00:08Z", status: "rejected" });
    const retired = await published(tx, institutionId, ids.olderEditionSource, "Wire Fee Outgoing", `older_edition: #${docB} dated 2026-03-01`);
    await add("olderEditionOtherCopy", { documentId: docA, name: "Wire Fee Outgoing", key: "nsf", amount: 30, createdAt: "2026-10-01T00:00:09Z" });
    await attempt(tx, institutionId, ids.olderEditionOtherCopy, "unchanged", { previous_fee_published_id: String(retired) });
    await add("olderEditionTwin", { documentId: docB, name: "Wire Fee Outgoing", key: "nsf", amount: 30, createdAt: "2026-10-02T00:00:08.500Z" });
    await attempt(tx, institutionId, ids.olderEditionTwin, "unchanged", { previous_fee_published_id: String(retired) });
    // The same skip on a product page stays decided: it prices one account (Security Federal's
    // Money Market "Paper statements available for $3 per month", docs 25730/25731).
    const productPage = await document(tx, institutionId, "https://select.example/personal/savings/money-market-account", "2026-10-02", null);
    await add("productPageEditionTwin", { documentId: productPage, name: "Late Fee", key: "nsf", amount: 30, createdAt: "2026-10-02T00:00:09Z" });
    await attempt(tx, institutionId, ids.productPageEditionTwin, "unchanged", { previous_fee_published_id: String(heldTwin) });

    // No source document: its own one-row batch, newest.
    await add("noDocument", { documentId: null, name: "Research Fee", key: "research", amount: 25, createdAt: "2026-10-03T00:00:00Z" });
    return { institutionId, companionId, docA, docB, ids };
  }

  const select = (tx: Db, fixture: Fixture, limit: number, learning: boolean, minFees = 1) =>
    publish.selectVerifiedFees(tx, limit, learning, MIN_CONFIDENCE, minFees, fixture.institutionId);
  const labelled = (rows: Selected, fixture: Fixture) => {
    const byId = new Map(Object.entries(fixture.ids).map(([label, id]) => [id, label]));
    return rows.map((row) => byId.get(Number(row.fee_verified_id)));
  };

  it("picks exactly the undecided rows, in batch order, with the same per-row reads", async () => {
    await rollback(async (tx) => {
      const fixture = await seed(tx);
      const rows = await select(tx, fixture, 100, true);
      expect(labelled(rows, fixture)).toEqual([
        "undecided", "freeRead", "olderVersion", "twin", "sameLine", "confidenceCleared", "editionTwin", "olderEditionTwin", "noDocument",
      ]);
      const byLabel = Object.fromEntries(rows.map((row) => [labelled([row], fixture)[0], row]));
      expect(byLabel.twin).toMatchObject({ twin_recheck: true, same_line_reselect: true });
      expect(byLabel.sameLine).toMatchObject({ twin_recheck: false, same_line_reselect: true });
      expect(byLabel.undecided).toMatchObject({
        twin_recheck: false, same_line_reselect: false, free_read: false,
        document_stream: String(fixture.companionId), batch_document_key: String(fixture.docA),
        document_url: "https://select.example/more-fees.pdf", institution_name: "Selection Fixture Bank",
      });
      expect(byLabel.freeRead).toMatchObject({ free_read: true });
      expect(byLabel.twin).toMatchObject({ document_stream: null, batch_document_key: String(fixture.docB) });
      expect(byLabel.noDocument).toMatchObject({
        document_stream: null, document_url: null, source_document_id: null,
        batch_document_key: `row:${fixture.ids.noDocument}`,
      });
      const state = JSON.parse(String(byLabel.undecided.selected_verified_state));
      expect(state).toMatchObject({ fee_verified_id: fixture.ids.undecided, fee_name: "Overdraft Fee", review_status: "verified" });
    });
  });

  it("without the attempt log, picks every unpublished agentic row", async () => {
    await rollback(async (tx) => {
      const fixture = await seed(tx);
      expect(labelled(await select(tx, fixture, 100, false), fixture)).toEqual([
        "undecided", "decidedRejected", "freeRead", "olderVersion", "olderEditionOtherCopy",
        "twin", "sameLine", "sameLineSettled", "confidenceCleared", "confidenceLow", "editionTwin", "olderEditionTwin", "productPageEditionTwin", "noDocument",
      ]);
    });
  });

  it("takes whole documents oldest first and never cuts one in half", async () => {
    await rollback(async (tx) => {
      const fixture = await seed(tx);
      expect(labelled(await select(tx, fixture, 1, true), fixture)).toEqual(["undecided", "freeRead", "olderVersion"]);
      expect(labelled(await select(tx, fixture, 4, true), fixture)).toEqual([
        "undecided", "freeRead", "olderVersion", "twin", "sameLine", "confidenceCleared", "editionTwin", "olderEditionTwin",
      ]);
    });
  });

  it("keeps the depth cut: a thin institution publishes nothing", async () => {
    await rollback(async (tx) => {
      const fixture = await seed(tx);
      expect(await select(tx, fixture, 100, true, 50)).toEqual([]);
      expect(labelled(await select(tx, fixture, 100, true, 3), fixture)).toHaveLength(9);
    });
  });
});
