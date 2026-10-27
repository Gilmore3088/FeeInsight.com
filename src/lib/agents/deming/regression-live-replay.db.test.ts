/**
 * Deming's regression step on seeded live fees (#2064), in real PostgreSQL, loopback only, against
 * the production schema. Each case runs in a transaction rolled back at the end:
 * - the limit guard's own cases get the fee-fields pass's live-and-uncaught handling, and a live
 *   regression names the check whose restore put the fee back;
 * - a reviewed acceptance retires an active case its check's version accepts;
 * - same-line duplicates replay on whether the line they repeat is on the catalog;
 * - wrong-document takedowns replay on their document's address and stored text.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { runDemingRegression, type AcceptedTakedown } from "./regression";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20640501;
const EVENT = "00000000-0000-4000-8000-000020640501";
type Db = NonNullable<Parameters<typeof runDemingRegression>[0]["db"]>;
type Tx = postgres.Sql<{ numeric: number; json: unknown; text: string }>;
class Rollback extends Error {}

describe.skipIf(!connection)("regression replay on seeded live fees (#2064)", () => {
  let raw: Tx;
  let nextRaw = 20640600;
  let nextDoc = 20640700;

  beforeAll(() => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Regression replay DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });
  afterAll(async () => { if (raw) await raw.end(); });

  async function inRollback(work: (tx: Tx) => Promise<void>): Promise<void> {
    await raw.begin(async (transaction) => {
      const tx = transaction as unknown as Tx;
      await tx`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Live Replay Test Bank', 'bank', 'fdic', 'TX')`;
      await work(tx);
      throw new Rollback();
    }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
  }

  async function document(tx: Tx, url: string, text: string | null = null): Promise<number> {
    const id = nextDoc++;
    await tx`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash) VALUES (${id}, ${INST}, 'success', ${url}, ${`test2064-live-${id}`})`;
    if (text) await tx`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text) VALUES (${id}, ${INST}, 'completed', ${text})`;
    return id;
  }

  /** A published fee with its verified and raw rows; down when `reason` is given. */
  async function fee(tx: Tx, key: string, name: string, amount: number, reason: string | null = null): Promise<number> {
    const rawId = nextRaw++;
    await tx`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, agent_event_id, fee_name, amount, source) VALUES (${rawId}, ${INST}, ${EVENT}, ${name}, ${amount}, 'knox')`;
    const [verified] = await tx`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
             VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, ${reason ? "rejected" : "verified"}) RETURNING fee_verified_id`;
    const [published] = await tx`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url, rolled_back_at, rolled_back_reason)
             VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'test-2064', 'https://bank.test/fees.pdf',
                     ${reason ? new Date("2026-10-10T00:00:00Z") : null}, ${reason}) RETURNING fee_published_id`;
    return Number(published.fee_published_id);
  }

  async function seed(tx: Tx, key: string, check: string, input: Record<string, unknown>, feeId: number, options: { status?: string; documentId?: number | null; reason?: string | null } = {}) {
    await tx`INSERT INTO eval_cases (case_key, dataset, status, agent, check_name, error_class, severity, institution_id, fee_published_id, source_document_id, input, expected, label_provenance)
             VALUES (${key}, 'regression', ${options.status ?? "candidate"}, 'hamilton', ${check}, 'test', 'major', ${INST}, ${feeId}, ${options.documentId ?? null},
                     ${tx.json(input as never)}, ${tx.json({ publishable: false, caught_by: check, reason: options.reason ?? null } as never)}, 'takedown_confirmed')`;
  }

  const row = async (tx: Tx, key: string) => (await tx`SELECT status, last_caught, last_verdict FROM eval_cases WHERE case_key = ${key}`)[0];
  const run = (tx: Tx, accepted?: readonly AcceptedTakedown[]) =>
    runDemingRegression({ runId: null, db: tx as unknown as Db, promoteLimit: 0, replayLimit: 0, ...(accepted ? { accepted } : {}) });

  it("gives the limit guard's own cases the live-and-uncaught handling and names the restoring check", async () => {
    await inRollback(async (tx) => {
      // Live again in its category and the guard passes it: a regression, tagged with the restore.
      const live = await fee(tx, "overdraft", "Overdraft Fee", 35);
      await seed(tx, "test2064live:limit-regressed", "hamilton.limit_guard", { kind: "limit_guard", canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: 35, conditions: null }, live, { status: "active" });
      await tx`INSERT INTO pipeline_attempts (institution_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
               VALUES (${INST}, 'publish', 'hamilton.source_check', 1, ${`restored:${live}:1`}, 'ok', ${tx.json({ restored_fee_published_id: live, restored_by: "hamilton.limit_guard" } as never)})`;
      // Live, but re-filed to another category: not this takedown's fee coming back, so not live here.
      const refiled = await fee(tx, "overdraft_daily_cap", "No Bounce Courtesy Pay Limit", 600);
      await seed(tx, "test2064live:limit-refiled", "hamilton.limit_guard", { kind: "limit_guard", canonical_fee_key: "od_daily_cap", fee_name: "No Bounce Courtesy Pay Limit", amount: 600, conditions: null }, refiled, { status: "active" });
      // Down and still caught.
      const down = await fee(tx, "od_daily_cap", "No Bounce Courtesy Pay Limit", 600, "limit_guard: name_states_limit");
      await seed(tx, "test2064live:limit-down", "hamilton.limit_guard", { kind: "limit_guard", canonical_fee_key: "od_daily_cap", fee_name: "No Bounce Courtesy Pay Limit", amount: 600, conditions: null }, down, { status: "active" });

      const result = await run(tx);

      expect(await row(tx, "test2064live:limit-regressed")).toMatchObject({ status: "active", last_caught: false, last_verdict: "passes_limit_guard" });
      expect(await row(tx, "test2064live:limit-refiled")).toMatchObject({ status: "active", last_caught: true });
      expect(await row(tx, "test2064live:limit-down")).toMatchObject({ status: "active", last_caught: true });
      const misses = result.regressions.filter((miss) => miss.checkName === "hamilton.limit_guard");
      expect(misses).toHaveLength(1);
      expect(misses[0]).toMatchObject({ verdict: "passes_limit_guard", restoredBy: "hamilton.limit_guard" });
    });
  });

  it("retires an active live case only with a reviewed acceptance", async () => {
    await inRollback(async (tx) => {
      const live = await fee(tx, "stop_payment", "Stop Payment Fee", 25);
      await seed(tx, "test2064live:accepted", "hamilton.category_guard", { kind: "unreplayable", canonical_fee_key: "stop_payment", fee_name: "Stop Payment Fee", amount: 25, conditions: null }, live, { status: "active" });
      const without = await run(tx);
      expect(without.regressions.filter((miss) => miss.checkName === "hamilton.category_guard")).toHaveLength(1);
      expect(await row(tx, "test2064live:accepted")).toMatchObject({ status: "active", last_caught: false });

      const result = await run(tx, [{ check: "hamilton.category_guard", feePublishedIds: [live], sinceVersion: 1, why: "test", issue: 2064 }]);
      expect(result.accepted).toBe(1);
      expect(result.regressions.filter((miss) => miss.checkName === "hamilton.category_guard")).toHaveLength(0);
      expect(await row(tx, "test2064live:accepted")).toMatchObject({ status: "retired", last_caught: false, last_verdict: "accepted:hamilton.category_guard@v1" });
    });
  });

  it("replays same-line duplicates on whether the line they repeat is on the catalog", async () => {
    await inRollback(async (tx) => {
      const kept = await fee(tx, "stop_payment", "Stop Payment", 15);
      const down = await fee(tx, "stop_payment", "Stop Payment Online", 15, `same_line_duplicate: live fee #${kept}`);
      await seed(tx, "test2064live:dup-down", "hamilton.same_line_duplicate", { kind: "unreplayable", canonical_fee_key: "stop_payment", fee_name: "Stop Payment Online", amount: 15, conditions: null }, down, { reason: `same_line_duplicate: live fee #${kept}` });
      // Live again beside its kept line: the duplicate is back.
      const back = await fee(tx, "stop_payment", "Stop Payment Per Request", 15);
      await seed(tx, "test2064live:dup-back", "hamilton.same_line_duplicate", { kind: "unreplayable", canonical_fee_key: "stop_payment", fee_name: "Stop Payment Per Request", amount: 15, conditions: null }, back, { status: "active", reason: `same_line_duplicate: live fee #${kept}` });
      // The kept line was taken down for another reason and nothing replaced it: the copy may come back.
      const gone = await fee(tx, "wire_domestic_outgoing", "Outgoing Wire", 30, "category_guard: name_contradicts");
      const orphan = await fee(tx, "wire_domestic_outgoing", "Wire Out", 30, `same_line_duplicate: live fee #${gone}`);
      await seed(tx, "test2064live:dup-orphan", "hamilton.same_line_duplicate", { kind: "unreplayable", canonical_fee_key: "wire_domestic_outgoing", fee_name: "Wire Out", amount: 30, conditions: null }, orphan, { status: "active", reason: `same_line_duplicate: live fee #${gone}` });
      // The kept line was replaced by a newer line still live: the copy stays caught.
      const newer = await fee(tx, "nsf", "NSF Fee", 32);
      const older = await fee(tx, "nsf", "Non-Sufficient Funds", 32, `refreshed by #${newer}`);
      const copy = await fee(tx, "nsf", "NSF Item", 32, `same_line_duplicate: live fee #${older}`);
      await seed(tx, "test2064live:dup-replaced", "hamilton.same_line_duplicate", { kind: "unreplayable", canonical_fee_key: "nsf", fee_name: "NSF Item", amount: 32, conditions: null }, copy, { reason: `same_line_duplicate: live fee #${older}` });

      const result = await run(tx);

      expect(await row(tx, "test2064live:dup-down")).toMatchObject({ status: "active", last_caught: true, last_verdict: "kept_line_live" });
      expect(await row(tx, "test2064live:dup-back")).toMatchObject({ status: "active", last_caught: true, last_verdict: "live_beside_kept_line" });
      expect(await row(tx, "test2064live:dup-orphan")).toMatchObject({ status: "candidate", last_caught: false, last_verdict: "kept_line_gone" });
      expect(await row(tx, "test2064live:dup-replaced")).toMatchObject({ status: "active", last_caught: true, last_verdict: "kept_line_live" });
      const dups = result.regressions.filter((miss) => miss.checkName === "hamilton.same_line_duplicate");
      expect(dups).toEqual([expect.objectContaining({ verdict: "live_beside_kept_line", restoredBy: null })]);
    });
  });

  it("replays wrong-document takedowns on their document's address and text", async () => {
    await inRollback(async (tx) => {
      const product = await document(tx, "https://bank.test/personal/checking");
      const free = await fee(tx, "bill_pay", "Online Bill Pay", 0, `product_page: #${product}`);
      await seed(tx, "test2064live:product", "hamilton.product_page", { kind: "unreplayable", canonical_fee_key: "bill_pay", fee_name: "Online Bill Pay", amount: 0, conditions: "Knox read a free fee from Rosetta artifact #1." }, free, { documentId: product });
      const article = await document(tx, "https://bank.test/learning/what-atm-fees-cost");
      const avg = await fee(tx, "atm_non_network", "ATM fees average", 4.73, `article_page: #${article}`);
      await seed(tx, "test2064live:article", "hamilton.article_page", { kind: "unreplayable", canonical_fee_key: "atm_non_network", fee_name: "ATM fees average", amount: 4.73, conditions: null }, avg, { documentId: article });
      // A document whose address names no kind but whose opening is a loan disclosure (v4).
      const loan = await document(tx, "https://bank.test/docs/disclosure-17.pdf", "Personal Unsecured Consumer Loan Disclosure\nMonthly fee $0\nLate Payment Fee $25");
      const late = await fee(tx, "late_payment", "Late Payment Fee", 25, `loan_titled_document: loan #${loan}`);
      await seed(tx, "test2064live:loan-opening", "darwin.non_deposit_document", { kind: "unreplayable", canonical_fee_key: "late_payment", fee_name: "Late Payment Fee", amount: 25, conditions: null }, late, { documentId: loan });
      // An active wrong-document case whose fee is live again on a page today's rule passes.
      const schedule = await document(tx, "https://bank.test/fee-schedule.pdf");
      const backLive = await fee(tx, "atm_non_network", "Foreign ATM", 3);
      await seed(tx, "test2064live:article-regressed", "hamilton.article_page", { kind: "unreplayable", canonical_fee_key: "atm_non_network", fee_name: "Foreign ATM", amount: 3, conditions: null }, backLive, { status: "active", documentId: schedule });

      const result = await run(tx);

      expect(await row(tx, "test2064live:product")).toMatchObject({ status: "active", last_caught: true, last_verdict: "product_page" });
      expect(await row(tx, "test2064live:article")).toMatchObject({ status: "active", last_caught: true, last_verdict: "article_page" });
      expect(await row(tx, "test2064live:loan-opening")).toMatchObject({ status: "active", last_caught: true, last_verdict: "loan_titled_document" });
      expect(await row(tx, "test2064live:article-regressed")).toMatchObject({ status: "active", last_caught: false, last_verdict: "passes_article_page" });
      expect(result.regressions.filter((miss) => miss.checkName === "hamilton.article_page")).toHaveLength(1);
      expect(result.fixture).toMatchObject({ committed: expect.any(Number) });
    });
  });
});
