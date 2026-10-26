// @vitest-environment node
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";

import { FRESHNESS_SEARCH_VERSION, STALE_PRICE_REASON, selectStaleCandidates, selectUpgradeCandidates } from "./discovery";
import { loadSearchMissDemotions } from "./search-misses";

const connection = process.env.E2E_DATABASE_URL;
const schema = `magellan_feedback_${randomBytes(8).toString("hex")}`;
const TABLES = [
  "institution_sources",
  "institution_source_profiles",
  "source_documents",
  "agent_source_texts",
  "pipeline_attempts",
  "pipeline_feedback",
  "published_fee_records",
];

/**
 * #2062 on real PostgreSQL: seeded stale_price, schedule_conflict and search_miss rows reach
 * Magellan's searches, and only rows about the link's own current page do (#2558's safety).
 */
describe.skipIf(!connection)("Magellan reads Hamilton's conflict lessons and its own search misses in isolated PostgreSQL", () => {
  let admin: postgres.Sql;
  let db: postgres.Sql<{ json: unknown }>;
  const asDb = () => db as never;
  let n = 0;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Loopback test database required");
    admin = postgres(connection, { ssl: "require", prepare: false, onnotice: () => undefined });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    for (const table of TABLES) {
      await admin.unsafe(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    }
    db = postgres(connection, { ssl: "require", prepare: false, connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
  });

  beforeEach(async () => {
    await db.unsafe(`TRUNCATE ${TABLES.join(", ")}`);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (admin) {
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  async function bank(id: number, site: string, link: string | null, mainDocumentId: number | null = null) {
    await db`
      INSERT INTO institution_sources (id, institution_name, charter_type, source, status, state_code, website_url, fee_schedule_url, asset_size)
      VALUES (${id}, ${`Bank ${id}`}, 'commercial', 'fdic', 'active', 'TX', ${site}, ${link}, ${1000 - id})
    `;
    await db`
      INSERT INTO institution_source_profiles (institution_id, state_code, canonical_source_url, last_successful_source_document_id)
      VALUES (${id}, 'TX', ${link}, ${mainDocumentId})
    `;
  }

  async function document(id: number, institutionId: number, url: string, extra: { companion?: number; supersededBy?: number; crawledAt?: string } = {}) {
    await db`
      INSERT INTO source_documents (id, institution_id, status, document_url, companion_source_id, superseded_by_id, crawled_at)
      VALUES (${id}, ${institutionId}, 'success', ${url}, ${extra.companion ?? null}, ${extra.supersededBy ?? null}, ${extra.crawledAt ?? "2026-10-01T00:00:00Z"})
    `;
  }

  async function archivedFee(id: number, institutionId: number, rolledBack = true) {
    await db`
      INSERT INTO published_fee_records (fee_published_id, institution_id, canonical_fee_key, fee_name, published_by_adversarial_event_id, lineage_ref, rolled_back_at)
      VALUES (${id}, ${institutionId}, 'paper_statement', 'Paper statement', gen_random_uuid(), ${id}, ${rolledBack ? db`NOW()` : null})
    `;
  }

  async function lesson(kind: string, check: string, institutionId: number, values: { documentId?: number; feeId?: number; evidence?: unknown; sourceUrl?: string; at?: string }) {
    n += 1;
    await db`
      INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, source_document_id, fee_published_id, source_url, evidence, dedupe_key, created_at, updated_at)
      VALUES (${kind === "search_miss" ? "discover" : "publish"}, ${kind === "search_miss" ? "missed" : "wrong"}, ${kind}, ${kind === "search_miss" ? "magellan" : "gutenberg"},
              ${check}, ${institutionId}, ${values.documentId ?? null}, ${values.feeId ?? null}, ${values.sourceUrl ?? null},
              ${JSON.stringify(values.evidence ?? {})}::jsonb, ${`test2062:${n}`}, ${values.at ?? "2026-10-20T00:00:00Z"}, ${values.at ?? "2026-10-20T00:00:00Z"})
    `;
  }

  async function searched(institutionId: number, detail: Record<string, unknown>, at: string) {
    await db`
      INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, outcome, detail, created_at)
      VALUES (${institutionId}, 'discover', 'discover.homepage_links', 1, 'no_candidates', ${JSON.stringify(detail)}::jsonb, ${at})
    `;
  }

  it("sends a stale price on the link's own current page to the freshness search, and nothing else", async () => {
    const stale = async (id: number, link: string, linkDoc: { companion?: number; supersededBy?: number } = {}, rolledBack = true) => {
      await bank(id, `https://bank${id}.example`, link, id * 10 + 1);
      await document(id * 10 + 1, id, linkDoc.companion ? `https://bank${id}.example/old-edition.pdf` : link, linkDoc);
      await document(id * 10 + 2, id, `https://bank${id}.example/fees-current.pdf`);
      await archivedFee(id * 100, id, rolledBack);
      await lesson("stale_price", "hamilton.cross_page_conflict", id, { documentId: id * 10 + 1, feeId: id * 100, evidence: { kept_document_id: id * 10 + 2 } });
    };
    await stale(101, "https://bank101.example/fees.pdf");
    // An old edition kept as a companion beside a current link (17 of prod's first 19 rows).
    await stale(102, "https://bank102.example/fees.pdf", { companion: 7 });
    // The link's page has a newer copy: the finding is about an old copy.
    await stale(103, "https://bank103.example/fees.pdf", { supersededBy: 9999 });
    // The older price is live again: the finding no longer stands.
    await stale(104, "https://bank104.example/fees.pdf", {}, false);
    // Already searched behind this document.
    await stale(105, "https://bank105.example/fees.pdf");
    await searched(105, { freshness_search: FRESHNESS_SEARCH_VERSION }, "2026-10-21T00:00:00Z");
    // The "newer" document is a companion: never a page the link gives way to.
    await stale(106, "https://bank106.example/fees.pdf");
    await db`UPDATE source_documents SET companion_source_id = 11 WHERE id = ${1062}`;

    const rows = await selectStaleCandidates(asDb(), 10, "TX", new Date("2026-10-26T00:00:00Z"));
    expect(rows.map((row) => Number(row.id))).toEqual([101]);
    expect(rows[0]).toMatchObject({
      freshness: true,
      stale_reason: STALE_PRICE_REASON,
      stale_price: { kept_urls: ["https://bank101.example/fees-current.pdf"], only: true },
    });
    // Not a wrong document: no address beyond the link is ruled out.
    expect(rows[0].freshness_exclude).toBeUndefined();
  });

  it("sends a schedule conflict on the link's own current page to the upgrade search, whatever its address", async () => {
    const conflict = async (id: number, link: string, companion?: number) => {
      await bank(id, `https://bank${id}.example`, link, id * 10 + 1);
      await document(id * 10 + 1, id, companion ? `https://bank${id}.example/personal/checking` : link, { companion });
      await archivedFee(id * 100, id);
      await lesson("schedule_conflict", "hamilton.product_page_conflict", id, { documentId: id * 10 + 1, feeId: id * 100 });
    };
    await conflict(201, "https://bank201.example/p/123");
    // A companion account page beside a schedule link (both prod rows on 2026-10-26).
    await conflict(202, "https://bank202.example/fees", 5);
    // Already given an upgrade search behind this document.
    await conflict(203, "https://bank203.example/p/9");
    await searched(203, { upgrade_search: 2 }, "2026-10-21T00:00:00Z");

    const rows = await selectUpgradeCandidates(asDb(), 10, "TX");
    expect(rows.map((row) => Number(row.id))).toEqual([201]);
    expect(rows[0]).toMatchObject({ upgrade: true, upgrade_reason: "schedule_conflict" });
  });

  it("gives the next search the specialists its last miss on the same website saw nothing with", async () => {
    await bank(301, "https://bank301.example", null);
    await bank(302, "https://bank302.example", null);
    await lesson("search_miss", "magellan.search_miss", 301, {
      sourceUrl: "https://bank301.example",
      at: "2026-10-01T00:00:00Z",
      evidence: { finders: [{ key: "siteCrawl", outcome: "no_candidates" }] },
    });
    await lesson("search_miss", "magellan.search_miss", 301, {
      sourceUrl: "https://bank301.example",
      at: "2026-10-20T00:00:00Z",
      evidence: { finders: [
        { key: "sitemap", outcome: "no_candidates" },
        { key: "hubPages", outcome: "wrong_document" },
        { key: "commonPaths", outcome: "no_candidates" },
        { key: "platformPaths", outcome: "timeout" },
      ] },
    });
    // A miss on the bank's old website says nothing about its current one.
    await lesson("search_miss", "magellan.search_miss", 302, {
      sourceUrl: "https://old-bank302.example",
      evidence: { finders: [{ key: "sitemap", outcome: "no_candidates" }] },
    });
    // A miss from before the bank's last successful find is out of date.
    await bank(303, "https://bank303.example", null);
    await lesson("search_miss", "magellan.search_miss", 303, {
      sourceUrl: "https://bank303.example",
      at: "2026-10-10T00:00:00Z",
      evidence: { finders: [{ key: "sitemap", outcome: "no_candidates" }] },
    });
    await db`
      INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, outcome, detail, created_at)
      VALUES (303, 'discover', 'discover.sitemap', 2, 'ok', '{}'::jsonb, '2026-10-12T00:00:00Z')
    `;

    const demotions = await loadSearchMissDemotions(asDb(), [
      { id: 301, website_url: "https://bank301.example" },
      { id: 302, website_url: "https://bank302.example" },
      { id: 303, website_url: "https://bank303.example" },
    ]);
    expect([...demotions.keys()]).toEqual([301]);
    expect(demotions.get(301)).toEqual(["discover.sitemap", "discover.common_paths"]);
  });
});
