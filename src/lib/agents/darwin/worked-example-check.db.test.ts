/**
 * The worked example re-check's read in real PostgreSQL (production schema, loopback only; review of
 * #2928): the text before the excerpt ends with the character right before it, wherever the excerpt
 * sits, so Darwin hands Knox's own test the same line break Knox read. Without it, a fee line under an
 * "Example: ..." sentence more than 3,000 characters in was joined to that sentence and matched.
 */
import { createHash } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { findWorkedExamples, recheckWorkedExamples, workedExampleRowsSql, WORKED_EXAMPLE_WINDOW } from "./worked-example-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 2928001;
const FAR_DOC = 2928101;
const NEAR_DOC = 2928102;
const EVENT = "00000000-0000-4000-8000-000002928000";

const FEE_LINE = "Outgoing domestic wire transfer $25.00 each.";
const ABOVE = "Example: a $1,000 balance earns the premium rate.";
// The fee line follows the example sentence on its own line, far past the 3,000-character window start.
const FAR_TEXT = `${"Account services and terms. ".repeat(150)}\n${ABOVE}\n${FEE_LINE}`;
// The same two lines near the top of the text.
const NEAR_TEXT = `Fees\n${ABOVE}\n${FEE_LINE}`;
// The worked example itself (fee 89920's shape): its $10 is the example's balance, not a charge.
const EXAMPLE_LINE = "Assume your available balance in your designated linked account is $10. We may elect to transfer the $10 in your designated linked account.";
const EXAMPLE_TEXT = `${"Overdraft protection terms apply. ".repeat(120)}\nThe following example illustrates how overdraft protection works:\n${EXAMPLE_LINE}`;
const EXAMPLE_DOC = 2928103;

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe.skipIf(!connection)("worked example re-check in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let nextRaw = 2928200;
  const ids: Record<string, number> = {};
  const artifacts: Record<number, number> = {};

  async function seed(label: string, documentId: number, text: string, excerpt: string, name: string, amount: number): Promise<void> {
    const rawId = nextRaw++;
    const note = `Knox deterministic extraction from Rosetta artifact #${artifacts[documentId]}. text_hash=${sha(text)}; excerpt="${excerpt}"`;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source, extraction_note)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${name}, ${amount}, 'knox', ${note})`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
              VALUES (${rawId}, ${INST}, 'od_protection_transfer', ${EVENT}, ${name}, ${amount}, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, 'od_protection_transfer', ${EVENT}, ${name}, ${amount}, 'agentic-run-2928', 'https://bank.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
  }

  async function cleanup(): Promise<void> {
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Worked example DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Worked Example Test CU', 'credit_union', 'ncua', 'VA')`;
    for (const [doc, text] of [[FAR_DOC, FAR_TEXT], [NEAR_DOC, NEAR_TEXT], [EXAMPLE_DOC, EXAMPLE_TEXT]] as const) {
      await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
                VALUES (${doc}, ${INST}, 'success', ${`https://bank.test/${doc}.html`}, ${`h${doc}`}, NOW())`;
      const [artifact] = await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
                VALUES (${doc}, ${INST}, ${`https://bank.test/${doc}.html`}, 'html', 'completed', ${text}, ${sha(text)}, ${text.length}) RETURNING id`;
      artifacts[doc] = Number(artifact.id);
    }
    await seed("far", FAR_DOC, FAR_TEXT, FEE_LINE, "Outgoing domestic wire transfer", 25);
    await seed("near", NEAR_DOC, NEAR_TEXT, FEE_LINE, "Outgoing domestic wire transfer", 25);
    await seed("example", EXAMPLE_DOC, EXAMPLE_TEXT, EXAMPLE_LINE, "Overdraft protection transfer", 10);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("the text before ends with the character right before the excerpt, far in or near the top", async () => {
    expect(FAR_TEXT.indexOf(FEE_LINE)).toBeGreaterThan(WORKED_EXAMPLE_WINDOW);
    const rows = await workedExampleRowsSql(raw as never, { institutionId: INST });
    const before = (label: string) => rows.find((row) => Number(row.fee_published_id) === ids[label])?.text_before ?? null;
    expect(before("far")).toBe(FAR_TEXT.slice(FAR_TEXT.indexOf(FEE_LINE) - WORKED_EXAMPLE_WINDOW, FAR_TEXT.indexOf(FEE_LINE)));
    expect(before("far")?.endsWith(`${ABOVE}\n`)).toBe(true);
    expect(before("near")).toBe(NEAR_TEXT.slice(0, NEAR_TEXT.indexOf(FEE_LINE)));
  });

  it("matches only the worked example's figure, never a fee line under an example sentence", async () => {
    const rows = await workedExampleRowsSql(raw as never, { institutionId: INST });
    expect(findWorkedExamples(rows).matches.map((match) => match.feePublishedId)).toEqual([ids.example]);
    const result = await recheckWorkedExamples(raw as never, { runId: 0, dryRun: true, institutionId: INST, live: true });
    expect(result.matched).toBe(1);
    expect(result.takenDown).toEqual([]);
  });
});
