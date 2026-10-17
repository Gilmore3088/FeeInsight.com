import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { MAKING_ENDS_MEET_SOURCE, makingEndsMeetPartitions, runRegistryMakingEndsMeet } from "./making-ends-meet";
import type { RegistryDb } from "./partitions";

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

const partition = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
  if (!insert) return null;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const CODEBOOK = [
  ["Variable", "Label", "Value", "Value label"],
  ["wave", "Survey wave", "2019", "2019 wave"],
  ["", "", "2022", "2022 wave"],
  ["wt", "Final survey weight", "", ""],
  ["od", "Did you pay an overdraft fee in the past 12 months?", "1", "Yes"],
  ["", "", "2", "No"],
  ["bills", "Difficulty paying bills or expenses in the past 12 months", "1", "Yes"],
  ["", "", "2", "No"],
]
  .map((r) => r.map((c) => `"${c}"`).join(","))
  .join("\n");
const DATA = ["wave,wt,od,bills", "2022,1,1,1", "2022,3,2,2", "2019,1,1,1", "2019,1,2,1"].join("\n");

function fetchImplFor(files: Record<string, BodyInit>) {
  return vi.fn(async (url: string) => (files[String(url)] ? new Response(files[String(url)]) : new Response("", { status: 404 }))) as unknown as typeof fetch;
}

describe("making ends meet registry step", () => {
  it("has one standing partition", () => {
    expect(makingEndsMeetPartitions(new Date("2026-10-17T00:00:00Z"))).toEqual(["current"]);
    expect(MAKING_ENDS_MEET_SOURCE).toBe("cfpb-making-ends-meet");
  });

  it("loads every wave, records which questions were found, and writes the partition", async () => {
    const { db, statements } = createDb();
    const fetchImpl = fetchImplFor({ "https://x/d.csv": DATA, "https://x/c.csv": CODEBOOK });
    const r = await runRegistryMakingEndsMeet({
      partitionKey: "current",
      db,
      env: { MAKING_ENDS_MEET_DATA_URL: "https://x/d.csv", MAKING_ENDS_MEET_CODEBOOK_URL: "https://x/c.csv" },
      fetchOptions: { fetchImpl, backoffMs: 0 },
    });
    expect(r.empty).toBe(false);
    expect(r.writtenRows).toBe(r.rows);
    expect(r.summary).toMatch(/waves 2022, 2019; overdraft question found/);
    const p = partition(statements)!;
    expect(p.status).toBe("succeeded");
    expect(p.detail.weight_variable).toBe("wt");
    expect(p.detail.overdraft_question_in_public_file).toBe(true);
    expect(p.detail.questions_by_wave["2022"].mem_paid_overdraft_fee).toBe("od: 2 respondents");
    expect(p.detail.questions_by_wave["2022"].mem_has_bank_account).toBeNull();
    expect(p.detail.missing_fields).toContain("mem_has_bank_account (no question with this wording)");
    const insert = statements.find((s) => s.text.includes("INSERT INTO area_statistics"))!;
    const rows = JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
    const od2022 = rows.find((x: { series_key: string; period: string }) => x.series_key === "mem_paid_overdraft_fee" && x.period === "2022");
    expect(od2022).toMatchObject({ geo_type: "nation", geo_code: "US", value: 25, unit: "percent" });
    expect(od2022.raw_json).toMatchObject({ respondents: 2, positive_respondents: 1 });
  });

  it("records the partition empty, never failing, when no file can be downloaded", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryMakingEndsMeet({ partitionKey: "current", db, env: {}, fetchOptions: { fetchImpl: fetchImplFor({}), backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(r.emptyReason).toMatch(/No Making Ends Meet public-use CSV/);
    expect(partition(statements)!.status).toBe("empty");
    expect(statements.some((s) => s.text.includes("INSERT INTO area_statistics"))).toBe(false);
  });

  it("writes nothing on a dry run", async () => {
    const { db, statements } = createDb();
    const zip = zipSync({ "puf.csv": strToU8(DATA), "codebook.csv": strToU8(CODEBOOK) });
    const r = await runRegistryMakingEndsMeet({
      partitionKey: "current",
      db,
      dryRun: true,
      env: { MAKING_ENDS_MEET_DATA_URL: "https://x/puf.zip" },
      fetchOptions: { fetchImpl: fetchImplFor({ "https://x/puf.zip": zip }), backoffMs: 0 },
    });
    expect(r).toMatchObject({ dryRun: true, writtenRows: 0, empty: false });
    expect(statements).toEqual([]);
  });
});
