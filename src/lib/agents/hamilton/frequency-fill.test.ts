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

const row = (id: number, amount: string, excerpt: string) => ({
  fee_published_id: id,
  fee_verified_id: id + 1000,
  fee_raw_id: id + 2000,
  institution_id: 7,
  source_document_id: 9,
  canonical_fee_key: "check_image",
  amount,
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
    expect(sqlText).toContain("AND fp.frequency IS NULL");
    expect(sqlText).toContain("INSERT INTO pipeline_feedback");
  });

  it("writes nothing on a dry run", async () => {
    const db = createDbMock([row(1, "6.00", "Copy of Share Draft (Check) Faxed | $6.00 each")]);
    const result = await fillBlankFrequencies(asDb(db), { runId: 5, dryRun: true });
    expect(result.filled).toHaveLength(1);
    expect(db).not.toHaveBeenCalled();
  });
});
