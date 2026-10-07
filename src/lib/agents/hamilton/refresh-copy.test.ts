import { describe, expect, it, vi } from "vitest";

import {
  REFRESH_COPY_REASON_PREFIX,
  planRefreshes,
  refreshCopyFingerprint,
  refreshFeesFromCurrentCopy,
  type RefreshCopyCandidate,
} from "./refresh-copy";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function candidate(extra: Partial<RefreshCopyCandidate> = {}): RefreshCopyCandidate {
  return {
    fee_verified_id: 9801,
    fee_raw_id: 9701,
    institution_id: 42,
    source_url: "https://testbank.example/fees",
    document_r2_key: null,
    extraction_confidence: "0.9200",
    canonical_fee_key: "overdraft",
    variant_type: null,
    outlier_flags: ["agentic_darwin_verified"],
    verified_by_agent_event_id: "00000000-0000-4000-8000-000000009801",
    fee_name: "Overdraft Fee",
    amount: "35.00",
    frequency: "per_item",
    raw_agent_event_id: "00000000-0000-4000-8000-000000009701",
    source_document_id: 900,
    prior_fee_published_id: 501,
    prior_fee_name: "Overdraft fee",
    prior_amount: "35.00",
    prior_source_document_id: 500,
    ...extra,
  };
}

function createDb(rows: RefreshCopyCandidate[]): DbMock {
  let nextId = 7001;
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("WITH stale AS MATERIALIZED")) return Promise.resolve(rows);
    if (text.includes("INSERT INTO published_fee_records")) return Promise.resolve([{ fee_published_id: nextId++ }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 501 }]);
    return Promise.resolve([]);
  });
}

function asDb(db: DbMock): Parameters<typeof refreshFeesFromCurrentCopy>[0] {
  return db as unknown as Parameters<typeof refreshFeesFromCurrentCopy>[0];
}

function writes(db: DbMock): string[] {
  return db.mock.calls.map((call) => templateText(call[0])).filter((text) => /INSERT INTO|UPDATE /.test(text));
}

describe("planRefreshes", () => {
  it("moves a live fee the current copy states under the same name and amount", () => {
    const plan = planRefreshes([candidate()]);
    expect(plan.refresh).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves a fee whose current-copy row has another name (a separate line)", () => {
    const plan = planRefreshes([candidate({ fee_name: "Overdraft Fee - Business" })]);
    expect(plan.refresh).toEqual([]);
    expect(plan.skipped[0].reason).toBe("name_differs");
  });

  it("never treats a rate and a dollar amount as the same value", () => {
    const plan = planRefreshes([
      candidate({
        canonical_fee_key: "card_foreign_txn",
        fee_name: "Foreign Transaction Fee",
        prior_fee_name: "Foreign Transaction Fee",
        amount: null,
        amount_kind: "percent",
        rate_percent: "1",
        prior_amount: "1.00",
      }),
    ]);
    expect(plan.skipped[0].reason).toBe("value_differs");
  });

  it("applies today's publish rules to the current-copy row", () => {
    const plan = planRefreshes([candidate({ extraction_confidence: "0.5" })]);
    expect(plan.skipped[0]).toMatchObject({ reason: "publish_rule", detail: "Below publish confidence threshold" });
  });

  it("uses each live fee and each current-copy row once", () => {
    const plan = planRefreshes([
      candidate(),
      candidate({ fee_verified_id: 9802 }),
      candidate({ prior_fee_published_id: 502 }),
    ]);
    expect(plan.refresh.map((row) => [row.prior_fee_published_id, row.fee_verified_id])).toEqual([[501, 9801]]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(["pair_taken", "pair_taken"]);
  });
});

describe("refreshFeesFromCurrentCopy", () => {
  it("publishes the current copy's row and closes the old one as refreshed, with no price change", async () => {
    const db = createDb([candidate()]);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: false });
    expect(result).toMatchObject({ checked: 1, refreshed: 1 });
    expect(result.samples[0]).toMatchObject({ priorFeePublishedId: 501, feePublishedId: 7001 });
    const statements = writes(db);
    expect(statements.some((text) => text.includes("INSERT INTO published_fee_records"))).toBe(true);
    expect(statements.some((text) => text.includes("UPDATE published_fee_records"))).toBe(true);
    expect(statements.some((text) => text.includes("fee_change_records"))).toBe(false);
    const closeCall = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"));
    expect(closeCall).toContain(`${REFRESH_COPY_REASON_PREFIX}7001`);
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toContain(refreshCopyFingerprint(501, 9801));
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb([candidate()]);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: true });
    expect(result).toMatchObject({ checked: 1, refreshed: 1 });
    expect(writes(db)).toEqual([]);
  });

  it("records skipped pairs so they are not checked again, and changes no fee", async () => {
    const db = createDb([candidate({ fee_name: "Overdraft Fee - Business" })]);
    const result = await refreshFeesFromCurrentCopy(asDb(db), { runId: 9, batchId: "agentic-run-9", dryRun: false });
    expect(result).toMatchObject({ checked: 1, refreshed: 0, skipped: { name_differs: 1 } });
    const statements = writes(db);
    expect(statements.some((text) => text.includes("published_fee_records"))).toBe(false);
    expect(statements.some((text) => text.includes("INSERT INTO pipeline_attempts"))).toBe(true);
  });
});
