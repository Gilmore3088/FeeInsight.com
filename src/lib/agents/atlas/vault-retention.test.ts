import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  FEE_LINEAGE_REFS,
  rejectedVaultSql,
  runVaultRetention,
  summarizeVaultRetention,
  VAULT_ALERT_MB,
  VAULT_RETENTION_LIVE,
  VAULT_WEEKLY_GROWTH_ALERT_MB,
  vaultAlerts,
  vaultRetentionDetail,
  type VaultSize,
} from "./vault-retention";

type Row = Record<string, unknown>;
type Db = Parameters<typeof runVaultRetention>[0]["db"];

const KEY_A = `ab/${"ab".repeat(32)}`;
const KEY_B = `cd/${"cd".repeat(32)}`;
const MB = 1_048_576;

/** Tagged-template db mock with `unsafe`, answering by the SQL it sees and recording every statement. */
function mockDb(answers: {
  eligible?: Row; keys?: Row[]; refs?: Row[];
  /** Keys the re-check inside the committed transaction no longer finds eligible. */
  noLongerEligible?: string[];
  /** Keys something stored or cited after their rows were cleared. */
  referencedAfterClear?: string[];
} = {}) {
  const calls: string[] = [];
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push(text);
    if (text.includes("UPDATE source_documents SET document_r2_key = NULL")) {
      calls.push(`clear ${String(values[0])}`);
      return Promise.resolve(text.includes("RETURNING id") ? [{ id: "1" }] : []);
    }
    if (text.includes("UPDATE source_documents SET document_r2_key =")) {
      calls.push(`restore ${String(values[0])}`);
      return Promise.resolve([]);
    }
    if (text.includes("FOR UPDATE")) return Promise.resolve([]);
    if (text.includes("FROM objects")) {
      return Promise.resolve([{ objects: "16760", bytes: String(3_200 * MB), unsized: "3", html_bytes: String(2_000 * MB), pdf_bytes: String(1_100 * MB), other_bytes: String(100 * MB), week_objects: "9000", week_bytes: String(2_700 * MB) }]);
    }
    if (text.includes("pg_attribute")) {
      return Promise.resolve(answers.refs ?? FEE_LINEAGE_REFS.map((ref) => ({ tbl: ref.table, col: ref.column })));
    }
    return Promise.resolve([{ value: "0", applied: "15s" }]);
  });
  const unsafe = vi.fn((text: string, params: unknown[] = []) => {
    calls.push(text);
    if (text.includes("count(*)::bigint AS objects")) return Promise.resolve([answers.eligible ?? { objects: "0", bytes: "0", unsized: "0" }]);
    if (text.includes("AS referenced")) {
      calls.push(`recheck ${String(params[0])}`);
      return Promise.resolve([{ referenced: (answers.referencedAfterClear ?? []).includes(String(params[0])) }]);
    }
    if (text.includes("AND sd.document_r2_key = $2::text")) {
      calls.push(`verify ${String(params[1])}`);
      return Promise.resolve((answers.noLongerEligible ?? []).includes(String(params[1])) ? [] : [{ key: params[1] }]);
    }
    return Promise.resolve(answers.keys ?? []);
  });
  // A transaction runs on the same mock; `begin` marks where it starts and commits.
  const begin = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
    calls.push("begin");
    const value = await work(tag);
    calls.push("commit");
    return value;
  });
  Object.assign(tag, { unsafe, begin });
  return { db: tag as unknown as Db, calls };
}

function s3() {
  const send = vi.fn().mockResolvedValue({});
  return { send, client: { send } as unknown as S3Client };
}

describe("VAULT_RETENTION_LIVE", () => {
  it("is off until James says yes: deleting stored documents is a production-data change", () => {
    expect(VAULT_RETENTION_LIVE).toBe(false);
  });
});

