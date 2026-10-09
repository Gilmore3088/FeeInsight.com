import { describe, expect, it, vi } from "vitest";

import { DARWIN_RECHECK_STRATEGY, recheckVerifiedFees } from "./verified-recheck";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const TEXT = [
  "Bill Pay - FREE with E-Statements and Debit Card | $6.95 per Month",
  "Monthly fee for balance of $500 & over | FREE",
  "Overdraft fee $35.00",
].join("\n");

const verifiedRow = {
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  document_r2_key: null,
  extraction_confidence: "0.9",
  frequency: null,
  source_document_id: 55,
  amount_kind: null,
  rate_percent: null,
};

function dbWith(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("FROM verified_fee_observations v")) return Promise.resolve(rows);
    if (text.includes("FROM agent_source_texts")) return Promise.resolve([{ source_document_id: 55, normalized_text: TEXT }]);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 7001 }]);
    return Promise.resolve([]);
  }) as DbMock;
  return db;
}

describe("Darwin verified re-check", () => {
  it("rejects an unpublished conditional $0 row, archives a live one in the same step, passes a good row", async () => {
    const db = dbWith([
      { ...verifiedRow, fee_verified_id: 120552, fee_raw_id: 217716, canonical_fee_key: "bill_pay", verified_amount: "0.00", fee_name: "Bill Pay", amount: "0.00", outlier_flags: ["knox_review:zero"], conditions: "excerpt=\"Bill Pay - FREE\"", fee_published_id: 7001 },
      { ...verifiedRow, fee_verified_id: 120907, fee_raw_id: 233082, canonical_fee_key: "monthly_maintenance", verified_amount: "0.00", fee_name: "Monthly fee for balance of & over", amount: "0.00", outlier_flags: ["knox_review:zero"], conditions: null, fee_published_id: null },
      { ...verifiedRow, fee_verified_id: 120920, fee_raw_id: 251150, canonical_fee_key: "estatement_fee", verified_amount: "0.00", fee_name: "Includes: Bill Pay E-Statement Mobile Access", amount: "0.00", outlier_flags: ["knox_review:zero"], conditions: null, fee_published_id: null },
      { ...verifiedRow, fee_verified_id: 120999, fee_raw_id: 251135, canonical_fee_key: "overdraft", verified_amount: "35.00", fee_name: "Overdraft fee", amount: "35.00", outlier_flags: [], conditions: null, fee_published_id: 7002 },
    ]);

    const result = await recheckVerifiedFees(db as never, { runId: 500, stepId: 9 });

    expect(result.checked).toBe(4);
    expect(result.passed).toBe(1);
    expect(result.rejected).toEqual([
      { feeVerifiedId: 120907, code: "conditional_zero" },
      { feeVerifiedId: 120920, code: "retired_category" },
    ]);
    // The live row is archived now (James: no 12-hour wait), with the reason on the record.
    expect(result.takenDown).toEqual([7001]);
    const sqlText = db.mock.calls.map((call) => templateText(call[0]));
    const rollback = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"));
    expect(rollback?.slice(1)).toEqual(expect.arrayContaining(["darwin-recheck-500", [7001], ["darwin_recheck:conditional_zero"]]));
    expect(sqlText.filter((text) => text.includes("rolled_back_at IS NULL"))).toHaveLength(2);
    const rejects = db.mock.calls.filter((call) => templateText(call[0]).includes("UPDATE verified_fee_observations"));
    expect(rejects).toHaveLength(3);
    expect(rejects[0].slice(1)).toContain(JSON.stringify(["darwin_recheck:conditional_zero"]));
    const attempts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempts).toHaveLength(4);
    expect(attempts[0].slice(1)).toEqual(expect.arrayContaining([DARWIN_RECHECK_STRATEGY.strategy, "verified:120552", "evidence_mismatch"]));
  });

  it("does nothing when every verified row has been re-checked under this version", async () => {
    const db = dbWith([]);
    const result = await recheckVerifiedFees(db as never, { runId: 501 });
    expect(result).toMatchObject({ checked: 0, passed: 0, takenDown: [] });
  });
});
