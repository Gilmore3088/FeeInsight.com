/**
 * The translated-copy restore against real SQL (production schema, loopback only, #1986). A fee read
 * from a bank's Spanish copy was archived because its English twin was live; when that twin comes
 * down under another rule the Spanish fee comes back, unless another English line of it is live or
 * waiting to publish, a newer copy of the schedule replaced the twin, another rule took the Spanish
 * fee down too, or its own document no longer states it.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import {
  TRANSLATED_COPY_RESTORED_FLAG,
  judgeTranslatedCopyRestores,
  restoreTranslatedCopies,
  translatedCopyRestoreRowsSql,
} from "./translated-copy-check";

const connection = process.env.E2E_DATABASE_URL;
const INST = 1986001;
const SPANISH = 1986101;
const ENGLISH = 1986102;
const CURRENT = 1986103;
const SPANISH_OTHER = 1986104;
const EVENT = "00000000-0000-4000-8000-000001986000";
type Db = Parameters<typeof restoreTranslatedCopies>[0];
type Tx = postgres.Sql<{ numeric: number; json: unknown; text: string }>;
class Rollback extends Error {}

const SPANISH_TEXT = [
  "Cargos por servicios",
  "Cargo por sobregiro $15.00 por partida",
  "Cargo por cheque oficial $10.00",
  "Detener pago $30.00",
  "Giro postal $5.00",
  "Cargo por proceso legal $75.00",
  "Análisis de cuentas (por hora) $25.00",
  "Copias de cheques $2.00",
  "Giro bancario nacional $25.00",
  "Copia de estado de cuenta $3.00",
].join("\n");

describe.skipIf(!connection)("translated-copy restore (#1986)", () => {
  let raw: Tx;
  let nextRaw = 1986200;
  let nextRun = -1986001;

  beforeAll(() => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Translated-copy restore DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });
  afterAll(async () => { if (raw) await raw.end(); });

  /** Each case runs in its own transaction, rolled back at the end. */
  async function inRollback(work: (tx: Tx, runId: number) => Promise<void>): Promise<void> {
    const runId = nextRun--;
    await raw.begin(async (transaction) => {
      const tx = transaction as unknown as Tx;
      await tx`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'Spanish Copy Test CU', 'credit_union', 'ncua', 'OR')`;
      await tx`INSERT INTO agent_runs (id, agent_name, run_kind, title, status) VALUES (${runId}, 'darwin', 'state_agent', 'Translated-copy restore fixture', 'running')`;
      await tx`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
               VALUES (${SPANISH}, ${INST}, 'success', 'https://cu.test/files/110125-Personal-Fee-Schedule_ES-US.pdf', 'h-es', NOW()),
                      (${ENGLISH}, ${INST}, 'success', 'https://cu.test/files/010125_Personal_Fee_Schedule.pdf', 'h-en', NOW()),
                      (${CURRENT}, ${INST}, 'success', 'https://cu.test/files/Personal-Fee-Schedule-Current.pdf', 'h-cur', NOW()),
                      (${SPANISH_OTHER}, ${INST}, 'success', 'https://cu.test/es/tarifas', 'h-es2', NOW())`;
      await tx`INSERT INTO agent_source_texts (source_document_id, institution_id, source_url, document_type, status, normalized_text, text_hash, char_count)
               VALUES (${SPANISH}, ${INST}, 'https://cu.test/files/110125-Personal-Fee-Schedule_ES-US.pdf', 'pdf', 'completed', ${SPANISH_TEXT}, 't-1986', ${SPANISH_TEXT.length})`;
      await work(tx, runId);
      throw new Rollback();
    }).catch((error) => { if (!(error instanceof Rollback)) throw error; });
  }

  interface FeeOptions {
    documentId: number;
    key: string;
    amount: number;
    reason?: string | null;
    batch?: string | null;
    flags?: string[];
    status?: string;
    publish?: boolean;
  }

  /** A fee through the tiers. `publish: false` leaves a verified row with no catalog row (waiting to publish). */
  async function fee(tx: Tx, name: string, options: FeeOptions): Promise<{ published: number | null; verified: number }> {
    const rawId = nextRaw++;
    const reason = options.reason ?? null;
    await tx`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
             VALUES (${rawId}, ${INST}, ${options.documentId}, ${EVENT}, ${name}, ${options.amount}, 'per_item', 'knox')`;
    const [verified] = await tx`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status, outlier_flags)
             VALUES (${rawId}, ${INST}, ${options.key}, ${EVENT}, ${name}, ${options.amount}, 'per_item', ${options.status ?? (reason ? "rejected" : "verified")},
                     ${JSON.stringify(options.flags ?? [])}::jsonb) RETURNING fee_verified_id`;
    if (options.publish === false) return { published: null, verified: Number(verified.fee_verified_id) };
    const [published] = await tx`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url, rolled_back_at, rolled_back_by_batch_id, rolled_back_reason)
             VALUES (${verified.fee_verified_id}, ${INST}, ${options.key}, ${EVENT}, ${name}, ${options.amount}, 'per_item', 'agentic-run-1986', 'https://cu.test/',
                     ${reason ? new Date("2026-10-19T00:32:10Z") : null}, ${options.batch ?? null}, ${reason}) RETURNING fee_published_id`;
    return { published: Number(published.fee_published_id), verified: Number(verified.fee_verified_id) };
  }

  /** An English line and its Spanish copy archived for it; `twinReason` takes the English line down. */
  async function pair(tx: Tx, spanish: string, english: string, key: string, amount: number, twinReason: string | null) {
    const twin = await fee(tx, english, { documentId: ENGLISH, key, amount, reason: twinReason, batch: twinReason ? "other-check-1" : null });
    const copy = await fee(tx, spanish, {
      documentId: SPANISH, key, amount,
      reason: `translated_copy: #${SPANISH} twin #${twin.published}`, batch: "darwin-translated-copy-9143", flags: ["translated_copy"],
    });
    return { twin: twin.published as number, copy: copy.published as number, copyVerified: copy.verified };
  }

  async function verdicts(tx: Tx): Promise<Record<number, string>> {
    const rows = await translatedCopyRestoreRowsSql(tx as unknown as Db, { institutionId: INST });
    const judged = judgeTranslatedCopyRestores(rows);
    const out: Record<number, string> = {};
    for (const fee of judged.restorable) out[fee.feePublishedId] = "restore";
    for (const fee of judged.keptSamples) out[fee.feePublishedId] = fee.verdict;
    return out;
  }

  it("judges each archived Spanish fee by its English line and its own document", async () => {
    await inRollback(async (tx) => {
      const gone = await pair(tx, "Cargo por sobregiro", "Overdraft Fee", "overdraft", 15, "source_check: amount_not_in_text");
      const live = await pair(tx, "Cargo por cheque oficial", "Official Check Fee", "cashiers_check", 10, null);
      const replaced = await pair(tx, "Detener pago", "Stop Payment", "stop_payment", 30, `older_edition: #${CURRENT} dated 2026-10-01`);
      // The named twin is down, but another English line of the fee is live.
      const another = await pair(tx, "Giro postal", "Money Order", "money_order", 5, "same_line_duplicate: live fee #1");
      await fee(tx, "Money Orders (each)", { documentId: CURRENT, key: "money_order", amount: 5 });
      // The named twin is down, and the current edition's English row waits to publish.
      const waiting = await pair(tx, "Cargo por proceso legal", "Legal Process Fee", "legal_process", 75, "source_check: amount_not_in_text");
      await fee(tx, "Legal Process Fee", { documentId: CURRENT, key: "legal_process", amount: 75, publish: false });
      // The named twin is held by the account type hold: it still counts as the English line.
      const held = await pair(tx, "Análisis de cuentas (por hora)", "Account Research (per hour)", "account_research", 25, "account_type_hold: savings");
      // Another rule flagged the Spanish row after this check took it down.
      const other = await pair(tx, "Copias de cheques", "Check Copy", "check_image", 2, "source_check: amount_not_in_text");
      await tx`UPDATE verified_fee_observations SET outlier_flags = outlier_flags || '["source_check"]'::jsonb WHERE fee_verified_id = ${other.copyVerified}`;
      // Its own document no longer states this price.
      const reread = await pair(tx, "Reemplazo de tarjeta", "Card Replacement", "card_replacement", 5, "source_check: amount_not_in_text");
      // Another Spanish copy's fee is live at this category and price: a restore would duplicate it.
      const duplicate = await pair(tx, "Giro bancario nacional", "Domestic Wire", "wire_domestic_outgoing", 25, "source_check: amount_not_in_text");
      await fee(tx, "Transferencia nacional saliente", { documentId: SPANISH_OTHER, key: "wire_domestic_outgoing", amount: 25 });
      // An English row with a catalog row (here quarantined) is not waiting to publish.
      const quarantined = await pair(tx, "Copia de estado de cuenta", "Statement Copy", "statement_copy", 3, "source_check: amount_not_in_text");
      const heldOut = await fee(tx, "Statement Copy", { documentId: CURRENT, key: "statement_copy", amount: 3 });
      await tx`UPDATE published_fee_records SET quarantined_at = NOW(), quarantine_reason = 'test' WHERE fee_published_id = ${heldOut.published}`;

      expect(await verdicts(tx)).toEqual({
        [gone.copy]: "restore",
        [live.copy]: "twin_live",
        [replaced.copy]: "twin_replaced",
        [another.copy]: "english_twin_live",
        [waiting.copy]: "english_twin_waiting",
        [held.copy]: "english_twin_live",
        [other.copy]: "other_takedown",
        [reread.copy]: "not_on_own_document",
        [duplicate.copy]: "same_fee_live",
        [quarantined.copy]: "restore",
      });
    });
  });

  it("keeps a fee down while another check's second look is open on it", async () => {
    await inRollback(async (tx, runId) => {
      const gone = await pair(tx, "Cargo por sobregiro", "Overdraft Fee", "overdraft", 15, "source_check: amount_not_in_text");
      await tx`INSERT INTO pipeline_feedback (about_stage, about_strategy, signal, kind, reported_by, check_name, institution_id, fee_published_id, agent_run_id, dedupe_key, weight, evidence)
               VALUES ('publish', 'hamilton.source_check', 'wrong', 'takedown_pending', 'gutenberg', 'hamilton.source_check', ${INST}, ${gone.copy}, ${runId},
                       ${`hamilton.second_look:hamilton.source_check:pub:${gone.copy}`}, 0, '{}'::jsonb)`;
      expect(await verdicts(tx)).toEqual({ [gone.copy]: "other_takedown" });
    });
  });

  it("switched off, reports and writes nothing; switched on, restores the fee, its verified row and its second look", async () => {
    await inRollback(async (tx, runId) => {
      const gone = await pair(tx, "Cargo por sobregiro", "Overdraft Fee", "overdraft", 15, "source_check: amount_not_in_text");
      const live = await pair(tx, "Cargo por cheque oficial", "Official Check Fee", "cashiers_check", 10, null);
      const db = tx as unknown as Db;

      const off = await restoreTranslatedCopies(db, { runId, dryRun: false, institutionId: INST });
      expect(off.live).toBe(false);
      expect(off.restorable.map((fee) => fee.feePublishedId)).toEqual([gone.copy]);
      expect(off.restored).toEqual([]);
      const [still] = await tx`SELECT rolled_back_at FROM published_fee_records WHERE fee_published_id = ${gone.copy}`;
      expect(still.rolled_back_at).not.toBeNull();

      const on = await restoreTranslatedCopies(db, { runId, stepId: null, dryRun: false, institutionId: INST, live: true });
      expect(on.restored).toEqual([gone.copy]);
      const [published] = await tx`SELECT rolled_back_at, rolled_back_reason, rolled_back_by_batch_id FROM published_fee_records WHERE fee_published_id = ${gone.copy}`;
      expect(published).toMatchObject({ rolled_back_at: null, rolled_back_reason: null, rolled_back_by_batch_id: null });
      const [verified] = await tx`SELECT review_status, outlier_flags FROM verified_fee_observations WHERE fee_verified_id = ${gone.copyVerified}`;
      expect(verified.review_status).toBe("verified");
      const flags = typeof verified.outlier_flags === "string" ? JSON.parse(verified.outlier_flags) : verified.outlier_flags;
      expect(flags).toEqual([TRANSLATED_COPY_RESTORED_FLAG]);
      const looks = await tx`SELECT kind FROM pipeline_feedback WHERE fee_published_id = ${gone.copy} AND check_name = 'darwin.translated_copy' ORDER BY kind`;
      expect(looks.map((row) => row.kind)).toEqual(["flag_cleared", "takedown_cleared"]);
      // Weight 0: the takedown was right when made, so the check's precision is not credited.
      const weights = await tx`SELECT DISTINCT weight::float AS weight FROM pipeline_feedback WHERE fee_published_id = ${gone.copy} AND check_name = 'darwin.translated_copy'`;
      expect(weights.map((row) => Number(row.weight))).toEqual([0]);
      const events = await tx`SELECT event_type FROM agent_run_events WHERE agent_run_id = ${runId}`;
      expect(events.map((row) => row.event_type)).toEqual(["darwin.translated_copy_restored"]);
      const [kept] = await tx`SELECT rolled_back_at FROM published_fee_records WHERE fee_published_id = ${live.copy}`;
      expect(kept.rolled_back_at).not.toBeNull();

      // Read again, the restored fee is live, so nothing more comes back.
      const again = await restoreTranslatedCopies(db, { runId, dryRun: false, institutionId: INST, live: true });
      expect(again.restored).toEqual([]);
      expect(again.archived).toBe(1);
    });
  });

  it("re-checks every condition in the write: a line published between the read and the write keeps the fee down", async () => {
    for (const race of ["english", "spanish_copy", "waiting", "other_look"] as const) {
      await inRollback(async (tx, runId) => {
        const gone = await pair(tx, "Cargo por sobregiro", "Overdraft Fee", "overdraft", 15, "source_check: amount_not_in_text");
        const land = async () => {
          if (race === "english") await fee(tx, "Overdraft Item Fee", { documentId: CURRENT, key: "overdraft", amount: 15 });
          if (race === "spanish_copy") await fee(tx, "Sobregiro por partida", { documentId: SPANISH_OTHER, key: "overdraft", amount: 15 });
          if (race === "waiting") await fee(tx, "Overdraft Item Fee", { documentId: CURRENT, key: "overdraft", amount: 15, publish: false });
          if (race === "other_look") {
            await tx`INSERT INTO pipeline_feedback (about_stage, about_strategy, signal, kind, reported_by, check_name, institution_id, fee_published_id, agent_run_id, dedupe_key, weight, evidence)
                     VALUES ('publish', 'hamilton.source_check', 'wrong', 'takedown_pending', 'gutenberg', 'hamilton.source_check', ${INST}, ${gone.copy}, ${runId},
                             ${`hamilton.second_look:hamilton.source_check:pub:${gone.copy}`}, 0, '{}'::jsonb)`;
          }
        };
        // The write's statement runs only after the race lands (no savepoint: the proxy has none).
        const racing = new Proxy(tx, {
          get: (target, key) => (key === "savepoint" ? undefined : Reflect.get(target, key)),
          apply: (target, thisArg, args) => {
            const strings = args[0] as TemplateStringsArray;
            if (Array.isArray(strings) && strings.join("?").includes("WITH eligible AS")) {
              return (async () => { await land(); return await Reflect.apply(target, thisArg, args); })();
            }
            return Reflect.apply(target, thisArg, args);
          },
        }) as unknown as Db;
        const result = await restoreTranslatedCopies(racing, { runId, dryRun: false, institutionId: INST, live: true });
        expect(result.restorable.map((row) => row.feePublishedId), race).toEqual([gone.copy]);
        expect(result.restored, race).toEqual([]);
        const [still] = await tx`SELECT rolled_back_at FROM published_fee_records WHERE fee_published_id = ${gone.copy}`;
        expect(still.rolled_back_at, race).not.toBeNull();
      });
    }
  });
});