describe("rejectedVaultSql", () => {
  const sqlText = rejectedVaultSql(FEE_LINEAGE_REFS, "count");

  it("keeps out every fee lineage reference, past or present, and every live-fee audit capture", () => {
    for (const ref of FEE_LINEAGE_REFS.filter((r) => r.holds === "document" || r.holds === "key")) {
      expect(sqlText).toContain(`SELECT ${ref.column}${ref.holds === "document" ? "::bigint AS id" : " AS key"} FROM ${ref.table} WHERE ${ref.column} IS NOT NULL`);
    }
    expect(sqlText).toContain("live_fee_audit.%");
    expect(sqlText).toContain("SELECT source_document_id::bigint AS id FROM pipeline_attempts");
    // Answer-key documents: by the hash of their bytes (as a vault key), by bank and URL, and by
    // every page an eligibility check read.
    expect(sqlText).toContain("SELECT substr(h, 1, 2) || '/' || h AS key");
    expect(sqlText).toContain("FROM (SELECT lower(btrim(content_hash)) AS h FROM answer_key_institutions");
    expect(sqlText).toContain("sd.institution_id = ak.institution_id AND sd.document_url = btrim(ak.document_url)");
    expect(sqlText).toContain("e.event_type = 'answer_key.eligibility'");
    expect(sqlText).toContain("e.detail->'observations'");
  });

  it("builds each protected set once and anti-joins it, never per holder row", () => {
    for (const cte of ["rejected", "holders", "holder_ids", "protected_ids", "protected_keys", "texts"]) {
      expect(sqlText).toContain(`${cte} AS MATERIALIZED (`);
    }
    expect(sqlText).not.toMatch(/bool_and\([^)]*EXISTS/);
    expect(sqlText).toContain("LEFT JOIN protected_ids p1 ON p1.id = h.id");
    expect(sqlText).toContain("WHERE NOT EXISTS (SELECT 1 FROM protected_keys k WHERE k.key = g.key)");
    expect(rejectedVaultSql(FEE_LINEAGE_REFS, "verify")).toContain("AND sd.document_r2_key = $2::text");
    expect(sqlText).not.toContain("$2");
    // The raw, verified and published tiers are all in scope, by document and by key.
    expect(FEE_LINEAGE_REFS.filter((ref) => ref.required).map((ref) => `${ref.table}.${ref.column}`)).toEqual([
      "raw_fee_observations.source_document_id",
      "raw_fee_observations.document_r2_key",
      "verified_fee_observations.document_r2_key",
      "published_fee_records.document_r2_key",
    ]);
  });

  it("requires every holder of the bytes, by key or by content hash, to be a rejected, fee-less, old document", () => {
    expect(sqlText).toContain("sd.content_hash = split_part(r.key, '/', 2)");
    expect(sqlText).toContain("t.status <> 'wrong_document'");
    expect(sqlText).toContain("COALESCE(h.fees_extracted, 0) = 0");
    expect(sqlText).toContain("GREATEST(h.crawled_at, h.last_checked_at) <");
  });

  it("fails closed when a fee tier is missing, and refuses unsafe identifiers", () => {
    expect(() => rejectedVaultSql(FEE_LINEAGE_REFS.filter((ref) => ref.table !== "published_fee_records"), "count"))
      .toThrow("Fee lineage not found: published_fee_records.document_r2_key");
    expect(() => rejectedVaultSql([...FEE_LINEAGE_REFS, { table: "x; DROP TABLE y", column: "id", holds: "document" }], "count"))
      .toThrow("Unsafe lineage reference");
  });
});

