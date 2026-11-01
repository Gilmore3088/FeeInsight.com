/**
 * The own-unit re-check in real PostgreSQL (production schema, loopback only, #2248): a live photocopy
 * fee stored per_item whose own line and document print "$0.25 per page" takes per_page, its price
 * unchanged and nothing taken down; Hamilton's frequency fill does not promote it on its own, and
 * after the re-check reads it again and writes nothing back. A statement copy whose document now
 * prices it per statement, and a notary fee whose document has no text, stay as they are.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { fillBlankFrequencies } from "@/lib/agents/hamilton/frequency-fill";
import { OWN_UNIT_CHECK, OWN_UNIT_REFILED_EVENT, OWN_UNIT_REFILED_KIND, recheckOwnUnits } from "./own-unit-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 2248001;
const DOC = 2248101;
const BARE = 2248102;
const EVENT = "00000000-0000-4000-8000-000002248000";

const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);

const PHOTOCOPY = "Photocopies | $0.25 per page";
const STATEMENT = "Statement copy | $5.00/page";
const NOTARY = "Notary Service (non-customers) $5.00 | Per document";

describe.skipIf(!connection)("own-unit re-check in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let runId = 0;
  let nextRaw = 2248200;
  const ids: Record<string, number> = {};
  const verifiedIds: Record<string, number> = {};

  async function seed(label: string, documentId: number, key: string, name: string, amount: number, line: string): Promise<void> {
    const rawId = nextRaw++;
    const note = `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=${key}; excerpt="${line}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, extraction_note)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${name}, ${amount}, 'per_item', 'knox', ${note})`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'agentic-run-2248', 'https://unit.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
    verifiedIds[label] = Number(verified.fee_verified_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${DOC}, ${BARE})`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  const live = async (label: string) => {
    const [row] = await raw`SELECT fp.frequency, fp.amount, fp.rolled_back_at, fv.frequency AS verified_frequency
                              FROM published_fee_records fp JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
                             WHERE fp.fee_published_id = ${ids[label]}`;
    return { frequency: row.frequency, amount: Number(row.amount), down: row.rolled_back_at != null, verified: row.verified_frequency };
  };

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Own-unit DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Own Unit Test FCU', 'credit_union', 'ncua', 'PA')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://unit.test/fees.pdf', 'h1', NOW()),
                     (${BARE}, ${INST}, 'success', 'https://unit.test/notary.pdf', 'h2', NOW())`;
    // The bank's current schedule prices the statement copy per statement, not per page.
    const body = `Other Services\n${PHOTOCOPY}\nStatement copy | $5.00/statement\nStop Payment | $30.00`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
              VALUES (${DOC}, ${INST}, 'https://unit.test/fees.pdf', 'pdf', 'completed', ${body}, 't-2248a', ${body.length})`;
    await seed("photocopy", DOC, "document_reproduction", "Photocopies", 0.25, PHOTOCOPY);
    await seed("statement", DOC, "document_reproduction", "Statement copy", 5, STATEMENT);
    await seed("notary", BARE, "notary_fee", "Notary Service (non-customers)", 5, NOTARY);
    const [run] = await raw<{ id: number }[]>`INSERT INTO agent_runs (agent_name, run_kind, title, status) VALUES ('darwin', 'state_agent', 'Own unit fixture', 'running') RETURNING id`;
    runId = Number(run.id);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    if (runId) await raw`DELETE FROM agent_runs WHERE id = ${runId}`;
    await raw.end();
  });

  it("re-files only the fee its own line and document price per page, and the fill keeps it", async () => {
    const db = raw as unknown as Parameters<typeof recheckOwnUnits>[0];
    // Before: Hamilton's fill keeps a stored per_item as it is, so nothing else would promote it.
    await fillBlankFrequencies(db, { runId, dryRun: false, institutionId: INST });
    expect(await live("photocopy")).toMatchObject({ frequency: "per_item", verified: "per_item" });

    // Switched off: counts on the ledger, no fee written.
    const off = await recheckOwnUnits(db, { runId, dryRun: false, institutionId: INST });
    expect(off).toMatchObject({ live: false, checked: 3, outcomes: { refile: 1, unit_conflict: 1, no_text: 1 }, refiled: [] });
    expect(await live("photocopy")).toMatchObject({ frequency: "per_item" });
    const [report] = await raw`SELECT detail FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${OWN_UNIT_CHECK}`;
    expect(json(report.detail)).toMatchObject({ would_refile: 1, switch_live: false, refile_by_category: { document_reproduction: 1 } });

    // Switched on: the photocopy fee alone takes per_page, price unchanged and still live.
    const on = await recheckOwnUnits(db, { runId, dryRun: false, institutionId: INST, live: true });
    expect(on.refiled).toEqual([ids.photocopy]);
    expect(await live("photocopy")).toEqual({ frequency: "per_page", amount: 0.25, down: false, verified: "per_page" });
    expect(await live("statement")).toMatchObject({ frequency: "per_item", down: false });
    expect(await live("notary")).toMatchObject({ frequency: "per_item", down: false });
    const [feedback] = await raw`SELECT kind, check_name, evidence FROM pipeline_feedback WHERE fee_published_id = ${ids.photocopy}`;
    expect(feedback).toMatchObject({ kind: OWN_UNIT_REFILED_KIND, check_name: OWN_UNIT_CHECK });
    expect(json(feedback.evidence)).toMatchObject({ from: "per_item", to: "per_page" });
    const [refiled] = await raw`SELECT count(*)::int AS n FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${OWN_UNIT_REFILED_EVENT}`;
    expect(refiled.n).toBe(1);

    // The next publish step's fill reads the shared line and writes nothing back; a second pass re-files nothing.
    const fill = await fillBlankFrequencies(db, { runId, dryRun: false, institutionId: INST });
    expect(fill.scanned).toBeGreaterThan(0);
    expect(fill.filled.map((fee) => fee.feePublishedId)).not.toContain(ids.photocopy);
    expect(await live("photocopy")).toMatchObject({ frequency: "per_page", verified: "per_page" });
    const again = await recheckOwnUnits(db, { runId, dryRun: false, institutionId: INST, live: true });
    expect(again.refiled).toEqual([]);
    expect(again.outcomes.refile ?? 0).toBe(0);
  });
});
