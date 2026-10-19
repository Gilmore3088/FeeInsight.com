// @vitest-environment node
/** Two real connections: a stale reader must not replace the committed repair. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractPdfDocumentText } from "./pdf-document-text";

const connection = process.env.E2E_DATABASE_URL;
const bytes = readFileSync(join(__dirname, "test-fixtures/oakwood-fees.pdf"));
const sourceHash = createHash("sha256").update(bytes).digest("hex");
const oldText = readFileSync(join(__dirname, "test-fixtures/oakwood-interleaved.txt"), "utf8");
const oldHash = createHash("sha256").update(oldText).digest("hex");

describe.skipIf(!connection)("atomic stacked repair with concurrent readers", () => {
  let db: typeof import("@/lib/data-store/connection").sql;
  let owner: typeof import("./read");
  const previousUrl = process.env.DATABASE_URL;
  const previousPool = process.env.DATABASE_POOL_MAX;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Only an isolated loopback E2E database is allowed");
    }
    process.env.DATABASE_URL = connection;
    process.env.DATABASE_POOL_MAX = "5";
    vi.resetModules();
    ({ sql: db } = await import("@/lib/data-store/connection"));
    owner = await import("./read");
  });

  afterAll(async () => {
    await db?.end();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousPool === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = previousPool;
  });

  it("commits one winner and rejects an earlier reader's now-stale selected incumbent", async () => {
    const [inst] = await db`
      INSERT INTO institution_sources (institution_name, charter_type, state_code, source, fee_schedule_url, last_crawl_at, rescue_status)
      VALUES ('Concurrent repair fixture', 'bank', 'ZZ', 'e2e', 'https://fixture.example/fees.pdf', NOW(), 'rescued') RETURNING id
    `;
    const [doc] = await db`
      INSERT INTO source_documents (institution_id, status, document_url, content_hash, content_type, document_r2_key)
      VALUES (${inst.id}, 'success', 'https://fixture.example/fees.pdf', ${sourceHash}, 'application/pdf', ${`${sourceHash.slice(0, 2)}/${sourceHash}`}) RETURNING id
    `;
    const [artifact] = await db`
      INSERT INTO agent_source_texts (institution_id, source_document_id, status, document_type, reader, source_hash, normalized_text, text_hash, char_count)
      VALUES (${inst.id}, ${doc.id}, 'completed', 'pdf', 'read.pdf_layout', ${sourceHash}, ${oldText}, ${oldHash}, ${oldText.length}) RETURNING id
    `;
    const runs = await db`INSERT INTO agent_runs (agent_name, run_kind) VALUES ('rosetta', 'state_agent'), ('rosetta', 'state_agent') RETURNING id`;
    let release!: () => void;
    let selected!: () => void;
    const waitForRelease = new Promise<void>((resolve) => { release = resolve; });
    const didSelect = new Promise<void>((resolve) => { selected = resolve; });
    const options = {
      db, institutionId: Number(inst.id), limit: 1,
      fetchImpl: async () => { throw new Error("No network"); },
      vault: { configured: true, read: async () => new Uint8Array(bytes),
        store: async () => ({ status: "already_stored" as const, key: `${sourceHash.slice(0, 2)}/${sourceHash}` }),
        presign: async () => "unused" },
    };
    let earlier: ReturnType<typeof owner.runRosettaRead> | undefined;
    try {
      earlier = owner.runRosettaRead({ ...options, runId: Number(runs[0].id), pdfTextExtractor: async () => {
        selected();
        await waitForRelease;
        return extractPdfDocumentText(bytes);
      } });
      await didSelect;
      const winner = await owner.runRosettaRead({ ...options, runId: Number(runs[1].id) });
      expect(winner.results[0].repairSettlement?.accepted).toBe(true);
      release();
      const stale = await earlier;
      expect(stale.results[0].repairSettlement).toMatchObject({ accepted: false, reason: "selected_incumbent_changed" });
      const [current] = await db`SELECT text_hash, agent_run_id FROM agent_source_texts WHERE id = ${artifact.id}`;
      expect(current.text_hash).toBe(winner.results[0].textHash);
      expect(Number(current.agent_run_id)).toBe(Number(runs[1].id));
      const successes = await db`SELECT detail FROM pipeline_attempts WHERE source_document_id = ${doc.id} AND detail ? 'pdf_stacked'`;
      expect(successes).toHaveLength(1);
      expect(successes[0].detail).toMatchObject({ persisted_text_id: Number(artifact.id), persisted_text_hash: current.text_hash });
    } finally {
      release();
      await earlier?.catch(() => undefined);
      // This database is local-only; remove precisely the committed fixture lineage.
      await db`DELETE FROM pipeline_feedback WHERE institution_id = ${inst.id}`;
      await db`DELETE FROM pipeline_attempts WHERE institution_id = ${inst.id}`;
      await db`DELETE FROM agent_source_texts WHERE institution_id = ${inst.id}`;
      await db`DELETE FROM source_documents WHERE institution_id = ${inst.id}`;
      await db`DELETE FROM institution_source_profiles WHERE institution_id = ${inst.id}`;
      await db`DELETE FROM institution_sources WHERE id = ${inst.id}`;
      await db`DELETE FROM agent_runs WHERE id IN (${runs[0].id}, ${runs[1].id})`;
    }
  }, 30_000);
});