describe("runVaultRetention", () => {
  it("measures and counts, and deletes nothing while off", async () => {
    const { db, calls } = mockDb({ eligible: { objects: "120", bytes: String(250 * MB), unsized: "2" } });
    const { send, client } = s3();
    const result = await runVaultRetention({ db, client });
    expect(result.size).toEqual({ objects: 16_760, mb: 3_200, unsizedObjects: 3, htmlMb: 2_000, pdfMb: 1_100, otherMb: 100, weekObjects: 9_000, weekMb: 2_700 });
    expect(result.retention).toMatchObject({ live: false, eligibleObjects: 120, eligibleMb: 250, eligibleUnsized: 2, deleted: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(calls.some((c) => c.includes("UPDATE source_documents"))).toBe(false);
    expect(summarizeVaultRetention(result)).toContain("120 files, 250 MB would go (off)");
  });

  it("never deletes in a dry run, even when switched on", async () => {
    const { db } = mockDb({ eligible: { objects: "1", bytes: String(MB), unsized: "0" }, keys: [{ key: KEY_A, bytes: String(MB) }] });
    const { send, client } = s3();
    const result = await runVaultRetention({ db, client, live: true, dryRun: true });
    expect(result.retention.live).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  /** An R2 mock that writes each delete into the same call log as the database. */
  function loggedS3(calls: string[], fail: string[] = []) {
    const send = vi.fn(async (command: DeleteObjectCommand) => {
      if (fail.includes(String(command.input.Key))) throw new Error("R2 down");
      calls.push(`delete ${String(command.input.Key)}`);
      return {};
    });
    return { send, client: { send } as unknown as S3Client };
  }
  const steps = (calls: string[]) => calls.filter((c) => /^(begin|commit|verify|clear|recheck|delete|restore) /.test(`${c} `));

  it("when switched on, re-checks and clears each key in a committed transaction, re-checks again, then deletes", async () => {
    const { db, calls } = mockDb({
      eligible: { objects: "2", bytes: String(3 * MB), unsized: "0" },
      keys: [{ key: KEY_A, bytes: String(MB) }, { key: KEY_B, bytes: String(2 * MB) }],
    });
    const { send, client } = loggedS3(calls);
    const result = await runVaultRetention({ db, client, live: true, bucket: "docs", commitDb: db });
    expect(send.mock.calls.map(([command]) => [command instanceof DeleteObjectCommand, command.input])).toEqual([
      [true, { Bucket: "docs", Key: KEY_A }],
      [true, { Bucket: "docs", Key: KEY_B }],
    ]);
    expect(steps(calls)).toEqual([
      "begin", `verify ${KEY_A}`, `clear ${KEY_A}`, "commit", `recheck ${KEY_A}`, `delete ${KEY_A}`, `clear ${KEY_A}`,
      "begin", `verify ${KEY_B}`, `clear ${KEY_B}`, "commit", `recheck ${KEY_B}`, `delete ${KEY_B}`, `clear ${KEY_B}`,
    ]);
    // The rows holding the bytes are locked before the re-check.
    expect(calls.some((c) => c.includes("FOR UPDATE"))).toBe(true);
    expect(result.retention).toMatchObject({ live: true, deleted: 2, deletedMb: 3, kept: 0, failed: 0, deletedKeys: [KEY_A, KEY_B] });
    expect(vaultRetentionDetail(result).retention).toMatchObject({ deleted: 2, deleted_keys: [KEY_A, KEY_B] });
  });

  it("keeps an object the committed re-check no longer finds eligible, touching no row", async () => {
    const { db, calls } = mockDb({ eligible: { objects: "1", bytes: String(MB), unsized: "0" }, keys: [{ key: KEY_A, bytes: String(MB) }], noLongerEligible: [KEY_A] });
    const { send, client } = loggedS3(calls);
    const result = await runVaultRetention({ db, client, live: true, commitDb: db });
    expect(send).not.toHaveBeenCalled();
    expect(steps(calls)).toEqual(["begin", `verify ${KEY_A}`, "commit"]);
    expect(result.retention).toMatchObject({ deleted: 0, kept: 1, failed: 0 });
  });

  it("keeps an object something stored or cited after its rows were cleared, and gives the rows their key back", async () => {
    const { db, calls } = mockDb({ eligible: { objects: "1", bytes: String(MB), unsized: "0" }, keys: [{ key: KEY_A, bytes: String(MB) }], referencedAfterClear: [KEY_A] });
    const { send, client } = loggedS3(calls);
    const result = await runVaultRetention({ db, client, live: true, commitDb: db });
    expect(send).not.toHaveBeenCalled();
    expect(steps(calls)).toEqual(["begin", `verify ${KEY_A}`, `clear ${KEY_A}`, "commit", `recheck ${KEY_A}`, `restore ${KEY_A}`]);
    expect(result.retention).toMatchObject({ deleted: 0, kept: 1 });
  });

  it("gives the rows their key back when the R2 delete fails", async () => {
    const { db, calls } = mockDb({ eligible: { objects: "1", bytes: String(MB), unsized: "0" }, keys: [{ key: KEY_A, bytes: String(MB) }] });
    const { client } = loggedS3(calls, [KEY_A]);
    const result = await runVaultRetention({ db, client, live: true, commitDb: db });
    expect(steps(calls)).toEqual(["begin", `verify ${KEY_A}`, `clear ${KEY_A}`, "commit", `recheck ${KEY_A}`, `restore ${KEY_A}`]);
    expect(result.retention).toMatchObject({ deleted: 0, failed: 1, deletedKeys: [] });
  });

  it("deletes nothing without R2 or without a connection outside the step's transaction, and reports why", async () => {
    const { db, calls } = mockDb({ eligible: { objects: "1", bytes: String(MB), unsized: "0" }, keys: [{ key: KEY_A, bytes: String(MB) }] });
    const result = await runVaultRetention({ db, client: null, live: true, commitDb: db });
    expect(result.retention).toMatchObject({ deleted: 0, note: "R2 is not configured; nothing deleted" });
    const { send, client } = s3();
    const noCommit = await runVaultRetention({ db, client, live: true });
    expect(noCommit.retention).toMatchObject({ deleted: 0, note: "no connection outside the step's transaction; nothing deleted" });
    expect(send).not.toHaveBeenCalled();
    expect(calls.some((c) => c.includes("UPDATE source_documents"))).toBe(false);
  });

  it("reports a count it could not make instead of deleting", async () => {
    const { db } = mockDb({ refs: FEE_LINEAGE_REFS.filter((ref) => ref.table !== "raw_fee_observations").map((ref) => ({ tbl: ref.table, col: ref.column })) });
    const { send, client } = s3();
    const result = await runVaultRetention({ db, client, live: true });
    expect(result.retention.eligibleObjects).toBeNull();
    expect(result.retention.error).toContain("Fee lineage not found");
    expect(send).not.toHaveBeenCalled();
    expect(summarizeVaultRetention(result)).toContain("could not count");
  });
});

describe("vaultAlerts", () => {
  const size = (mb: number, weekMb: number): VaultSize => ({ objects: 1, mb, unsizedObjects: 0, htmlMb: 0, pdfMb: 0, otherMb: 0, weekObjects: 1, weekMb });
  it("warns only above the size or the week's growth threshold", () => {
    expect(vaultAlerts(size(3_200, 2_700))).toEqual([]);
    expect(vaultAlerts(size(VAULT_ALERT_MB + 1, VAULT_WEEKLY_GROWTH_ALERT_MB + 1))).toEqual([
      `document vault is ${(VAULT_ALERT_MB + 1).toLocaleString("en-US")} MB, above ${VAULT_ALERT_MB.toLocaleString("en-US")} MB`,
      `document vault grew ${(VAULT_WEEKLY_GROWTH_ALERT_MB + 1).toLocaleString("en-US")} MB in 7 days, above ${VAULT_WEEKLY_GROWTH_ALERT_MB.toLocaleString("en-US")} MB`,
    ]);
    expect(vaultAlerts(null)).toEqual([]);
  });
});
