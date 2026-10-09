import { describe, expect, it, vi } from "vitest";

import { excerptOf, fillBlankFrequencies } from "./frequency-fill";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("UPDATE published_fee_records")) {
      return Promise.resolve((values[0] as number[]).map((id) => ({ fee_published_id: id })));
    }
    return Promise.resolve([]);
  }) as unknown as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

function asDb(db: DbMock): Parameters<typeof fillBlankFrequencies>[0] {
  return db as unknown as Parameters<typeof fillBlankFrequencies>[0];
}

const row = (id: number, amount: string, excerpt: string, frequency: string | null = null) => ({
  fee_published_id: id,
  fee_verified_id: id + 1000,
  fee_raw_id: id + 2000,
  institution_id: 7,
  source_document_id: 9,
  canonical_fee_key: "check_image",
  amount,
  frequency,
  conditions: `Knox deterministic extraction from Rosetta artifact #1. excerpt="${excerpt}"`,
});

describe("Hamilton frequency fill", () => {
  it("reads the excerpt at the end of a row's conditions", () => {
    expect(excerptOf('canonical_hint=x; excerpt="Check Copy | $2.00 each"')).toBe("Check Copy | $2.00 each");
    expect(excerptOf("no excerpt")).toBeNull();
  });

  it("fills a blank frequency the line states and leaves the rest", async () => {
    const db = createDbMock([
      row(1, "6.00", "Copy of Share Draft (Check) Faxed | $6.00 each"),
      row(2, "30.00", "Checkbook Reconciliation (per hour) | $30.00"),
      row(3, "2.00", "Paper Statement | $2.00"),
    ]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.scanned).toBe(3);
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.frequency])).toEqual([[1, "per_item"]]);
    const sqlText = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
    expect(sqlText).toContain("UPDATE published_fee_records");
    expect(sqlText).toContain("AND fp.frequency IS NOT DISTINCT FROM v.from_frequency");
    expect(sqlText).toContain("INSERT INTO pipeline_feedback");
  });

  it("corrects or clears a frequency read from another fee's row (v2)", async () => {
    const db = createDbMock([
      row(1, "5.00", "(Per month some exclusions apply) | Cashier’s Check (Per item) .......... $5.00", "monthly"),
      row(2, "20.00", "Missing/Bad Address - per year........ $10.00 | Reverse Stop Payment Request ........ $20.00", "annual"),
      row(3, "5.00", "Monthly Service Fees | Checking | $5.00", "monthly"),
    ]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.from, fee.frequency])).toEqual([
      [1, "monthly", "per_item"],
      [2, "annual", null],
    ]);
  });

  it("writes nothing on a dry run", async () => {
    const db = createDbMock([row(1, "6.00", "Copy of Share Draft (Check) Faxed | $6.00 each")]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
    expect(result.filled).toHaveLength(1);
    expect(db).not.toHaveBeenCalled();
  });

  it("fills a blank box rent from its table's annual header and logs the basis (v10)", async () => {
    const box = { ...row(4, "25.00", "3 x 5 x 21 | $25"), canonical_fee_key: "safe_deposit_box" };
    const plain = { ...row(5, "20.00", "3 x 5 | $20"), canonical_fee_key: "safe_deposit_box", source_document_id: 10 };
    const db = createDbMock([]);
    db.unsafe = vi.fn((sql: string) => {
      if (sql.includes("agent_source_texts")) {
        return Promise.resolve([
          { source_document_id: 9, normalized_text: "Box Size: | Annual Rental:\n3 x 5 x 21 | $25" },
          { source_document_id: 10, normalized_text: "Safe Deposit Boxes:\n3 x 5 | $20" },
        ]);
      }
      if (sql.includes("fp.fee_name ~*")) return Promise.resolve([box, plain]);
      return Promise.resolve([]);
    });
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: false });
    expect(result.filled.map((fee) => [fee.feePublishedId, fee.frequency, fee.basis])).toEqual([[4, "annual", "box_table_header"]]);
    const sqlText = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
    expect(sqlText).toContain("INSERT INTO pipeline_feedback");
  });
});
