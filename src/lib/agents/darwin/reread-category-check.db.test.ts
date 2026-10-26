/**
 * The re-read category re-check in real PostgreSQL (production schema, loopback only, #1513): the
 * step reads only live fees whose Knox re-read settled `other_category`, a dry run and the switch
 * off write nothing, and switched on a match is re-filed in place only on its second look, with the
 * old category and name logged.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { REREAD_CATEGORY_CHECK, REREAD_CATEGORY_REFILED_KIND, recheckRereadCategories, rereadCategoryRows } from "./reread-category-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1513001;
const DOC = 1513101;
const EVENT = "00000000-0000-4000-8000-000001513000";
// Local 804 FCU's stored sentence (text 24713, live 128668).
const TEXT = "There is a grace period of 14 days to correct a negative balance. After the 14-day grace period, there will be a Negative Balance Fee of $2.00 per day. For ATM and Debit Card transactions ONLY, when funds are available in your savings, there will be a $1 Overdraft Transfer Fee.";
const FRAGMENT = "For ATM and Debit Card transactions ONLY, when funds are available in your savings, there will be a";

describe.skipIf(!connection)("re-read category re-check in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 1513200;
  const runIds: number[] = [];
  const ids: Record<string, number> = {};

  async function seed(label: string, key: string, name: string, amount: number, outcome: string | null): Promise<void> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source)
              VALUES (${rawId}, ${INST}, ${DOC}, ${EVENT}, ${name}, ${amount}, 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'agentic-run-1513', 'https://cu.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
    ids[`${label}Verified`] = Number(verified.fee_verified_id);
    if (outcome) {
      await raw`INSERT INTO pipeline_feedback (about_stage, about_strategy, about_version, signal, kind, reported_by, check_name, institution_id, source_document_id, fee_published_id, canonical_fee_key, amount, weight, evidence, dedupe_key)
                VALUES ('extract', 'knox.reread_feedback', 1, 'wrong', 'knox_reread_resolved', 'knox', 'knox.reread_feedback', ${INST}, ${DOC}, ${ids[label]}, ${key}, ${amount}, 0,
                        ${raw.json({ outcome, resolved: false, fragment_name: name, rules_version: 124 })}, ${`test-1513:${label}`})`;
    }
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id = ${DOC}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Re-read category DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    for (let index = 0; index < 2; index += 1) {
      const [run] = await raw<{ id: number }[]>`INSERT INTO agent_runs (agent_name, run_kind, title, status) VALUES ('darwin', 'state_agent', 'Re-read category fixture', 'running') RETURNING id`;
      runIds.push(Number(run.id));
    }
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Re-read Category Test FCU', 'credit_union', 'ncua', 'NY')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://cu.test/overdraft-protection', 'h1', NOW())`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${DOC}, ${INST}, 'https://cu.test/overdraft-protection', 'html', 'completed', ${TEXT}, 't-1513', ${TEXT.length})`;
    await seed("misfiled", "atm_non_network", FRAGMENT, 1, "other_category");
    // A re-read that settled same_name and a fee with no request are not read.
    await seed("sameName", "continuous_od", "there will be a Negative Balance Fee of", 2, "same_name");
    await seed("plain", "atm_non_network", "Non-network ATM withdrawal", 2.5, null);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    for (const id of runIds) await raw`DELETE FROM agent_run_events WHERE agent_run_id = ${id}`;
    for (const id of runIds) await raw`DELETE FROM agent_runs WHERE id = ${id}`;
    await raw.end();
  });

  const live = async () => (await raw<{ canonical_fee_key: string; fee_name: string }[]>`
    SELECT canonical_fee_key, fee_name FROM published_fee_records WHERE fee_published_id = ${ids.misfiled} AND rolled_back_at IS NULL`)[0];

  it("reads only live fees whose re-read settled other_category", async () => {
    const rows = await rereadCategoryRows(raw as never, { institutionId: INST });
    expect(rows.map((row) => Number(row.fee_published_id))).toEqual([ids.misfiled]);
    expect(rows[0].normalized_text).toBe(TEXT);
  });

  it("writes nothing on a dry run or with the switch off", async () => {
    const dry = await recheckRereadCategories(raw as never, { runId: runIds[0], dryRun: true, institutionId: INST, live: true });
    expect(dry).toMatchObject({ checked: 1, matched: 1, outcomes: { refile: 1 }, refiled: [] });
    const off = await recheckRereadCategories(raw as never, { runId: runIds[0], dryRun: false, institutionId: INST });
    expect(off).toMatchObject({ live: false, matched: 1, flagged: 0, refiled: [] });
    expect(await live()).toEqual({ canonical_fee_key: "atm_non_network", fee_name: FRAGMENT });
    const [{ n }] = await raw<{ n: number }[]>`SELECT count(*)::int AS n FROM pipeline_feedback WHERE institution_id = ${INST} AND check_name = ${REREAD_CATEGORY_CHECK}`;
    expect(n).toBe(0);
  });

  it("switched on, flags first and re-files on the second look, logging the old values", async () => {
    const now = new Date();
    const first = await recheckRereadCategories(raw as never, { runId: runIds[0], dryRun: false, institutionId: INST, live: true, now });
    expect(first).toMatchObject({ flagged: 1, refiled: [] });
    expect((await live()).canonical_fee_key).toBe("atm_non_network");

    const later = new Date(now.getTime() + 13 * 60 * 60 * 1000);
    const second = await recheckRereadCategories(raw as never, { runId: runIds[1], dryRun: false, institutionId: INST, live: true, now: later });
    expect(second.refiled).toEqual([ids.misfiled]);
    expect(await live()).toEqual({
      canonical_fee_key: "od_protection_transfer",
      fee_name: "Overdraft Transfer Fee (For ATM and Debit Card transactions ONLY, when funds are available in your savings)",
    });
    const [verified] = await raw<{ canonical_fee_key: string }[]>`SELECT canonical_fee_key FROM verified_fee_observations WHERE fee_verified_id = ${ids.misfiledVerified}`;
    expect(verified.canonical_fee_key).toBe("od_protection_transfer");
    const [logged] = await raw<{ evidence: string | Record<string, unknown> }[]>`
      SELECT evidence FROM pipeline_feedback WHERE kind = ${REREAD_CATEGORY_REFILED_KIND} AND fee_published_id = ${ids.misfiled}`;
    const evidence = typeof logged.evidence === "string" ? JSON.parse(logged.evidence) : logged.evidence;
    expect(evidence).toMatchObject({ from: "atm_non_network", to: "od_protection_transfer", old_name: FRAGMENT });
    // Renamed since: the request's fragment no longer matches, so a later step leaves it alone.
    const third = await recheckRereadCategories(raw as never, { runId: runIds[1], dryRun: true, institutionId: INST, live: true, now: later });
    expect(third.outcomes).toEqual({ stale: 1 });
  });
});
