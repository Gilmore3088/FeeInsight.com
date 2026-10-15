/** Real PostgreSQL check of Deming's Knox miss replay (#1099), on loopback-only temporary tables. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { caseKeyFor, KNOX_MISS_CHECK, runKnoxMisses } from "./knox-misses";

const connection = process.env.E2E_DATABASE_URL;
type Db = NonNullable<Parameters<typeof runKnoxMisses>[0]>["db"];

const TEXT = ["Fee Schedule", "Overdraft Fee | $35.00 per item"].join("\n");

describe.skipIf(!connection)("Deming Knox miss replay in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Knox miss tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE answer_key_institutions (id bigint PRIMARY KEY, institution_id bigint, document_url text, document_type text, content_hash text, status text)`;
    await db`CREATE TEMP TABLE answer_key_fees (id bigint PRIMARY KEY, answer_key_institution_id bigint, canonical_key text, amount numeric, amount_kind text, source_line text, status text)`;
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, institution_id bigint, document_url text, content_hash text, status text)`;
    await db`CREATE TEMP TABLE agent_source_texts (id bigint PRIMARY KEY, institution_id bigint, source_document_id bigint, status text, text_hash text, normalized_text text, updated_at timestamptz DEFAULT now())`;
    await db`CREATE TEMP TABLE eval_cases (
      id bigserial PRIMARY KEY, case_key text UNIQUE NOT NULL, dataset text NOT NULL, status text NOT NULL, agent text NOT NULL,
      check_name text, error_class text NOT NULL, severity text NOT NULL, institution_id bigint, source_document_id bigint,
      source_url text, source_text_hash text, input jsonb NOT NULL, expected jsonb NOT NULL, label_provenance text NOT NULL,
      agent_run_id bigint, last_checked_at timestamptz, last_caught boolean, last_verdict text, last_run_id bigint,
      updated_at timestamptz DEFAULT now())`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint)`;
    await db`INSERT INTO answer_key_institutions VALUES (1, 7, 'https://www.bank.example/fees.pdf', 'text_pdf', NULL, 'confirmed')`;
    await db`INSERT INTO answer_key_fees VALUES
      (10, 1, 'overdraft', 35, 'fixed', 'Overdraft Fee | $35.00 per item', 'confirmed'),
      (11, 1, 'stop_payment', 30, 'fixed', 'Stop Payment Fee | $30.00', 'confirmed')`;
    await db`INSERT INTO source_documents VALUES (21, 7, 'http://bank.example/fees.pdf', 'abc', 'completed')`;
    await db`INSERT INTO agent_source_texts (id, institution_id, source_document_id, status, text_hash, normalized_text) VALUES (31, 7, 21, 'completed', 'h1', ${TEXT})`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("stores a case for the missed fee, then activates it once the text prints a fee Knox reads", async () => {
    const first = await runKnoxMisses({ db: db as unknown as Db, runId: 1 });
    expect(first).toMatchObject({ feesScored: 2, feesMissed: 1, newCases: 1 });
    const [stored] = await db`SELECT * FROM eval_cases`;
    expect(stored).toMatchObject({
      case_key: caseKeyFor(11), dataset: "golden", status: "candidate", agent: "knox", check_name: KNOX_MISS_CHECK,
      label_provenance: "answer_key", source_document_id: "21", source_text_hash: "h1", last_verdict: "missed", last_caught: false,
    });

    // Rosetta stores a newer text that prints the stop payment line: today's rules read it.
    await db`UPDATE agent_source_texts SET normalized_text = ${`${TEXT}\nStop Payment Fee | $30.00`}, text_hash = 'h2' WHERE id = 31`;
    const second = await runKnoxMisses({ db: db as unknown as Db, runId: 2 });
    expect(second).toMatchObject({ feesMissed: 0, activated: 1, newCases: 0 });
    const [after] = await db`SELECT status, last_verdict, last_caught, last_run_id, input->>'text_hash' AS frozen_hash FROM eval_cases`;
    expect(after).toMatchObject({ status: "active", last_verdict: "read", last_caught: true, last_run_id: "2", frozen_hash: "h1" });

    // A key fee taken out of the key retires its case.
    await db`UPDATE answer_key_fees SET status = 'prefilled' WHERE id = 11`;
    const third = await runKnoxMisses({ db: db as unknown as Db, runId: 3 });
    expect(third.retired).toBe(1);
    expect((await db`SELECT status FROM eval_cases`)[0].status).toBe("retired");
    expect(await db`SELECT * FROM raw_fee_observations`).toHaveLength(0);
  });
});
