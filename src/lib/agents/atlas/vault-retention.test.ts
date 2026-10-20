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
function mockDb(answers: { eligible?: Row; keys?: Row[]; refs?: Row[] } = {}) {
  const calls: string[] = [];
  const tag = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    calls.push(text);
    if (text.includes("UPDATE source_documents")) return Promise.resolve([]);
    if (text.includes("FROM objects")) {
      return Promise.resolve([{ objects: "16760", bytes: String(3_200 * MB), unsized: "3", html_bytes: String(2_000 * MB), pdf_bytes: String(1_100 * MB), other_bytes: String(100 * MB), week_objects: "9000", week_bytes: String(2_700 * MB) }]);
    }
    if (text.includes("pg_attribute")) {
      return Promise.resolve(answers.refs ?? FEE_LINEAGE_REFS.map((ref) => ({ tbl: ref.table, col: ref.column })));
    }
    return Promise.resolve([{ value: "0", applied: "15s" }]);
  });
  const unsafe = vi.fn((text: string) => {
    calls.push(text);
    if (text.includes("count(*)::bigint AS objects")) return Promise.resolve([answers.eligible ?? { objects: "0", bytes: "0", unsized: "0" }]);
    return Promise.resolve(answers.keys ?? []);
  });
  Object.assign(tag, { unsafe });
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
    for (const ref of FEE_LINEAGE_REFS) {
      expect(sqlText).toContain(`SELECT ${ref.column}${ref.holds === "document" ? "::bigint AS id" : " AS key"} FROM ${ref.table} WHERE ${ref.column} IS NOT NULL`);
    }
    expect(sqlText).toContain("live_fee_audit.%");
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

  it("when switched on, deletes the re-selected keys and clears them on their rows", async () => {
    const { db, calls } = mockDb({
      eligible: { objects: "2", bytes: String(3 * MB), unsized: "0" },
      keys: [{ key: KEY_A, bytes: String(MB) }, { key: KEY_B, bytes: String(2 * MB) }],
    });
    const { send, client } = s3();
    const result = await runVaultRetention({ db, client, live: true, bucket: "docs" });
    expect(send.mock.calls.map(([command]) => [command instanceof DeleteObjectCommand, (command as DeleteObjectCommand).input])).toEqual([
      [true, { Bucket: "docs", Key: KEY_A }],
      [true, { Bucket: "docs", Key: KEY_B }],
    ]);
    expect(result.retention).toMatchObject({ live: true, deleted: 2, deletedMb: 3, failed: 0, deletedKeys: [KEY_A, KEY_B] });
    expect(calls.some((c) => c.includes("UPDATE source_documents SET document_r2_key = NULL"))).toBe(true);
    expect(vaultRetentionDetail(result).retention).toMatchObject({ deleted: 2, deleted_keys: [KEY_A, KEY_B] });
  });

  it("deletes nothing without R2, and reports why", async () => {
    const { db, calls } = mockDb({ eligible: { objects: "1", bytes: String(MB), unsized: "0" }, keys: [{ key: KEY_A, bytes: String(MB) }] });
    const result = await runVaultRetention({ db, client: null, live: true });
    expect(result.retention).toMatchObject({ deleted: 0, note: "R2 is not configured; nothing deleted" });
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
