// @vitest-environment node
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";

import { FRESHNESS_SEARCH_VERSION, STALE_PRICE_REASON, selectStaleCandidates, selectUpgradeCandidates } from "./discovery";
import { rememberedAddressProven } from "./fetch";
import { loadSearchMissDemotions } from "./search-misses";
import { loadMissedSchedules, missedScheduleFeedback } from "./missed-schedules";
import { runSecondDocumentFind } from "./second-document";
import { recordFeedback } from "@/lib/agents/learning/feedback";

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
  "institution_additional_sources",
  "leads",
  "verified_fee_observations",
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

  async function auditMiss(institutionId: number, documentId: number, feeId: number, sourceUrl: string, at: string) {
    n += 1;
    await db`
      INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, source_document_id, fee_published_id, source_url, evidence, dedupe_key, created_at, updated_at)
      VALUES ('discover', 'wrong', 'audit_miss', 'deming', 'hamilton.other_bank_document', ${institutionId}, ${documentId}, ${feeId}, ${sourceUrl},
              '{}'::jsonb, ${`test2055:${n}`}, ${at}, ${at})
    `;
  }

  async function fetched(institutionId: number, documentId: number, detail: Record<string, unknown>, at = "2026-10-01T00:00:00Z", strategy = "fetch.direct", version = 1, outcome = "ok") {
    await db`
      INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, outcome, detail, created_at)
      VALUES (${institutionId}, ${documentId}, 'fetch', ${strategy}, ${version}, ${outcome}, ${JSON.stringify(detail)}::jsonb, ${at})
    `;
  }

  it("takes a redirect's page for the link on a saved-link fetch's proof, even when the plain fetches predate it (#2055)", async () => {
    const redirect = async (id: number, link: string, savedLinkAsked: string | null, version = 2) => {
      const page = `https://bank${id}.example/docs/fees.pdf`;
      await bank(id, `https://bank${id}.example`, link, id * 10 + 1);
      await db`UPDATE institution_source_profiles SET canonical_source_url = ${page} WHERE institution_id = ${id}`;
      await document(id * 10 + 1, id, page);
      // The plain fetches asked for the remembered address and predate detail.link.
      await fetched(id, id * 10 + 1, { url: page }, "2026-09-20T00:00:00Z", "fetch.direct", 1, "unchanged");
      await fetched(id, id * 10 + 1, { url: page, remembered: page, ...(savedLinkAsked ? { link: savedLinkAsked } : {}) }, "2026-10-26T00:00:00Z", "fetch.saved_link", version, "unchanged");
      await archivedFee(id * 100, id, false);
      await auditMiss(id, id * 10 + 1, id * 100, page, "2026-10-20T00:00:00Z");
    };
    // 601: the saved-link fetch asked for today's link and landed on the main document.
    await redirect(601, "https://bank601.example/fees", "https://bank601.example/fees");
    // 602: the link moved since: the saved-link proof is the old link's.
    await redirect(602, "https://bank602.example/fees-2026", "https://bank602.example/fees");
    // 603: a v1 saved-link fetch, which never recorded the link it asked for: no proof (v2 re-tries it).
    await redirect(603, "https://bank603.example/fees", null, 1);
    // 604: a failed fetch is no proof.
    await redirect(604, "https://bank604.example/fees", null);
    await db`UPDATE pipeline_attempts SET outcome = 'http_403', detail = detail || '{"link": "https://bank604.example/fees"}'::jsonb WHERE institution_id = 604 AND strategy = 'fetch.saved_link'`;

    const rows = await selectStaleCandidates(asDb(), 10, "TX", new Date("2026-10-26T00:00:00Z"));
    expect(rows.map((row) => Number(row.id)).sort()).toEqual([601]);

    // The next plain fetch asks for the remembered address; the earlier proof carries forward to it.
    expect(await rememberedAddressProven(asDb(), 601, "https://bank601.example/fees", ["https://bank601.example/docs/fees.pdf"])).toBe(true);
    expect(await rememberedAddressProven(asDb(), 602, "https://bank602.example/fees-2026", ["https://bank602.example/docs/fees.pdf"])).toBe(false);
    expect(await rememberedAddressProven(asDb(), 604, "https://bank604.example/fees", ["https://bank604.example/docs/fees.pdf"])).toBe(false);
  });

  it("never searches behind a link that moved to another page on the old page's audit misses (#2055)", async () => {
    // 401: the link was re-pointed without a search, then Rosetta re-read the old main document,
    // which set the remembered address back to the old page. The new link has not been fetched.
    await bank(401, "https://bank401.example", "https://bank401.example/fees-new.pdf", 4011);
    await db`UPDATE institution_source_profiles SET canonical_source_url = 'https://bank401.example/fees-old.pdf' WHERE institution_id = 401`;
    await document(4011, 401, "https://bank401.example/fees-old.pdf");
    await fetched(401, 4011, { url: "https://bank401.example/fees-old.pdf", link: "https://bank401.example/fees-old.pdf" });
    await archivedFee(40100, 401, false);
    await auditMiss(401, 4011, 40100, "https://bank401.example/fees-old.pdf", "2026-10-20T00:00:00Z");
    // 402: the link redirects; its own fetch landed on the main document, so the miss counts.
    await bank(402, "https://bank402.example", "https://bank402.example/fees", 4021);
    await db`UPDATE institution_source_profiles SET canonical_source_url = 'https://bank402.example/docs/fees.pdf' WHERE institution_id = 402`;
    await document(4021, 402, "https://bank402.example/docs/fees.pdf");
    await fetched(402, 4021, { url: "https://bank402.example/docs/fees.pdf", link: "https://bank402.example/fees" });
    await archivedFee(40200, 402, false);
    await auditMiss(402, 4021, 40200, "https://bank402.example/docs/fees.pdf", "2026-10-20T00:00:00Z");
    // 403: the miss is on the link's own address.
    await bank(403, "https://bank403.example", "https://bank403.example/fees.pdf", 4031);
    await document(4031, 403, "https://bank403.example/fees.pdf");
    await archivedFee(40300, 403, false);
    await auditMiss(403, 4031, 40300, "https://bank403.example/fees.pdf", "2026-10-20T00:00:00Z");

    const rows = await selectStaleCandidates(asDb(), 10, "TX", new Date("2026-10-26T00:00:00Z"));
    expect(rows.map((row) => Number(row.id)).sort()).toEqual([402, 403]);
    expect(rows.find((row) => Number(row.id) === 402)).toMatchObject({
      stale_reason: "Deming's audit found fees read from it came from the wrong document",
      audit_document_ids: [4021],
    });
  });

  it("acts on each audit miss once, against its own document, whatever other search ran (#2055)", async () => {
    const linked = async (id: number, at: string) => {
      await bank(id, `https://bank${id}.example`, `https://bank${id}.example/fees.pdf`, id * 10 + 1);
      await document(id * 10 + 1, id, `https://bank${id}.example/fees.pdf`);
      await archivedFee(id * 100, id, false);
      await auditMiss(id, id * 10 + 1, id * 100, `https://bank${id}.example/fees.pdf`, at);
    };
    // 501: an age search ran on the same document before the miss; it did not act on the miss.
    await linked(501, "2026-10-20T00:00:00Z");
    await searched(501, { freshness_search: FRESHNESS_SEARCH_VERSION, stale_reason: "effective 2022" }, "2026-10-05T00:00:00Z");
    // 502: a search already acted on this document's misses; a later miss on another fee is the same finding.
    await linked(502, "2026-10-20T00:00:00Z");
    await searched(502, { freshness_search: FRESHNESS_SEARCH_VERSION, audit_document_ids: [5021] }, "2026-10-21T00:00:00Z");
    await archivedFee(50201, 502, false);
    await auditMiss(502, 5021, 50201, "https://bank502.example/fees.pdf", "2026-10-24T00:00:00Z");
    // 503: a search acted on another document of the bank; this document's miss is still new.
    await linked(503, "2026-10-20T00:00:00Z");
    await searched(503, { freshness_search: FRESHNESS_SEARCH_VERSION, audit_document_ids: [9999] }, "2026-10-21T00:00:00Z");
    // 504: an age search after the miss that did not act on it (the miss did not count then).
    await linked(504, "2026-10-20T00:00:00Z");
    await searched(504, { freshness_search: FRESHNESS_SEARCH_VERSION, stale_reason: "effective 2022" }, "2026-10-22T00:00:00Z");

    const rows = await selectStaleCandidates(asDb(), 10, "TX", new Date("2026-10-26T00:00:00Z"));
    expect(rows.map((row) => Number(row.id)).sort()).toEqual([501, 503, 504]);
    expect(rows.find((row) => Number(row.id) === 501)).toMatchObject({ audit_document_ids: [5011], freshness_exclude: ["https://bank501.example/fees.pdf"] });
  });

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
    // An age search kept the link before Hamilton saw the conflict: it did not know the newer document.
    await stale(107, "https://bank107.example/fees.pdf");
    await searched(107, { freshness_search: FRESHNESS_SEARCH_VERSION }, "2026-10-05T00:00:00Z");

    const rows = await selectStaleCandidates(asDb(), 10, "TX", new Date("2026-10-26T00:00:00Z"));
    expect(rows.map((row) => Number(row.id)).sort()).toEqual([101, 107]);
    expect(rows.find((row) => Number(row.id) === 101)).toMatchObject({
      freshness: true,
      stale_reason: STALE_PRICE_REASON,
      stale_price: { kept_urls: ["https://bank101.example/fees-current.pdf"], only: true },
    });
    // Not a wrong document: no address beyond the link is ruled out.
    expect(rows.find((row) => Number(row.id) === 101)?.freshness_exclude).toBeUndefined();
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
    // An upgrade search ran before Hamilton saw the conflict.
    await conflict(204, "https://bank204.example/p/7");
    await searched(204, { upgrade_search: 2 }, "2026-10-05T00:00:00Z");

    const rows = await selectUpgradeCandidates(asDb(), 10, "TX");
    expect(rows.map((row) => Number(row.id)).sort()).toEqual([201, 204]);
    expect(rows.find((row) => Number(row.id) === 201)).toMatchObject({ upgrade: true, upgrade_reason: "schedule_conflict" });
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

  it("sends a bank with a missed second schedule back to the companion finder once, in any state (#2070)", async () => {
    // The writer upserts on the dedupe key, which LIKE does not copy.
    await db`CREATE UNIQUE INDEX IF NOT EXISTS pipeline_feedback_dedupe_key_test ON pipeline_feedback (dedupe_key)`;
    for (const id of [401, 402, 403, 404]) await bank(id, `https://bank${id}.example`, `https://bank${id}.example/fees`);
    await db`UPDATE institution_sources SET state_code = 'OK' WHERE id = 402`;
    await db`UPDATE institution_sources SET status = 'closed' WHERE id = 404`;
    const missed = (id: number) => missedScheduleFeedback({ institutionId: id, documentUrl: `https://bank${id}.example/overdraft.pdf`, documentType: "pdf", categories: ["overdraft"], evidenceFeeIds: [id] });
    await recordFeedback(asDb(), [missed(401), missed(402), missed(403), missed(404)]);
    // Bank 403's companion search ran after its row: the row is closed.
    await db`
      INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, outcome, detail, created_at)
      VALUES (403, 'discover', 'discover.second_document', 5, 'no_candidates', '{}'::jsonb, NOW() + interval '1 second')
    `;
    const all = await loadMissedSchedules(asDb(), { limit: 10 });
    expect([...all.urls.keys()].sort()).toEqual([401, 402]);
    expect(all.urls.get(401)).toEqual(["https://bank401.example/overdraft.pdf"]);
    // A state lane keeps to its state; the step's own picks are left out.
    expect([...(await loadMissedSchedules(asDb(), { stateCode: "ok", limit: 10 })).urls.keys()]).toEqual([402]);
    expect([...(await loadMissedSchedules(asDb(), { excludeIds: [401], limit: 10 })).urls.keys()]).toEqual([402]);
    // Written again the next day, the row keeps its first time, so a searched bank is not sent back daily.
    await db`
      INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, outcome, detail, created_at)
      VALUES (401, 'discover', 'discover.second_document', 5, 'ok', '{}'::jsonb, NOW() + interval '1 second')
    `;
    await recordFeedback(asDb(), [missed(401)]);
    expect([...(await loadMissedSchedules(asDb(), { limit: 10 })).urls.keys()]).toEqual([402]);
  });

  it("searches a missed second schedule's bank in rescue mode's companion pass and keeps the missed page (#2070)", async () => {
    await db`CREATE UNIQUE INDEX IF NOT EXISTS pipeline_feedback_dedupe_key_test ON pipeline_feedback (dedupe_key)`;
    await db`CREATE UNIQUE INDEX IF NOT EXISTS institution_additional_sources_test ON institution_additional_sources (institution_id, url)`;
    // A full bank (many live categories) that the thin-bank search would never pick.
    await bank(501, "https://bank501.example", "https://bank501.example/fees");
    const keys = ["overdraft", "nsf", "monthly_maintenance", "stop_payment", "wire_domestic_outgoing", "paper_statement", "atm_non_network", "cashiers_check", "dormant_account"];
    for (const [index, key] of keys.entries()) {
      await db`
        INSERT INTO published_fee_records (fee_published_id, institution_id, canonical_fee_key, fee_name, published_by_adversarial_event_id, lineage_ref)
        VALUES (${5010 + index}, 501, ${key}, ${key}, gen_random_uuid(), ${5010 + index})
      `;
    }
    await bank(502, "https://bank502.example", "https://bank502.example/fees");
    await recordFeedback(asDb(), [missedScheduleFeedback({ institutionId: 501, documentUrl: "https://bank501.example/overdraft-fee-schedule", categories: ["overdraft"] })]);
    const page = "<html><body><main><h1>Overdraft Fee Schedule</h1><p>Overdraft fee $35.00 per item</p><p>NSF fee $35.00 per item</p><p>Returned item fee $30.00</p><p>Stop payment fee $30.00</p><p>Extended overdraft fee $5.00 per day</p></main></body></html>";
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      const body = url.includes("overdraft-fee-schedule") ? page : "<html><body><main>Welcome</main></body></html>";
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const result = await runSecondDocumentFind({ db: asDb(), fetchImpl, runId: 1, deadline: Date.now() + 60_000, learning: true, missedOnly: true });
    expect(result).toMatchObject({ status: "ran", checked: 1, missedSchedules: 1 });
    expect(result.results[0]).toMatchObject({ institutionId: 501, outcome: "ok" });
    expect(await db`SELECT institution_id, url FROM institution_additional_sources`).toEqual([{ institution_id: "501", url: "https://bank501.example/overdraft-fee-schedule" }]);
    // The search closes the row: the bank is not sent back again.
    expect((await loadMissedSchedules(asDb(), { limit: 10 })).urls.size).toBe(0);
  });
});
