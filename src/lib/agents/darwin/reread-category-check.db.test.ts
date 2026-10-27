/**
 * The re-read category re-check in real PostgreSQL (production schema, loopback only, #1513): the
 * step reads only live fees whose Knox re-read settled `other_category`, a dry run and the switch
 * off write nothing, and switched on a match is re-filed in place, or taken down beside its live
 * twin, only on its second look. A twin takedown never removes the line's only right copy: not when
 * the twin is itself taken down in the same statement, nor when the twin left the category.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import {
  REREAD_CATEGORY_CHECK,
  REREAD_CATEGORY_REFILED_KIND,
  archiveRereadCategoryTwins,
  recheckRereadCategories,
  rereadCategoryRows,
  type RereadCategoryVerdict,
} from "./reread-category-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1513001;
const BOX_INST = 1513002;
const PAIR_INST = 1513003;
const DOC = 1513101;
const BOX_DOC = 1513102;
const PAIR_DOC = 1513103;
const INSTITUTIONS = [INST, BOX_INST, PAIR_INST];
const EVENT = "00000000-0000-4000-8000-000001513000";
// Local 804 FCU's stored sentence (text 24713, live 128668).
const TEXT = "There is a grace period of 14 days to correct a negative balance. After the 14-day grace period, there will be a Negative Balance Fee of $2.00 per day. For ATM and Debit Card transactions ONLY, when funds are available in your savings, there will be a $1 Overdraft Transfer Fee.";
const FRAGMENT = "For ATM and Debit Card transactions ONLY, when funds are available in your savings, there will be a";
// Ripco's stored rows (text 5408, live 35970 beside its twin 158740).
const BOX_TEXT = [
  "Dormant Account (Per Month) | $10.00 Safe Deposit Box Fees",
  "Any account with aggregate share balances of $500.00 or less, and no member | 3x5x21” per year | $20.00",
  "initiated activity on any share under that member number for the previous 12",
  "months, shall be considered dormant, and a fee will be assessed on each share. | 3x10x21” per year | $30.00",
  "Accounts where the primary owner is under age 18 are exempt. IRAs, HSAs,",
].join("\n");
const BOX_FRAGMENT = "months, shall be considered dormant, and a fee will be assessed on each share. | 3x10x21” per year";

describe.skipIf(!connection)("re-read category re-check in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 1513200;
  const runIds: number[] = [];
  const ids: Record<string, number> = {};

  async function seed(label: string, inst: number, doc: number, key: string, name: string, amount: number, outcome: string | null): Promise<void> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source)
              VALUES (${rawId}, ${inst}, ${doc}, ${EVENT}, ${name}, ${amount}, 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
              VALUES (${rawId}, ${inst}, ${key}, ${EVENT}, ${name}, ${amount}, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${inst}, ${key}, ${EVENT}, ${name}, ${amount}, 'agentic-run-1513', 'https://cu.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
    ids[`${label}Verified`] = Number(verified.fee_verified_id);
    if (outcome) {
      await raw`INSERT INTO pipeline_feedback (about_stage, about_strategy, about_version, signal, kind, reported_by, check_name, institution_id, source_document_id, fee_published_id, canonical_fee_key, amount, weight, evidence, dedupe_key)
                VALUES ('extract', 'knox.reread_feedback', 1, 'wrong', 'knox_reread_resolved', 'knox', 'knox.reread_feedback', ${inst}, ${doc}, ${ids[label]}, ${key}, ${amount}, 0,
                        ${raw.json({ outcome, resolved: false, fragment_name: name, rules_version: 124 })}, ${`test-1513:${label}`})`;
    }
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ANY(${INSTITUTIONS}::bigint[])`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ANY(${INSTITUTIONS}::bigint[])`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ANY(${INSTITUTIONS}::bigint[])`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ANY(${INSTITUTIONS}::bigint[])`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id = ANY(${[DOC, BOX_DOC, PAIR_DOC]}::bigint[])`;
    await raw`DELETE FROM source_documents WHERE institution_id = ANY(${INSTITUTIONS}::bigint[])`;
    await raw`DELETE FROM institution_sources WHERE id = ANY(${INSTITUTIONS}::bigint[])`;
  }

  async function document(inst: number, doc: number, text: string | null): Promise<void> {
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${inst}, ${`Re-read Category Test FCU ${inst}`}, 'credit_union', 'ncua', 'NY')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${doc}, ${inst}, 'success', ${`https://cu.test/${doc}`}, ${`h${doc}`}, NOW())`;
    if (text) {
      await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
                VALUES (${doc}, ${inst}, ${`https://cu.test/${doc}`}, 'html', 'completed', ${text}, ${`t-${doc}`}, ${text.length})`;
    }
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
    await document(INST, DOC, TEXT);
    await seed("misfiled", INST, DOC, "atm_non_network", FRAGMENT, 1, "other_category");
    // A re-read that settled same_name and a fee with no request are not read.
    await seed("sameName", INST, DOC, "continuous_od", "there will be a Negative Balance Fee of", 2, "same_name");
    await seed("plain", INST, DOC, "atm_non_network", "Non-network ATM withdrawal", 2.5, null);

    await document(BOX_INST, BOX_DOC, BOX_TEXT);
    await seed("boxMisfiled", BOX_INST, BOX_DOC, "dormant_account", BOX_FRAGMENT, 30, "other_category");
    await seed("boxTwin", BOX_INST, BOX_DOC, "safe_deposit_box", "Safe Deposit Box 3x10x21” per year", 30, null);

    await document(PAIR_INST, PAIR_DOC, null);
    await seed("pairA", PAIR_INST, PAIR_DOC, "dormant_account", "Pair A", 30, null);
    await seed("pairB", PAIR_INST, PAIR_DOC, "dormant_account", "Pair B", 30, null);
    await seed("movedTwin", PAIR_INST, PAIR_DOC, "safe_deposit_box", "Moved twin", 45, null);
    await seed("leftBehind", PAIR_INST, PAIR_DOC, "dormant_account", "Left behind", 45, null);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    for (const id of runIds) await raw`DELETE FROM agent_run_events WHERE agent_run_id = ${id}`;
    for (const id of runIds) await raw`DELETE FROM agent_runs WHERE id = ${id}`;
    await raw.end();
  });

  const liveRow = async (id: number) => (await raw<{ canonical_fee_key: string; fee_name: string }[]>`
    SELECT canonical_fee_key, fee_name FROM published_fee_records WHERE fee_published_id = ${id} AND rolled_back_at IS NULL`)[0];
  const later = (now: Date) => new Date(now.getTime() + 13 * 60 * 60 * 1000);

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
    expect(await liveRow(ids.misfiled)).toEqual({ canonical_fee_key: "atm_non_network", fee_name: FRAGMENT });
    const [{ n }] = await raw<{ n: number }[]>`SELECT count(*)::int AS n FROM pipeline_feedback WHERE institution_id = ${INST} AND check_name = ${REREAD_CATEGORY_CHECK}`;
    expect(n).toBe(0);
  });

  it("switched on, flags first and re-files on the second look, logging the old values", async () => {
    const now = new Date();
    const first = await recheckRereadCategories(raw as never, { runId: runIds[0], stepId: null, dryRun: false, institutionId: INST, live: true, now });
    expect(first).toMatchObject({ flagged: 1, refiled: [] });
    expect((await liveRow(ids.misfiled)).canonical_fee_key).toBe("atm_non_network");

    const second = await recheckRereadCategories(raw as never, { runId: runIds[1], dryRun: false, institutionId: INST, live: true, now: later(now) });
    expect(second.refiled).toEqual([ids.misfiled]);
    expect(await liveRow(ids.misfiled)).toEqual({
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
    const third = await recheckRereadCategories(raw as never, { runId: runIds[1], dryRun: true, institutionId: INST, live: true, now: later(now) });
    expect(third.outcomes).toEqual({ stale: 1 });
  });

  it("switched on, takes a misfiled copy down beside its live twin on the second look, the twin kept", async () => {
    const now = new Date();
    const first = await recheckRereadCategories(raw as never, { runId: runIds[0], dryRun: false, institutionId: BOX_INST, live: true, now });
    expect(first).toMatchObject({ outcomes: { twin: 1 }, flagged: 1, takenDown: [] });
    const second = await recheckRereadCategories(raw as never, { runId: runIds[1], dryRun: false, institutionId: BOX_INST, live: true, now: later(now) });
    expect(second.takenDown).toEqual([ids.boxMisfiled]);
    expect(await liveRow(ids.boxMisfiled)).toBeUndefined();
    const [down] = await raw<{ rolled_back_reason: string }[]>`SELECT rolled_back_reason FROM published_fee_records WHERE fee_published_id = ${ids.boxMisfiled}`;
    expect(down.rolled_back_reason).toBe(`reread_category_twin: live fee #${ids.boxTwin}`);
    const [verified] = await raw<{ review_status: string }[]>`SELECT review_status FROM verified_fee_observations WHERE fee_verified_id = ${ids.boxMisfiledVerified}`;
    expect(verified.review_status).toBe("rejected");
    expect((await liveRow(ids.boxTwin)).canonical_fee_key).toBe("safe_deposit_box");
  });

  const twinVerdict = (fee: string, twin: string, from: string, to: string, amount: number): RereadCategoryVerdict => ({
    feePublishedId: ids[fee], feeVerifiedId: ids[`${fee}Verified`], institutionId: PAIR_INST, sourceDocumentId: PAIR_DOC, amount,
    canonicalFeeKey: from, feeName: fee, outcome: "twin", newKey: to, newName: twin, twinFeePublishedId: ids[twin],
    reason: `reread_category_twin: live fee #${ids[twin]}`,
  });

  it("never takes down two fees that are each other's twin", async () => {
    const taken = await archiveRereadCategoryTwins(raw as never, runIds[1], null, [
      twinVerdict("pairA", "pairB", "dormant_account", "dormant_account", 30),
      twinVerdict("pairB", "pairA", "dormant_account", "dormant_account", 30),
    ]);
    expect(taken).toEqual([]);
    expect(await liveRow(ids.pairA)).toBeDefined();
    expect(await liveRow(ids.pairB)).toBeDefined();
  });

  it("never takes a fee down beside a twin re-filed out of the category in the same pass", async () => {
    // The pass's re-file ran first and moved the twin out of safe_deposit_box.
    await raw`UPDATE published_fee_records SET canonical_fee_key = 'key_replacement' WHERE fee_published_id = ${ids.movedTwin}`;
    const taken = await archiveRereadCategoryTwins(raw as never, runIds[1], null, [twinVerdict("leftBehind", "movedTwin", "dormant_account", "safe_deposit_box", 45)]);
    expect(taken).toEqual([]);
    expect(await liveRow(ids.leftBehind)).toBeDefined();
  });
});
