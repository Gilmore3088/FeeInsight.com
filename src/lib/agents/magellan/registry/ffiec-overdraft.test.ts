import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { earlierQuarterEnds, ffiecOverdraftPartitions, runRegistryFfiecOverdraft } from "./ffiec-overdraft";
import type { RegistryDb } from "./partitions";

describe("FFIEC overdraft partitions", () => {
  it("runs years newest first and quarters oldest first inside a year", () => {
    const parts = ffiecOverdraftPartitions(new Date("2026-10-07T00:00:00Z"), { year: 2025, quarter: 1 });
    expect(parts).toEqual(["2026Q1", "2026Q2", "2025Q1", "2025Q2", "2025Q3", "2025Q4"]);
  });

  it("lists the same-year quarters a YTD figure is measured against", () => {
    expect(earlierQuarterEnds({ year: 2026, quarter: 1 })).toEqual([]);
    expect(earlierQuarterEnds({ year: 2026, quarter: 3 })).toEqual(["2026-06-30", "2026-03-31"]);
  });
});

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("COUNT(DISTINCT rssd_id)")) return Promise.resolve([{ matched: 1 }]);
    if (text.includes("UPDATE institution_financial_records")) return Promise.resolve([{ quarterly: true }]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

function fetchWith(zip: Uint8Array | null) {
  const page = `<input name="__VIEWSTATE" value="v" /><input name="__VIEWSTATEGENERATOR" value="g" />
    <select name="ctl00$MainContentHolder$DatesDropDownList">${zip ? '<option value="1">06/30/2026</option>' : ""}</select>`;
  let calls = 0;
  return vi.fn(async () => {
    calls += 1;
    if (calls < 5 || !zip) return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
    return new Response(zip as unknown as BodyInit, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }) as unknown as typeof fetch;
}

describe("runRegistryFfiecOverdraft", () => {
  const zip = zipSync({
    "FFIEC CDR Call Schedule RI 06302026.txt": strToU8('"IDRSSD"\t"RIADH032"\n""\t"desc"\n"852218"\t"2500"\n'),
  });

  it("dry run reads and matches but writes nothing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryFfiecOverdraft({ partitionKey: "2026Q2", dryRun: true, db, fetchOptions: { fetchImpl: fetchWith(zip) } });
    expect(r).toMatchObject({ filers: 1, matchedBanks: 1, updatedRows: 0, empty: false });
    expect(statements.some((s) => s.text.includes("UPDATE"))).toBe(false);
  });

  it("writes the quarter against earlier same-year quarters and records the partition", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryFfiecOverdraft({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl: fetchWith(zip) } });
    expect(r).toMatchObject({ updatedRows: 1, quarterlyValues: 1 });
    const update = statements.find((s) => s.text.includes("UPDATE institution_financial_records"));
    expect(update?.values).toContainEqual(["2026-03-31"]);
    expect(update?.values).toContain("2026-06-30");
    expect(statements.some((s) => s.text.includes("registry_ingest_partitions") && s.values.includes("succeeded"))).toBe(true);
  });

  it("records an empty partition when FFIEC has not posted the quarter", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryFfiecOverdraft({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl: fetchWith(null) } });
    expect(r.empty).toBe(true);
    expect(statements.some((s) => s.values.includes("empty"))).toBe(true);
  });
});
