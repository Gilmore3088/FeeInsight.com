/**
 * H03-T09 (#978) in real PostgreSQL: the production schema plus migration 20270110000054,
 * loopback only. Saved outputs record the published fee rows they used; a later correction or
 * hold finds every output that used the changed row (also one that used the bank only as a peer),
 * skips one about the same bank that used other rows, and leaves the saved figures untouched.
 * An output saved before rows were recorded keeps the institution match.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { resetCorrectionsReadyCache } from "@/lib/fee-correction-guard";
import { holdPublishedFee } from "@/lib/fee-hold";
import { collectFeeRefs, savedOutputNotice } from "@/lib/saved-output-corrections";
import { getSavedOutputChanges, listFeeAuditEntries } from "./fee-correction-audit";
import { readSavedOutputFeeRefs, recordSavedOutputFeeRefs, resetFeeRefsReadyCache } from "./saved-output-fee-refs";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof recordSavedOutputFeeRefs>[0];

const SUBJECT = 979001;
const PEER = 979002;
const OTHER = 979003;
const DOC = 979101;
const EVENT = "00000000-0000-4000-8000-000000979000";
const USER = "979";

describe.skipIf(!connection)("saved output fee rows in isolated PostgreSQL", () => {
  let raw: ReturnType<typeof postgres>;
  let db: Db;
  let nextRaw = 979200;
  const fee: Record<string, number> = {};
  const savedAt = new Date(Date.now() - 60_000).toISOString();

  async function seedFee(institutionId: number, name: string, key: string, amount: number): Promise<number> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
              VALUES (${rawId}, ${institutionId}, ${DOC}, ${EVENT}, ${name}, ${amount}, 'per_item', 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${institutionId}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${institutionId}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'agentic-run-979', 'https://bank.test/fees') RETURNING fee_published_id`;
    return Number(published.fee_published_id);
  }

  async function saveAnalysis(institutionId: number, response: unknown): Promise<string> {
    const [row] = await raw`
      INSERT INTO hamilton_saved_analyses (user_id, institution_id, title, analysis_focus, prompt, response_json, status, created_at, updated_at)
      VALUES (${USER}, ${String(institutionId)}, 'Stop payment', 'pricing', 'How does our stop payment fee compare?',
              ${JSON.stringify(response)}::jsonb, 'active', ${savedAt}::timestamptz, ${savedAt}::timestamptz)
      RETURNING id::text AS id`;
    return String(row.id);
  }

  async function responseOf(id: string): Promise<string> {
    const [row] = await raw`SELECT response_json::text AS body FROM hamilton_saved_analyses WHERE id = ${id}::uuid`;
    return String(row.body);
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Saved output DB tests require a loopback E2E database; production connections are forbidden");
    }
    const types = { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL };
    raw = postgres(connection, { max: 1, ssl: "require", types });
    db = raw as unknown as Db;
    resetCorrectionsReadyCache();
    resetFeeRefsReadyCache();
    const ids = [SUBJECT, PEER, OTHER];
    await raw`DELETE FROM hamilton_saved_output_fee_refs WHERE output_id IN (SELECT id::text FROM hamilton_saved_analyses WHERE user_id = ${USER})`;
    await raw`DELETE FROM hamilton_saved_output_fee_refs WHERE output_id IN (SELECT id::text FROM hamilton_reports WHERE user_id = ${USER})`;
    await raw`DELETE FROM hamilton_saved_analyses WHERE user_id = ${USER}`;
    await raw`DELETE FROM hamilton_reports WHERE user_id = ${USER}`;
    await raw`DELETE FROM published_fee_corrections WHERE institution_id = ANY(${ids}::bigint[])`;
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ANY(${ids}::int[])`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ANY(${ids}::int[])`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ANY(${ids}::int[])`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ANY(${ids}::int[])`;
    await raw`DELETE FROM source_documents WHERE id = ${DOC}`;
    await raw`DELETE FROM institution_sources WHERE id = ANY(${ids}::int[])`;
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${SUBJECT}, 'T09 Subject Bank', 'bank', 'fdic', 'TX'),
                     (${PEER}, 'T09 Peer Bank', 'bank', 'fdic', 'TX'),
                     (${OTHER}, 'T09 Other Bank', 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${SUBJECT}, 'success', 'https://bank.test/fees', 'hash-t09', '2026-09-01T00:00:00Z')`;
    fee.subjectStop = await seedFee(SUBJECT, "Stop Payment Fee", "stop_payment", 25);
    fee.subjectOverdraft = await seedFee(SUBJECT, "Overdraft Fee", "overdraft", 30);
    fee.subjectStopCorrected = await seedFee(SUBJECT, "Stop Payment Fee", "stop_payment", 35);
    fee.peerStop = await seedFee(PEER, "Stop Payment Fee", "stop_payment", 30);
  });

  afterAll(async () => {
    if (raw) await raw.end();
  });

  it("should_record_and_read_back_the_fee_rows_and_source_versions_an_output_used", async () => {
    const id = await saveAnalysis(SUBJECT, { title: "x" });
    const refs = collectFeeRefs({
      institutionId: SUBJECT,
      ownRows: [{ id: fee.subjectStop, sourceDocumentId: DOC, sourceContentHash: "hash-t09" }],
      peers: [{ institutionId: PEER, feePublishedIds: [fee.peerStop], sourceDocumentIds: [] }],
    });
    expect(await recordSavedOutputFeeRefs(db, "analysis", id, refs)).toBe(true);
    expect(await readSavedOutputFeeRefs(db, "analysis", id)).toEqual([
      { feePublishedId: fee.subjectStop, institutionId: SUBJECT, sourceDocumentId: DOC, sourceContentHash: "hash-t09" },
      { feePublishedId: fee.peerStop, institutionId: null, sourceDocumentId: null, sourceContentHash: null },
    ]);
    // No rows found: nothing is recorded, so the output keeps the institution match.
    expect(await recordSavedOutputFeeRefs(db, "analysis", await saveAnalysis(SUBJECT, {}), [])).toBe(false);
  });

  it("should_reject_an_unknown_output_kind_and_an_empty_fee_list_in_the_table_itself", async () => {
    await expect(raw`INSERT INTO hamilton_saved_output_fee_refs (output_kind, output_id, fee_published_ids) VALUES ('scenario', 'x', ARRAY[1]::bigint[])`).rejects.toThrow(/kind_check/);
    await expect(raw`INSERT INTO hamilton_saved_output_fee_refs (output_kind, output_id, fee_published_ids) VALUES ('analysis', 'y', ARRAY[]::bigint[])`).rejects.toThrow(/ids_check/);
  });

  it("should_find_an_answer_that_used_the_held_fee_as_a_peer_and_leave_its_figures_unchanged", async () => {
    const peerAnswer = { title: "Other Bank against peers", peers: [{ institutionId: PEER, amount: 30, feePublishedIds: [fee.peerStop] }] };
    const asPeer = await saveAnalysis(OTHER, peerAnswer);
    await recordSavedOutputFeeRefs(db, "analysis", asPeer, collectFeeRefs(peerAnswer));
    const before = await responseOf(asPeer);

    const hold = await holdPublishedFee(db as never, fee.peerStop, "Wrong amount on the line", { id: 2, name: "Ana" });
    expect(hold).toMatchObject({ ok: true });

    const { basis, changes } = await getSavedOutputChanges(db, { kind: "analysis", id: asPeer, institutionId: OTHER, savedAt });
    expect(basis).toBe("fees");
    expect(changes.map((c) => c.kind)).toEqual(["hold"]);
    expect(savedOutputNotice(changes, savedAt, "answer", basis)?.text).toMatch(/^Fee data this answer used changed after this answer was saved: 1 fee taken out for review on /);
    // The institution match would have missed it: Other Bank's own fees never changed.
    expect((await getSavedOutputChanges(db, { kind: "analysis", id: "no-record", institutionId: OTHER, savedAt })).changes).toEqual([]);
    expect(await responseOf(asPeer)).toBe(before);
  });

  it("should_find_outputs_that_used_a_corrected_row_and_skip_one_about_the_same_bank_that_did_not", async () => {
    const usedStop = await saveAnalysis(SUBJECT, { ownRows: [] });
    await recordSavedOutputFeeRefs(db, "analysis", usedStop, collectFeeRefs({ institutionId: SUBJECT, ownRows: [{ id: fee.subjectStop }] }));
    const usedOverdraft = await saveAnalysis(SUBJECT, { ownRows: [] });
    await recordSavedOutputFeeRefs(db, "analysis", usedOverdraft, collectFeeRefs({ institutionId: SUBJECT, ownRows: [{ id: fee.subjectOverdraft }] }));
    const legacy = await saveAnalysis(SUBJECT, { title: "saved before fee rows were recorded" });
    const [report] = await raw`
      INSERT INTO hamilton_reports (user_id, institution_id, report_type, report_json, created_at)
      VALUES (${USER}, ${String(SUBJECT)}, 'peer_competitive', '{"title":"r"}'::jsonb, ${savedAt}::timestamptz) RETURNING id::text AS id`;
    await recordSavedOutputFeeRefs(db, "report", String(report.id), [{ feePublishedId: fee.subjectStop, institutionId: SUBJECT, sourceDocumentId: null, sourceContentHash: null }]);

    await raw`
      INSERT INTO published_fee_corrections (fee_chain_id, version, action, institution_id, previous_fee_published_id, fee_published_id,
        before_canonical_fee_key, before_fee_name, before_amount, canonical_fee_key, fee_name, amount, source_document_id, source_excerpt, source_location, reason, actor_user_id, actor_name, idempotency_key)
      VALUES (${fee.subjectStop}, 1, 'correct', ${SUBJECT}, ${fee.subjectStop}, ${fee.subjectStopCorrected},
        'stop_payment', 'Stop Payment Fee', 25, 'stop_payment', 'Stop Payment Fee', 35, ${DOC}, 'Stop Payment Fee | $35.00', 'Page 1, row 2', 'Read from the row above', 1, 'James', 't09-db-correct-1')`;

    const notice = async (kind: "analysis" | "report", id: string) => {
      const { basis, changes } = await getSavedOutputChanges(db, { kind, id, institutionId: SUBJECT, savedAt });
      return savedOutputNotice(changes, savedAt, kind === "report" ? "report" : "answer", basis)?.text ?? null;
    };
    expect(await notice("analysis", usedStop)).toMatch(/^Fee data this answer used changed after this answer was saved: 1 fee corrected on /);
    expect(await notice("analysis", usedOverdraft)).toBeNull();
    expect(await notice("analysis", legacy)).toMatch(/^This institution's fee data changed after this answer was saved: 1 fee corrected/);
    expect(await notice("report", String(report.id))).toMatch(/^Fee data this report used changed after this report was saved: 1 fee corrected/);

    const entry = (await listFeeAuditEntries(db, { institutionId: SUBJECT })).find((e) => e.action === "correct");
    // Recorded with the corrected row: the first test's answer and usedStop. No record, about the
    // bank: the first test's empty one and legacy. usedOverdraft is not counted. Then the report.
    expect(entry?.savedOutputs).toMatchObject({ analyses: 4, reports: 1 });
  });
});
