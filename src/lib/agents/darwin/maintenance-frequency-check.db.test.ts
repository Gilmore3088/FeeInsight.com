/**
 * The maintenance frequency re-check in real PostgreSQL (production schema, loopback only, Oct 30):
 * live monthly maintenance fees stored per item, using real live lines. Switched off or in a dry run
 * nothing is written. Switched on, the "$16 each" fee comes down (verified row rejected, feedback with
 * its old frequency and review_status), "each calendar month" takes monthly, a line with no period goes
 * blank (each guarded on the old frequency), a monthly neighbour stays untouched, and a second pass
 * changes nothing.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import {
  MAINTENANCE_FREQUENCY_CHECK,
  MAINTENANCE_FREQUENCY_EVENT,
  MAINTENANCE_FREQUENCY_KIND,
  MAINTENANCE_PER_ITEM_FLAG,
  MAINTENANCE_PER_ITEM_REASON,
  recheckMaintenanceFrequencies,
} from "./maintenance-frequency-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 3030001;
const DOC = 3030101;
const EVENT = "00000000-0000-4000-8000-000003030000";

const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);

const EACH = "maintenance fee | • Non-Account owner | $16 each";
const MONTH = "Fees and charges: A service charge of $3.00 will be charged each calendar month.";
const NONE = "There is a $5.00 service charge if the balance goes below $2,500.00";
const NEIGHBOUR = "Monthly Service Fee | $10.00 per month";

describe.skipIf(!connection)("maintenance frequency re-check in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let runId = 0;
  let nextRaw = 3030200;
  const ids: Record<string, number> = {};
  const verifiedIds: Record<string, number> = {};

  async function seed(label: string, name: string, amount: number, frequency: string, line: string): Promise<void> {
    const rawId = nextRaw++;
    const note = `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=monthly_maintenance; excerpt="${line}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, extraction_note)
              VALUES (${rawId}, ${INST}, ${DOC}, ${EVENT}, ${name}, ${amount}, ${frequency}, 'knox', ${note})`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, 'monthly_maintenance', ${EVENT}, ${name}, ${amount}, ${frequency}, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, 'monthly_maintenance', ${EVENT}, ${name}, ${amount}, ${frequency}, 'agentic-run-3030', 'https://maint.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
    verifiedIds[label] = Number(verified.fee_verified_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  const live = async (label: string) => {
    const [row] = await raw`SELECT fp.frequency, fp.amount, fp.rolled_back_at, fp.rolled_back_reason, fv.frequency AS verified_frequency, fv.review_status, fv.outlier_flags
                              FROM published_fee_records fp JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
                             WHERE fp.fee_published_id = ${ids[label]}`;
    return {
      frequency: row.frequency, amount: Number(row.amount), down: row.rolled_back_at != null, reason: row.rolled_back_reason,
      verified: row.verified_frequency, status: row.review_status, flags: json(row.outlier_flags) ?? [],
    };
  };
  const snapshot = async () => Promise.all(["each", "month", "none", "neighbour"].map(live));

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Maintenance frequency DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Maintenance Test Bank', 'bank', 'fdic', 'PA')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://maint.test/fees.pdf', 'h1', NOW())`;
    await seed("each", "maintenance fee | Non-Account owner", 16, "per_item", EACH);
    await seed("month", "Fees and charges: A service charge", 3, "per_item", MONTH);
    await seed("none", "Service charge", 5, "per_item", NONE);
    await seed("neighbour", "Monthly Service Fee", 10, "monthly", NEIGHBOUR);
    const [run] = await raw<{ id: number }[]>`INSERT INTO agent_runs (agent_name, run_kind, title, status) VALUES ('darwin', 'state_agent', 'Maintenance frequency fixture', 'running') RETURNING id`;
    runId = Number(run.id);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    if (runId) await raw`DELETE FROM agent_runs WHERE id = ${runId}`;
    await raw.end();
  });

  it("writes nothing switched off or in a dry run", async () => {
    const db = raw as unknown as Parameters<typeof recheckMaintenanceFrequencies>[0];
    const before = await snapshot();
    const off = await recheckMaintenanceFrequencies(db, { runId, dryRun: false, institutionId: INST });
    expect(off).toMatchObject({ live: false, checked: 3, outcomes: { hold: 1, refile: 1, clear: 1 }, refileTo: { monthly: 1 }, changed: [], heldDown: [] });
    const dry = await recheckMaintenanceFrequencies(db, { runId, dryRun: true, institutionId: INST, live: true });
    expect(dry).toMatchObject({ live: true, dryRun: true, checked: 3, changed: [], heldDown: [] });
    expect(await snapshot()).toEqual(before);
    const [feedback] = await raw`SELECT count(*)::int AS n FROM pipeline_feedback WHERE institution_id = ${INST}`;
    expect(feedback.n).toBe(0);
    // Only the switched-off step leaves its report; the dry run writes nothing at all.
    const reports = await raw`SELECT detail FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${MAINTENANCE_FREQUENCY_CHECK}`;
    expect(reports).toHaveLength(1);
    expect(json(reports[0].detail)).toMatchObject({ switch_live: false, checked: 3, outcomes: { hold: 1, refile: 1, clear: 1 } });
  });

  it("switched on, takes the per-item line down, re-files the period and clears the default, then holds still", async () => {
    const db = raw as unknown as Parameters<typeof recheckMaintenanceFrequencies>[0];
    const on = await recheckMaintenanceFrequencies(db, { runId, dryRun: false, institutionId: INST, live: true });
    expect(on.heldDown).toEqual([ids.each]);
    expect([...on.changed].sort()).toEqual([ids.month, ids.none].sort());

    expect(await live("each")).toMatchObject({ down: true, reason: MAINTENANCE_PER_ITEM_REASON, frequency: "per_item", status: "rejected" });
    expect((await live("each")).flags).toContain(MAINTENANCE_PER_ITEM_FLAG);
    expect(await live("month")).toMatchObject({ down: false, frequency: "monthly", verified: "monthly", amount: 3, status: "verified" });
    expect(await live("none")).toMatchObject({ down: false, frequency: null, verified: null, amount: 5 });
    expect(await live("neighbour")).toMatchObject({ down: false, frequency: "monthly", verified: "monthly", status: "verified" });

    const feedback = await raw`SELECT fee_published_id, kind, check_name, evidence FROM pipeline_feedback WHERE institution_id = ${INST} ORDER BY fee_published_id`;
    expect(feedback).toHaveLength(3);
    const byId = new Map(feedback.map((row) => [Number(row.fee_published_id), { ...row, evidence: json(row.evidence) }]));
    expect(byId.get(ids.each)).toMatchObject({ kind: MAINTENANCE_FREQUENCY_KIND, check_name: MAINTENANCE_FREQUENCY_CHECK,
      evidence: { action: "hold", from: "per_item", to: null, verified_review_status_before: "verified" } });
    expect(byId.get(ids.month)?.evidence).toMatchObject({ action: "refile", from: "per_item", to: "monthly" });
    expect(byId.get(ids.none)?.evidence).toMatchObject({ action: "clear", from: "per_item", to: null });
    const [event] = await raw`SELECT count(*)::int AS n FROM agent_run_events WHERE agent_run_id = ${runId} AND event_type = ${MAINTENANCE_FREQUENCY_EVENT}`;
    expect(event.n).toBe(1);

    // A second pass finds nothing left to change.
    const before = await snapshot();
    const again = await recheckMaintenanceFrequencies(db, { runId, dryRun: false, institutionId: INST, live: true });
    expect(again).toMatchObject({ checked: 0, changed: [], heldDown: [] });
    expect(await snapshot()).toEqual(before);
  });

  it("leaves a verified row whose frequency no longer matches the live row's old value", async () => {
    const db = raw as unknown as Parameters<typeof recheckMaintenanceFrequencies>[0];
    await seed("raced", "Fees and charges: A service charge", 6, "per_item", MONTH.replace("$3.00", "$6.00"));
    // Another step moved the live row to per_transaction; its verified row still says per_item.
    await raw`UPDATE published_fee_records SET frequency = 'per_transaction' WHERE fee_published_id = ${ids.raced}`;
    const on = await recheckMaintenanceFrequencies(db, { runId, dryRun: false, institutionId: INST, live: true });
    expect(on.changed).toEqual([ids.raced]);
    // The live row moves from the value it holds now; the verified row, guarded on that value, is left.
    expect(await live("raced")).toMatchObject({ frequency: "monthly", verified: "per_item" });
  });
});
