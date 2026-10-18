import { describe, expect, it, vi } from "vitest";

import type { RegistryDb } from "./partitions";
import { paydayReportsPartitions, runRegistryPaydayReports } from "./payday-reports";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("INSERT INTO area_statistics")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const status = (statements: Array<{ text: string; values: unknown[] }>) => statements.find((s) => s.text.includes("registry_ingest_partitions"))?.values[2];

describe("state-payday-reports", () => {
  it("has partitions", () => {
    expect(paydayReportsPartitions(new Date("2026-10-17T00:00:00Z"))[0]).toBe("WA-2025");
  });

  it("loads a known report's labelled figures", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    const r = await runRegistryPaydayReports({
      partitionKey: "WA-2023",
      db,
      fetchOptions: { fetchImpl, backoffMs: 0 },
      pdfText: async () => "Average fee per loan $68.21\nAverage APR 391%",
    });
    expect(r).toMatchObject({ rows: 2, writtenRows: 2, sourceUrl: "https://dfi.wa.gov/sites/default/files/reports/2023-payday-lending-report.pdf" });
    expect(status(statements)).toBe("succeeded");
  });

  it("records a year with no linked report empty", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response(`<a href="/r/2024-payday-loan-report.pdf">2024</a>`)) as unknown as typeof fetch;
    const r = await runRegistryPaydayReports({ partitionKey: "WA-2025", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(status(statements)).toBe("empty");
  });

  it("rejects an unknown state", async () => {
    await expect(runRegistryPaydayReports({ partitionKey: "CA-2024", db: createDb().db })).rejects.toThrow(/Invalid payday/);
  });
});
