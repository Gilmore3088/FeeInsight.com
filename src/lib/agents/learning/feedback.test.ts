import { describe, expect, it, vi } from "vitest";

import { knoxStrategyFromFlags, recordFeedback, takedownCheck, takedownKind } from "./feedback";
import { syncPipelineFeedback, takedownFeedback } from "./feedback-sync";

type Db = Parameters<typeof syncPipelineFeedback>[0];

function mockDb(answers: Array<[string, unknown[]]>) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    const match = answers.find(([needle]) => query.includes(needle));
    return Promise.resolve(match ? match[1] : []);
  });
  return { db: db as unknown as Db, calls };
}

const takedown = {
  fee_published_id: 77,
  fee_verified_id: 66,
  fee_raw_id: 55,
  institution_id: 9,
  source_document_id: 4,
  source_url: "https://bank.example/fees.pdf",
  source: "knox",
  outlier_flags: ["needs_darwin_verification", "knox_specialist:extract.table"],
  canonical_fee_key: "wire_domestic_outgoing",
  fee_name: "Domestic outgoing wire",
  amount: "20.00",
  rolled_back_reason: "rules_recheck_unreproduced",
  verify_attempt_id: 1234,
  verify_version: 3,
};

describe("shared learning store", () => {
  it("names the Knox strategy behind a raw row", () => {
    expect(knoxStrategyFromFlags(["knox_paid_extraction", "knox_specialist:extract.table"])).toBe("extract.paid");
    expect(knoxStrategyFromFlags(["knox_specialist:extract.family.wire"])).toBe("extract.family.wire");
    expect(knoxStrategyFromFlags(["needs_darwin_verification"])).toBe("extract.rules");
    expect(knoxStrategyFromFlags(null)).toBe("extract.rules");
  });

  it("maps every Hamilton takedown reason to a kind and a check", () => {
    expect(takedownKind("rules_recheck_unreproduced")).toBe("unreproduced");
    expect(takedownKind("source_check_untraceable:amount_is_a_threshold")).toBe("threshold");
    expect(takedownKind("source_check_untraceable:amount_not_the_fee")).toBe("wrong_amount");
    expect(takedownKind("source_check_untraceable:name_not_in_text")).toBe("not_on_schedule");
    expect(takedownKind("category_guard")).toBe("wrong_category");
    expect(takedownKind("amount_outside_category_range")).toBe("outside_range");
    expect(takedownKind("category_outside_taxonomy")).toBe("off_taxonomy");
    expect(takedownKind("duplicate of #15244")).toBe("duplicate");
    expect(takedownCheck("superseded by #17183")).toBe("hamilton.duplicate_collapse");
    expect(takedownCheck("source_check_untraceable:name_not_in_text")).toBe("hamilton.source_check");
  });

  it("charges a takedown to Knox's read and to the Darwin attempt that approved it", () => {
    const [extract, verify] = takedownFeedback(takedown, 501);
    expect(extract).toMatchObject({
      aboutStage: "extract",
      aboutStrategy: "extract.table",
      signal: "wrong",
      kind: "unreproduced",
      reportedBy: "hamilton",
      checkName: "hamilton.rules_recheck",
      feePublishedId: 77,
      amount: 20,
      dedupeKey: "hamilton.takedown:pub:77:extract",
    });
    expect(verify).toMatchObject({
      aboutStage: "verify",
      aboutStrategy: "verify.rules",
      aboutVersion: 3,
      aboutAttemptId: 1234,
      dedupeKey: "hamilton.takedown:pub:77:verify",
    });
  });

  it("upserts on the dedupe key", async () => {
    const { db, calls } = mockDb([["INSERT INTO pipeline_feedback", [{ id: 1 }]]]);
    const written = await recordFeedback(db, takedownFeedback(takedown, 1));
    expect(written).toBe(1);
    expect(calls[0].query).toContain("ON CONFLICT (dedupe_key) DO UPDATE");
    const payload = JSON.parse(String(calls[0].values[0]));
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ about_stage: "extract", dedupe_key: "hamilton.takedown:pub:77:extract", weight: 1 });
  });

  it("does nothing before the migration is applied", async () => {
    const { db, calls } = mockDb([["to_regclass('public.pipeline_feedback')", [{ ready: false }]]]);
    const result = await syncPipelineFeedback(db, { runId: 1 });
    expect(result.ready).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("fills the store from takedowns, restores, Darwin category rejects and answer keys", async () => {
    const { db, calls } = mockDb([
      ["to_regclass('public.pipeline_feedback')", [{ ready: true }]],
      ["FROM published_fee_records fp", [takedown]],
      ["hamilton.restore:pub:", [{ fee_published_id: 70, about_strategy: "extract.rules", institution_id: 9, source_document_id: 4, fee_raw_id: 50, fee_verified_id: 60, canonical_fee_key: "nsf", amount: "30" }]],
      ["category_mismatch", [{ id: 900, institution_id: 9, source_document_id: 4, strategy_version: 3, fee_raw_id: 51, canonical_fee_key: "nsf", amount: "20", reason: "Fee name does not support its category", category_guard_version: "9", fee_name: "Returned mail", outlier_flags: [], source_url: null }]],
      ["FROM answer_key_fees", [{ id: 3, institution_id: 9, canonical_key: "stop_payment", amount: "30", amount_kind: "flat", source_line: "Stop payment $30", uncertain: false, document_url: null }]],
      ["INSERT INTO pipeline_feedback", [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]],
    ]);

    const result = await syncPipelineFeedback(db, { runId: 7 });

    expect(result).toEqual({ ready: true, takedowns: 1, restores: 1, categoryRejects: 1, answerKeyFees: 1, written: 5 });
    const insert = calls.find((call) => call.query.includes("INSERT INTO pipeline_feedback"));
    const rows = JSON.parse(String(insert?.values[0]));
    expect(rows.map((row: { dedupe_key: string }) => row.dedupe_key)).toEqual([
      "hamilton.takedown:pub:77:extract",
      "hamilton.takedown:pub:77:verify",
      "hamilton.restore:pub:70",
      "darwin.verify:raw:51",
      "answer_key:fee:3",
    ]);
    expect(rows[3]).toMatchObject({ signal: "wrong", kind: "wrong_category", reported_by: "darwin", check_name: "darwin.category_guard" });
    expect(rows[3].evidence).toMatchObject({ verify_attempt_id: 900, fee_name: "Returned mail" });
    expect(rows[4]).toMatchObject({ signal: "right", kind: "answer_key", reported_by: "human" });
  });

  it("only reads in a dry run", async () => {
    const { db, calls } = mockDb([
      ["to_regclass('public.pipeline_feedback')", [{ ready: true }]],
      ["FROM published_fee_records fp", [takedown]],
    ]);
    const result = await syncPipelineFeedback(db, { runId: 7, dryRun: true });
    expect(result.takedowns).toBe(1);
    expect(result.written).toBe(0);
    expect(calls.some((call) => call.query.includes("INSERT"))).toBe(false);
  });
});
