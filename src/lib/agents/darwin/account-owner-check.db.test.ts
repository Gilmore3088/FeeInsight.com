// @vitest-environment node
/**
 * The account-owner re-check in real PostgreSQL (production schema, loopback only, inst 608): a live
 * monthly fee filed under "Gold Checking" whose own line sits under "360 Checking" on its stored page
 * takes 360 Checking, and its live name, which opened on Gold Checking, opens on 360 Checking; price,
 * category and liveness unchanged. Gold Checking's own $3 fee, and a fee under a numbered feature line
 * ("24 Hour Account Access"), stay as they are. Switched off, nothing is written to any fee.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { ACCOUNT_OWNER_CHECK, ACCOUNT_OWNER_REFILED_EVENT, ACCOUNT_OWNER_REFILED_KIND, recheckAccountOwners } from "./account-owner-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 6080001;
const DOC = 6080101;
const FEATURE_DOC = 6080102;
const EVENT = "00000000-0000-4000-8000-000006080000";

const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);
const gofm = readFileSync(new URL("../knox/__fixtures__/gofm-personal-checking-608.txt", import.meta.url), "utf8");

const EIGHT = "$8.00 monthly service fee, may be avoided if meet certain criteria.* Full waiver of fee if maintain daily balance of $20,000+";
const THREE = "$3 monthly maintenance fee (may be avoided if maintain daily balance of $5,000+)";
const FEATURE = "$6.00 monthly service fee if balance falls below $500";
const featureText = ["Gold Checking", "Minimum opening deposit $50", "24 Hour Account Access", FEATURE].join("\n\n");

describe.skipIf(!connection)("account-owner re-check in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let runId = 0;
  let nextRaw = 6080200;
  const ids: Record<string, number> = {};
  const rawIds: Record<string, number> = {};

  async function seed(label: string, documentId: number, rawName: string, liveName: string, amount: number, line: string): Promise<void> {
    const rawId = nextRaw++;
    const note = `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=monthly_maintenance; excerpt="${line}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, extraction_note, product_name)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${rawName}, ${amount}, 'monthly', 'knox', ${note}, 'Gold Checking')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, 'monthly_maintenance', ${EVENT}, ${rawName}, ${amount}, 'monthly', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, 'monthly_maintenance', ${EVENT}, ${liveName}, ${amount}, 'monthly', 'agentic-run-608', 'https://owner.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
    rawIds[label] = rawId;
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${DOC}, ${FEATURE_DOC})`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  const live = async (label: string) => {
    const [row] = await raw`SELECT fp.fee_name, fp.amount, fp.canonical_fee_key, fp.rolled_back_at, fr.product_name
                              FROM published_fee_records fp
                              JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
                              JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
                             WHERE fp.fee_published_id = ${ids[label]}`;
    return { name: row.fee_name, amount: Number(row.amount), key: row.canonical_fee_key, down: row.rolled_back_at != null, product: row.product_name };
  };

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Account-owner DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Account Owner Test Bank', 'bank', 'fdic', 'AR')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://owner.test/personal/checking/', 'h1', NOW()),
                     (${FEATURE_DOC}, ${INST}, 'success', 'https://owner.test/gold/', 'h2', NOW())`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${DOC}, ${INST}, 'https://owner.test/personal/checking/', 'html', 'completed', ${gofm}, 't-608a', ${gofm.length}),
                     (${FEATURE_DOC}, ${INST}, 'https://owner.test/gold/', 'html', 'completed', ${featureText}, 't-608b', ${featureText.length})`;
    await seed("eight", DOC, "monthly service fee, may be avoided if meet certain criteria. Full waiver of fee if maintain daily balance of +", "Gold Checking Monthly service fee", 8, EIGHT);
    await seed("three", DOC, "monthly maintenance fee (may be avoided if maintain daily balance of +)", "Gold Checking Monthly maintenance fee", 3, THREE);
    await seed("feature", FEATURE_DOC, "monthly service fee if balance falls below", "Gold Checking Monthly service fee", 6, FEATURE);
    const [run] = await raw<{ id: number }[]>`INSERT INTO agent_runs (agent_name, run_kind, title, status) VALUES ('darwin', 'state_agent', 'Account owner fixture', 'running') RETURNING id`;
    runId = Number(run.id);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    if (runId) await raw`DELETE FROM agent_runs WHERE id = ${runId}`;
    await raw.end();
  });

  it("re-files only the fee its own page prints under 360 Checking, and only when switched on", async () => {
    const db = raw as unknown as Parameters<typeof recheckAccountOwners>[0];

    // Switched off: counts on the ledger, no fee written.
    const off = await recheckAccountOwners(db, { runId, dryRun: false, institutionId: INST });
    expect(off).toMatchObject({ live: false, checked: 3, outcomes: { refile: 1, same: 2 }, refiled: [] });
    expect(await live("eight")).toMatchObject({ name: "Gold Checking Monthly service fee", product: "Gold Checking" });
    const [report] = await raw`SELECT detail FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${ACCOUNT_OWNER_CHECK}`;
    expect(json(report.detail)).toMatchObject({ would_refile: 1, switch_live: false });

    // A dry run writes nothing either, even switched on.
    const dry = await recheckAccountOwners(db, { runId, dryRun: true, institutionId: INST, live: true });
    expect(dry.refiled).toEqual([]);
    expect(await live("eight")).toMatchObject({ product: "Gold Checking" });

    // Switched on: the $8 fee alone takes 360 Checking; price, category and liveness unchanged.
    const on = await recheckAccountOwners(db, { runId, dryRun: false, institutionId: INST, live: true });
    expect(on.refiled).toEqual([ids.eight]);
    expect(await live("eight")).toEqual({ name: "360 Checking Monthly service fee", amount: 8, key: "monthly_maintenance", down: false, product: "360 Checking" });
    expect(await live("three")).toMatchObject({ name: "Gold Checking Monthly maintenance fee", amount: 3, product: "Gold Checking", down: false });
    expect(await live("feature")).toMatchObject({ name: "Gold Checking Monthly service fee", product: "Gold Checking", down: false });
    const [feedback] = await raw`SELECT kind, check_name, evidence, fee_raw_id FROM pipeline_feedback WHERE fee_published_id = ${ids.eight}`;
    expect(feedback).toMatchObject({ kind: ACCOUNT_OWNER_REFILED_KIND, check_name: ACCOUNT_OWNER_CHECK });
    expect(Number(feedback.fee_raw_id)).toBe(rawIds.eight);
    expect(json(feedback.evidence)).toMatchObject({ from: "Gold Checking", to: "360 Checking", fee_name: { from: "Gold Checking Monthly service fee", to: "360 Checking Monthly service fee" } });
    const [refiled] = await raw`SELECT count(*)::int AS n FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${ACCOUNT_OWNER_REFILED_EVENT}`;
    expect(refiled.n).toBe(1);

    // A second pass re-files nothing.
    const again = await recheckAccountOwners(db, { runId, dryRun: false, institutionId: INST, live: true });
    expect(again.refiled).toEqual([]);
    expect(again.outcomes.refile ?? 0).toBe(0);
  });
});
