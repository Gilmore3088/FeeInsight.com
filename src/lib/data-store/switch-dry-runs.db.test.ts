/**
 * The switch dry-run audit in real PostgreSQL (production schema, loopback only, #1092). Institution
 * X has a live consumer "Stop Payment" $35 on document A and a second current copy, B, that prints a
 * dash run and publishes nothing live; institution Y has no live fee and a dash run spaced with
 * no-break spaces. Both B and Y's document are candidates by institution; at 8a80f4c neither was read.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSwitchDryRuns, type SwitchDryRunReport } from "@/lib/agents/deming/switch-dry-runs/run";
import { DEFAULT_SWITCH_AUDIT_OPTIONS } from "@/lib/agents/deming/switch-dry-runs/types";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL, type sql } from "@/lib/data-store/connection";
import { createSwitchAuditReader, withReadOnlySwitchAudit } from "./switch-dry-runs";

const connection = process.env.E2E_DATABASE_URL;
const X = 1092001;
const Y = 1092002;
const DOC_A = 1092101;
const DOC_B = 1092102;
const DOC_C = 1092103;
const EVENT = "00000000-0000-4000-8000-000001092000";

const TEXT_A = "Fee Schedule\nStop Payment | $35.00\nPaid Overdraft Charge: $30.00/item ($150.00 max daily)";
const TEXT_B = ["Personal Fee Schedule", "Checking Fees", "$20.00 - Stop Payment", "$35.00 - Overdraft Fee"].join("\n");
const TEXT_C = ["Personal Fee Schedule", "Checking Fees", "$20.00 - Stop Payment", "$35.00 - Overdraft Fee"].join("\n");

describe.skipIf(!connection)("switch dry runs in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let report: SwitchDryRunReport;
  let nextRaw = 1092200;

  async function live(name: string, key: string, amount: number | null, extra: { audience?: string; percent?: number; down?: string } = {}): Promise<number> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source, extraction_note, line_share, fee_audience, audience_evidence)
              VALUES (${rawId}, ${X}, ${DOC_A}, ${EVENT}, ${name}, ${amount}, 'knox', 'Knox deterministic extraction.', ${String(rawId)}, ${extra.audience ?? "consumer"}, 'test audience')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status, fee_audience, audience_evidence)
              VALUES (${rawId}, ${X}, ${key}, ${EVENT}, ${name}, ${amount}, 'verified', ${extra.audience ?? "consumer"}, 'darwin:test') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount,
                amount_kind, rate_percent, fee_audience, batch_id, source_url, rolled_back_at, rolled_back_reason)
              VALUES (${verified.fee_verified_id}, ${X}, ${key}, ${EVENT}, ${name}, ${amount}, ${extra.percent != null ? "percent" : "flat"}, ${extra.percent ?? null},
                ${extra.audience ?? "consumer"}, 'agentic-run-1092', 'https://x.test/fees', ${extra.down ? new Date() : null}, ${extra.down ?? null})
              RETURNING fee_published_id`;
    return Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM published_fee_records WHERE institution_id IN (${X}, ${Y})`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id IN (${X}, ${Y})`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id IN (${X}, ${Y})`;
    await raw`DELETE FROM agent_source_texts WHERE source_document_id IN (${DOC_A}, ${DOC_B}, ${DOC_C})`;
    await raw`DELETE FROM source_documents WHERE institution_id IN (${X}, ${Y})`;
    await raw`DELETE FROM institution_sources WHERE id IN (${X}, ${Y})`;
  }

  const ids: Record<string, number> = {};

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Switch dry-run DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${X}, 'Switch Audit X FCU', 'credit_union', 'ncua', 'MN'), (${Y}, 'Switch Audit Y Bank', 'bank', 'fdic', 'MN')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC_A}, ${X}, 'success', 'https://x.test/fees', 'h1092a', NOW()),
                     (${DOC_B}, ${X}, 'success', 'https://x.test/personal-fees', 'h1092b', NOW()),
                     (${DOC_C}, ${Y}, 'success', 'https://y.test/personal-fees', 'h1092c', NOW())`;
    for (const [doc, inst, url, text] of [[DOC_A, X, "https://x.test/fees", TEXT_A], [DOC_B, X, "https://x.test/personal-fees", TEXT_B], [DOC_C, Y, "https://y.test/personal-fees", TEXT_C]] as const) {
      await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
                VALUES (${doc}, ${inst}, ${url}, 'html', 'completed', ${text}, ${`t-${doc}`}, ${text.length})`;
    }
    ids.stop = await live("Stop Payment", "stop_payment", 35);
    // A rate row of the same name: Hamilton's prior read takes it, and so does the audit now.
    ids.rate = await live("Stop Payment Rate", "stop_payment", null, { percent: 1 });
    // An excerpt-only limit takedown whose fee went live again.
    ids.down = await live("Zelle", "zelle_fee", 150, { down: "limit_as_fee:source_states_limit: the source states $150 as a limit" });
    // Republished under a tidied title: the same fee by Hamilton's normalizedFeeName.
    ids.again = await live("ZELLE:", "zelle_fee", 150);
    // A held daily cap Knox read on document A, with no published row.
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source, outlier_flags, extraction_note)
              VALUES (${nextRaw++}, ${X}, ${DOC_A}, ${EVENT}, 'Paid Overdraft Charge daily maximum', 150, 'knox', '["canonical_hint:od_daily_cap"]'::jsonb, 'Knox deterministic extraction.')`;
    const now = new Date();
    report = await withReadOnlySwitchAudit(
      raw as unknown as typeof sql,
      (reader) => runSwitchDryRuns(reader, { ...DEFAULT_SWITCH_AUDIT_OPTIONS, institutionIds: [X, Y], sampleCap: 50, accuracySample: 5 }, now),
      { now, institutionIds: [X, Y] },
    );
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end({ timeout: 5 });
  });

  it("should_read_dash_documents_by_institution_including_ones_with_no_live_fee", () => {
    const { summary } = report.dashListRows;
    // B (X, nothing live on it) and C (Y, no live fee at all) are read; A prints no dash run.
    expect(summary.documentsRead).toBe(2);
    expect(summary.documentsWithRuns).toBe(2);
    // Each adds its "Stop Payment" $20. B's sits beside X's live consumer $35; Y has nothing live.
    expect(summary.added).toBe(2);
    expect(summary.beside).toBe(1);
    expect(summary.besideSamples[0]).toMatchObject({ institutionId: X, sourceDocumentId: DOC_B, amountCents: 2000 });
    expect(summary.besideSamples[0].sameNamed.map((fee) => fee.feePublishedId)).toEqual([ids.stop]);
  });

  it("should_bound_the_scan_before_reading_any_text_and_page_on", async () => {
    // Candidates in order: X's A and B (X has live fees), then Y's C. A bound of 1 scans A alone,
    // which prints no dash run; the next batch from offset 1 scans B and C.
    const reader = createSwitchAuditReader(raw as unknown as typeof sql, { institutionIds: [X, Y] });
    const first = await reader.dashListDocuments(1, 0);
    expect(first).toEqual({ scanned: 1, documents: [] });
    const next = await reader.dashListDocuments(2, 1);
    expect(next.scanned).toBe(2);
    expect(next.documents.map((doc) => Number(doc.source_document_id))).toEqual([DOC_B, DOC_C]);
    expect(report.dashListRows.scan).toMatchObject({ offset: 0, scanned: 3, truncated: false });
  });

  it("should_hand_hamilton_every_live_fee_rates_included", async () => {
    const reader = createSwitchAuditReader(raw as unknown as typeof sql);
    const fees = await reader.liveFeesAt([X]);
    expect(fees.map((fee) => Number(fee.fee_published_id)).sort((a, b) => a - b)).toEqual([ids.stop, ids.rate, ids.again].sort((a, b) => a - b));
    expect(fees.find((fee) => Number(fee.fee_published_id) === ids.rate)).toMatchObject({ amount_kind: "percent", fee_audience: "consumer" });
  });

  it("should_leave_out_an_excerpt_takedown_whose_fee_is_live_again", () => {
    expect(report.excerptAtPublish.summary).toMatchObject({ takenDown: 0, republished: 1 });
  });

  it("should_count_a_held_cap_as_a_gain_line", () => {
    expect(report.dailyCapLines.summary).toMatchObject({ rows: 1, nowTraces: 1, gainLines: 1, alreadyLiveSamePriceLines: 0, priceChangeLines: 0 });
    expect(report.dailyCapLines.summary.byTier.unjudged.nowTraces).toBe(1);
  });
});
