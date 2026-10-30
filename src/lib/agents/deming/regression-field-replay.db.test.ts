/**
 * Deming's regression step replays fee-fields cases by their check name (#2064), in real
 * PostgreSQL, loopback only, against the production schema: old category-guard takedowns frozen as
 * `unreplayable`. A fresh audit miss is never replayed (#1119). Only this suite's own cases are asserted.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { BUSINESS_DOC_SQL, BUSINESS_NAME_SQL, readsAsBusinessSchedule } from "@/lib/agents/hamilton/business-schedule";
import { runDemingRegression } from "./regression";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20640001;
// Fee ids no published row has, so no case's fee is live.
const FEE = 20640100;
type Db = NonNullable<Parameters<typeof runDemingRegression>[0]["db"]>;

describe.skipIf(!connection)("regression replay of fee-fields cases (#2064)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;

  async function seed(key: string, dataset: string, check: string, input: Record<string, unknown>, fee: number, status = "candidate", sourceDocumentId: number | null = null) {
    await raw`INSERT INTO eval_cases (case_key, dataset, status, agent, check_name, error_class, severity, institution_id, fee_published_id, source_document_id, source_url, input, expected, label_provenance)
              VALUES (${key}, ${dataset}, ${status}, 'hamilton', ${check}, 'test', 'major', ${INST}, ${fee}, ${sourceDocumentId}, 'https://bank.test/business/not-the-document.pdf',
                      ${raw.json(input as never)}, ${raw.json({ publishable: false })}, ${dataset === "regression" ? "takedown_confirmed" : "human"})`;
  }

  /** A stored document and its completed text, the text Darwin reads. */
  async function document(id: number, url: string, text: string | null) {
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash) VALUES (${id}, ${INST}, 'success', ${url}, ${`test2064-${id}`})`;
    if (text) await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text) VALUES (${id}, ${INST}, 'completed', ${text})`;
  }

  /** The raw row Knox wrote: its own address can differ from its document's (Knox keeps the text's). */
  async function rawRow(id: number, sourceUrl: string) {
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, agent_event_id, fee_name, source_url, source)
              VALUES (${id}, ${INST}, gen_random_uuid(), 'Outgoing Wire', ${sourceUrl}, 'knox')`;
  }

  async function clean() {
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM eval_cases WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
  }

  const row = async (key: string) => (await raw`SELECT status, last_caught, last_verdict, last_checked_at FROM eval_cases WHERE case_key = ${key}`)[0];

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Regression replay DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await clean();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Replay Test Bank', 'bank', 'fdic', 'TX')`;
  });

  afterAll(async () => {
    if (raw) {
      await clean();
      await raw.end();
    }
  });

  it("replays old category takedowns by check name, and leaves an audit miss and a check with no replayer alone", async () => {
    const takedown = { kind: "unreplayable", canonical_fee_key: "stop_payment", fee_name: "Stop payment of Home Equity Line checks", amount: 25, conditions: null };
    await seed("test2064:category", "regression", "hamilton.category_guard", takedown, FEE);
    // Caught only with the schedule's NSF price, which the snapshot lacks: replayed, not caught, stays a candidate.
    await seed("test2064:nsf", "regression", "hamilton.category_guard", { ...takedown, canonical_fee_key: "nsf", fee_name: "Return Item Fee", amount: 10 }, FEE + 1);
    await seed("test2064:name", "fresh_audit", "deming.name_quality", { kind: "fresh_audit", canonical_fee_key: "atm", fee_name: "ATM A fee of", amount: 2 }, FEE + 2);
    // A check with no replayer (the taxonomy fold) is never read.
    await seed("test2064:product", "regression", "hamilton.taxonomy_fold", takedown, FEE + 3);
    // An active case the guard no longer catches is a regression.
    await seed("test2064:regressed", "regression", "hamilton.category_guard", { ...takedown, fee_name: "Stop Payment Fee" }, FEE + 4, "active");

    const result = await runDemingRegression({ runId: null, db: raw as unknown as Db, promoteLimit: 0, replayLimit: 0 });

    expect(await row("test2064:category")).toMatchObject({ status: "active", last_caught: true, last_verdict: "name_contradicts" });
    expect(await row("test2064:nsf")).toMatchObject({ status: "candidate", last_caught: false, last_verdict: "passes_category_guard" });
    expect(await row("test2064:name")).toMatchObject({ status: "candidate", last_caught: null, last_checked_at: null });
    expect(await row("test2064:product")).toMatchObject({ status: "candidate", last_caught: null, last_checked_at: null });
    expect(await row("test2064:regressed")).toMatchObject({ status: "active", last_caught: false });
    expect(result.regressions.some((miss) => miss.checkName === "hamilton.category_guard" && miss.verdict === "passes_category_guard")).toBe(true);
  });

  it("replays confirmed audience takedowns, old and new, against today's audience rules", async () => {
    const DOC = 20640300;
    const old = { kind: "unreplayable", canonical_fee_key: "overdraft", fee_name: "Balancing Checkbook", amount: 15, conditions: null };
    const wire = { kind: "audience", canonical_fee_key: "wire_domestic_outgoing", fee_name: "Outgoing Wire", amount: 30, conditions: null, document_url: "https://bank.test/treasury/fees.pdf" };
    // An old snapshot: the address is its document's (never the case's source_url), the text its document's newest.
    await document(DOC, "https://www.apgfcu.com/business-service-charges-and-fees-list.html", "Business Service Charges\nBalancing Checkbook $15.00");
    await seed("test2064:audience-old", "regression", "hamilton.business_schedule", old, FEE + 10, "candidate", DOC);
    // Darwin leaves a two-column price unknown; the business-schedule read catches the address.
    await document(DOC + 1, wire.document_url, "Fees\nPersonal Checking | Business Checking\nOutgoing Wire | $25.00 | $30.00\nStop Payment | $25.00 | $25.00");
    await seed("test2064:audience-new", "regression", "hamilton.business_schedule", wire, FEE + 11, "candidate", DOC + 1);
    // Darwin reads the same fee as consumer from a schedule with no business fees: not caught (review of #2064).
    await document(DOC + 2, wire.document_url, "Schedule of Fees\nOutgoing Wire $30.00\nStop Payment $25.00\nOverdraft Fee $30.00");
    await seed("test2064:audience-consumer", "regression", "hamilton.business_schedule", wire, FEE + 12, "candidate", DOC + 2);
    // No stored text: nothing is judged, and the case keeps its last verdict.
    await document(DOC + 3, wire.document_url, null);
    await seed("test2064:audience-no-text", "regression", "hamilton.business_schedule", wire, FEE + 13, "active", DOC + 3);
    await raw`UPDATE eval_cases SET last_caught = true, last_verdict = 'business_schedule_read' WHERE case_key = 'test2064:audience-no-text'`;
    // An old snapshot whose raw row has a plain address of its own (the text's) beside a business
    // document address: Darwin reads the raw row's address and the text, so it reads consumer, as
    // live verify would (review of #2720). The document's address alone would read business.
    await document(DOC + 5, "https://bank.test/business/fees.pdf", "Fees\nOutgoing Wire $30.00\nStop Payment $25.00");
    await rawRow(FEE + 15, "https://bank.test/fees");
    await seed("test2064:audience-raw-address", "regression", "hamilton.business_schedule",
      { kind: "unreplayable", canonical_fee_key: "wire_domestic_outgoing", fee_name: "Outgoing Wire", amount: 30, conditions: null }, FEE + 15, "candidate", DOC + 5);
    await raw`UPDATE eval_cases SET fee_raw_id = ${FEE + 15} WHERE case_key = 'test2064:audience-raw-address'`;
    // An active case today's rules would let through (Darwin reads its name as personal) is a regression.
    await document(DOC + 4, "https://bank.test/business/fees.pdf", "Fees\nPersonal Overdraft Fee $35.00");
    await seed("test2064:audience-regressed", "regression", "hamilton.business_schedule",
      { kind: "audience", canonical_fee_key: "overdraft", fee_name: "Personal Overdraft Fee", amount: 35, conditions: null, document_url: "https://bank.test/business/fees.pdf" }, FEE + 14, "active", DOC + 4);

    const result = await runDemingRegression({ runId: null, db: raw as unknown as Db, promoteLimit: 0, replayLimit: 0 });

    expect(await row("test2064:audience-old")).toMatchObject({ status: "active", last_caught: true, last_verdict: "darwin_reads_business" });
    expect(await row("test2064:audience-new")).toMatchObject({ status: "active", last_caught: true, last_verdict: "business_schedule_read" });
    expect(await row("test2064:audience-consumer")).toMatchObject({ status: "candidate", last_caught: false, last_verdict: "darwin_reads_consumer" });
    expect(await row("test2064:audience-no-text")).toMatchObject({ status: "active", last_caught: true, last_verdict: "business_schedule_read" });
    expect(await row("test2064:audience-raw-address")).toMatchObject({ status: "candidate", last_caught: false, last_verdict: "darwin_reads_consumer" });
    expect(result.notJudged).toBeGreaterThanOrEqual(1);
    expect(await row("test2064:audience-regressed")).toMatchObject({ status: "active", last_caught: false, last_verdict: "darwin_reads_consumer" });
    expect(result.regressions.filter((miss) => miss.checkName === "hamilton.business_schedule")).toHaveLength(1);
    expect(result.regressions.some((miss) => miss.checkName === "hamilton.business_schedule" && miss.verdict === "darwin_reads_consumer")).toBe(true);
  });

  it("reads business the same way as the business-schedule SQL", async () => {
    const samples: Array<[string, string]> = [
      ["Business ATM/Debit Transactions, off premises", "https://bank.test/fees.pdf"],
      ["Commercial NSF Fee per item", "https://bank.test/personal/fees.pdf"],
      ["Business Days to process", "https://bank.test/fees.pdf"],
      ["BUSINESS CHECKING ACCOUNT FEES | Skip-a-Pay", "https://bank.test/fees.pdf"],
      ["Monthly Service Charge", "https://bank.test/Commercial-Fee-Schedule.pdf"],
      ["Monthly Service Charge", "https://business.bank.test/fees.pdf"],
      ["Monthly Service Charge", "https://bank.test/business-and-personal-fees.pdf"],
      ["Wire", "https://bank.test/treasury/fees?type=Retail"],
      ["Overdraft Fee", "https://bank.test/fees.pdf"],
      // Non-ASCII (review of #2064): "é" continues the word, "_" too.
      ["Businessé Fee", "https://bank.test/fees.pdf"],
      ["Business Fee", "https://bank.test/fees.pdf"],
      ["Commercial_Fee", "https://bank.test/fees.pdf"],
    ];
    for (const [name, url] of samples) {
      const [sqlRow] = await raw.unsafe(`SELECT (${BUSINESS_NAME_SQL("$1::text")} OR ${BUSINESS_DOC_SQL("$2::text")}) AS business`, [name, url]);
      expect([name, url, readsAsBusinessSchedule(name, url)]).toEqual([name, url, sqlRow.business]);
    }
    // Whether `\s` matches a no-break space depends on the database's locale. Prod (PostgreSQL 17.6,
    // en_US.UTF-8) reads it as whitespace, as JS does; a C.UTF-8 test database does not. These are
    // prod's answers from a SELECT on 2026-10-26; the local SQL is held to them only when its
    // locale reads a no-break space as prod does.
    const prodAnswers: Array<[string, boolean]> = [[" Business Checking", true], [" Business Days", false]];
    const [{ unicode_space: unicodeSpace }] = await raw`SELECT E' ' ~ '^\\s$' AS unicode_space`;
    for (const [name, prod] of prodAnswers) {
      expect([name, readsAsBusinessSchedule(name, "https://bank.test/fees.pdf")]).toEqual([name, prod]);
      if (unicodeSpace) {
        const [sqlRow] = await raw.unsafe(`SELECT ${BUSINESS_NAME_SQL("$1::text")} AS business`, [name]);
        expect([name, sqlRow.business]).toEqual([name, prod]);
      }
    }
  });
});
