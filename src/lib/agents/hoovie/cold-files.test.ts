import { describe, expect, it } from "vitest";

import { COLD_KEY_PREFIX, ColdFileWriter, coldObjectKey, createColdStore, decodeColdFile } from "./cold-files";

describe("cold files", () => {
  it("round-trips rows in batches, keeping numerics as text and dates as ISO strings", () => {
    const writer = new ColdFileWriter(["id", "value", "fetched_at", "note"]);
    writer.push([{ id: "1", value: "12345678901234.5678", fetched_at: new Date("2026-10-17T00:00:00Z"), note: null }]);
    writer.push([{ id: "2", value: "0", fetched_at: null, note: 'quote " and\nnewline' }]);
    const file = writer.finish();
    expect(file.rowCount).toBe(2);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    const decoded = decodeColdFile(file.bytes, { expected: { sha256: file.sha256, rowCount: 2 } });
    expect(decoded.columns).toEqual(["id", "value", "fetched_at", "note"]);
    expect(decoded.rows).toEqual([
      { id: "1", value: "12345678901234.5678", fetched_at: "2026-10-17T00:00:00.000Z", note: null },
      { id: "2", value: "0", fetched_at: null, note: 'quote " and\nnewline' },
    ]);
  });

  it("refuses a file whose checksum or row count does not match its index row", () => {
    const writer = new ColdFileWriter(["id"]);
    writer.push([{ id: "1" }]);
    const file = writer.finish();
    expect(() => decodeColdFile(file.bytes, { expected: { sha256: "0".repeat(64), rowCount: 1 } })).toThrow("checksum");
    expect(() => decodeColdFile(file.bytes, { expected: { sha256: file.sha256, rowCount: 2 } })).toThrow("holds 1 rows");
  });

  it("skips filtered lines before parsing but still counts them", () => {
    const writer = new ColdFileWriter(["item_key"]);
    writer.push([{ item_key: "a" }, { item_key: "b" }, { item_key: "a" }]);
    const file = writer.finish();
    const decoded = decodeColdFile(file.bytes, { lineFilter: (line) => line.includes('"a"') });
    expect(decoded.rows).toHaveLength(2);
    expect(decoded.totalRows).toBe(3);
  });

  it("keys files under their own prefix, one per table, source and period", () => {
    expect(coldObjectKey("institution_call_report_items", "ffiec", "2019-03-31")).toBe(
      `${COLD_KEY_PREFIX}/institution_call_report_items/ffiec/2019-03-31.jsonl.gz`,
    );
    expect(coldObjectKey("t", "../x", "p")).toBe(`${COLD_KEY_PREFIX}/t/.._x/p.jsonl.gz`);
  });

  it("reports not configured without R2 credentials", async () => {
    const store = createColdStore(null, "bucket");
    expect(store.configured).toBe(false);
    await expect(store.get("k")).rejects.toThrow("not configured");
  });
});
