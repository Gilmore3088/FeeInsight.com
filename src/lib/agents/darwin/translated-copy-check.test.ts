import { describe, expect, it, vi } from "vitest";

import {
  TRANSLATED_COPY_CHECK,
  TRANSLATED_COPY_RESTORE_LIVE,
  TRANSLATED_COPY_TAKEDOWN_LIVE,
  judgeTranslatedCopyRestores,
  translatedCopyRestoreVerdict,
  type TranslatedCopyRestoreRow,
  findTranslatedCopies,
  readsSpanish,
  recheckTranslatedCopies,
  spanishCopyDocument,
  translatedCopyVerdict,
} from "./translated-copy-check";

const MTB_ES = "https://www.mtb.com/content/dam/mtb-web/pdfs/spanish-checking-fee-transparency-guide.pdf";
const EWB_ES = "https://www.eastwestbank.com/es/personal-banking/fee-schedule";

// Live rows on 2026-10-18 (prod, read-only): M&T's Spanish guide, and East West's /es/ page stored with English names.
const ROWS = [
  { fee_published_id: "145047", fee_verified_id: "9001", institution_id: "21", fee_name: "Cargo por sobregiro", amount: "15", canonical_fee_key: "overdraft", source_document_id: "33498", document_url: MTB_ES, twin_fee_published_id: "5001", twin_fee_name: "Overdraft Fee" },
  { fee_published_id: "145043", fee_verified_id: "9002", institution_id: "21", fee_name: "Cargo por cheque oficial", amount: "10", canonical_fee_key: "cashiers_check", source_document_id: "33498", document_url: MTB_ES, twin_fee_published_id: "5002", twin_fee_name: "Official Check Fee" },
  { fee_published_id: "145050", fee_verified_id: "9003", institution_id: "21", fee_name: "Retiro de efectivo en cajero automático que no es de M T Bank (EE. UU.)", amount: "3", canonical_fee_key: "atm_non_network", source_document_id: "33498", document_url: MTB_ES, twin_fee_published_id: null, twin_fee_name: null },
  { fee_published_id: "67077", fee_verified_id: "9004", institution_id: "38", fee_name: "Cashier’s Check (Bank Check) Fees: Non-Customer", amount: "10", canonical_fee_key: "cashiers_check", source_document_id: "14872", document_url: EWB_ES, twin_fee_published_id: "6001", twin_fee_name: "Cashier’s Check (Bank Check) Fees: Customer" },
  { fee_published_id: "77", fee_verified_id: "9005", institution_id: "21", fee_name: "Overdraft Fee", amount: "15", canonical_fee_key: "overdraft", source_document_id: "100", document_url: "https://www.mtb.com/checking.fee.transparency.guide.pdf", twin_fee_published_id: null, twin_fee_name: null },
];

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(rows: Array<Record<string, unknown>>, options: { flags?: Array<Record<string, unknown>>; archived?: TranslatedCopyRestoreRow[] } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("translated_copy_restore_rows")) return Promise.resolve(options.archived ?? []);
    if (text.includes("WITH eligible AS")) return Promise.resolve((options.archived ?? []).map((row) => ({ fee_published_id: row.fee_published_id })));
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "145047" }]);
    if (text.includes("FROM source_documents sd")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckTranslatedCopies>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("spanishCopyDocument and readsSpanish (#1909)", () => {
  it("names the Spanish copies found live on Oct 18 and not their English twins", () => {
    for (const url of [
      MTB_ES,
      EWB_ES,
      "https://www.onpointcu.com/files/110125-Personal-Fee-Schedule_ES-US.pdf",
      "https://www.soundcu.com/es/rates/personal/account-fees/",
      "https://www.expresscu.org/forms/schedule-of-fees-spanish.pdf",
      "https://www.bayfed.com/getmedia/x/consumer-fee-schedule-SPANISH.pdf",
    ]) expect(spanishCopyDocument(url)).toBe(true);
    for (const url of [
      "https://www.mtb.com/content/dam/mtb-web/pdfs/checking.fee.transparency.guide.pdf",
      "https://www.example.com/services/fees",
      "https://www.example.com/business-fees.pdf",
      null,
    ]) expect(spanishCopyDocument(url)).toBe(false);
  });

  it("reads Spanish names and leaves English ones", () => {
    for (const name of ["Cargo por sobregiro", "Fondos insuficientes", "Giro postal", "Detener pago", "Notario (no miembro)", "Análisis de cuentas (por hora)", "Llave de repuesto"]) {
      expect(readsSpanish(name)).toBe(true);
    }
    for (const name of ["Overdraft Fee", "Cashier’s Check (Bank Check) Fees: Non-Customer", "(per money order)", "Research Fee Deposit account research", "Visa Gift Card"]) {
      expect(readsSpanish(name)).toBe(false);
    }
  });

  it("takes down only a Spanish name with an English twin", () => {
    expect(translatedCopyVerdict("Cargo por sobregiro", 5001)).toBe("translated_copy");
    expect(translatedCopyVerdict("Cargo por sobregiro", null)).toBe("kept_spanish_only");
    expect(translatedCopyVerdict("Overdraft Fee", 5001)).toBe("kept_english_name");
  });
});

describe("findTranslatedCopies", () => {
  it("matches M&T's twinned Spanish rows and keeps the Spanish-only and English-named ones", () => {
    const found = findTranslatedCopies(ROWS);
    expect(found.checked).toBe(4);
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual([145043, 145047]);
    expect(found.matches[1].reason).toBe("translated_copy: #33498 twin #5001");
    expect(found.keptSpanishOnly).toBe(1);
    expect(found.keptEnglishName).toBe(1);
    expect(found.passing.sort()).toEqual([145050, 67077].sort());
  });
});

describe("translatedCopyRowsSql (v2)", () => {
  it("never pairs a fee with no dollar amount (a percent fee)", async () => {
    const db = dbFor([]);
    await recheckTranslatedCopies(asDb(db), { runId: 7, dryRun: true });
    const read = texts(db).find((text) => text.includes("FROM source_documents sd")) ?? "";
    expect(read).toContain("AND fp.amount IS NOT NULL");
    expect(read).toContain("AND other.amount = fp.amount");
    expect(read).not.toContain("IS NOT DISTINCT FROM");
  });
});

describe("recheckTranslatedCopies", () => {
  it("is on (James, 2026-10-18)", () => {
    expect(TRANSLATED_COPY_TAKEDOWN_LIVE).toBe(true);
  });

  it("switched off, it reports and writes only its event", async () => {
    const db = dbFor(ROWS);
    const result = await recheckTranslatedCopies(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: false });
    expect(result.matched).toBe(2);
    expect(result.takenDown).toEqual([]);
    const writes = texts(db).filter((text) => text.includes("UPDATE") || text.includes("INSERT"));
    expect(writes).toHaveLength(1);
    expect(JSON.stringify(db.mock.calls)).toContain(TRANSLATED_COPY_CHECK);
  });

  it("by default (switch on), a first look flags the fee and archives nothing", async () => {
    const db = dbFor(ROWS);
    const result = await recheckTranslatedCopies(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result.live).toBe(true);
    expect(result.matched).toBe(2);
    expect(result.takenDown).toEqual([]);
    expect(texts(db).some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
  });

  it("a dry run writes nothing at all, even switched on", async () => {
    const db = dbFor(ROWS);
    await recheckTranslatedCopies(asDb(db), { runId: 7, dryRun: true, live: true });
    expect(texts(db).some((text) => text.includes("UPDATE") || text.includes("INSERT"))).toBe(false);
  });

  it("switched on, a fee whose first look is older than 12 hours is archived and logged", async () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const db = dbFor(ROWS, {
      flags: [{ fee_published_id: "145047", kind: "takedown_pending", evidence: { flag_run_id: 3, flagged_at: "2026-10-18T12:00:00Z", reason: "translated_copy: #33498 twin #5001" } }],
    });
    const result = await recheckTranslatedCopies(asDb(db), { runId: 8, stepId: 80, dryRun: false, live: true, now });
    expect(result.takenDown).toEqual([145047]);
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    expect(update?.[1]).toBe("darwin-translated-copy-8");
    expect(texts(db).some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
    expect(JSON.stringify(db.mock.calls)).toContain("darwin.translated_copy_takedown");
  });

  it("a failed read reports nothing checked and writes nothing", async () => {
    const db = vi.fn(() => Promise.reject(new Error("timeout")));
    const result = await recheckTranslatedCopies(asDb(db as DbMock), { runId: 7, dryRun: false, live: true });
    expect(result.checked).toBe(0);
  });
});

// #1986: an archived Spanish fee, in the state the takedown left it, whose named twin is down.
const ES_TEXT = "Cargos por servicios\nCargo por sobregiro $15.00 por partida\nCargo por cheque oficial $10.00";
function archived(overrides: Partial<TranslatedCopyRestoreRow> = {}): TranslatedCopyRestoreRow {
  return {
    fee_published_id: "145047", fee_verified_id: "9001", institution_id: "21", fee_name: "Cargo por sobregiro", amount: "15",
    canonical_fee_key: "overdraft", rolled_back_reason: "translated_copy: #33498 twin #68605", source_document_id: "33498",
    own_state_clean: true, other_takedown: null, named_twin_id: "68605", named_twin_live: false,
    named_twin_reason: "source_check: amount_not_in_text", english_twin_id: null, english_waiting_id: null, same_fee_live_id: null, newest_text: ES_TEXT,
    ...overrides,
  };
}

describe("translatedCopyRestoreVerdict (#1986)", () => {
  it("restores a Spanish fee whose English twin came down and that its own document still states", () => {
    expect(translatedCopyRestoreVerdict(archived())).toBe("restore");
  });

  it("keeps it down while the named twin is live, or any other English line of it is live or waiting", () => {
    expect(translatedCopyRestoreVerdict(archived({ named_twin_live: true }))).toBe("twin_live");
    expect(translatedCopyRestoreVerdict(archived({ english_twin_id: "70001" }))).toBe("english_twin_live");
    expect(translatedCopyRestoreVerdict(archived({ english_waiting_id: "65446" }))).toBe("english_twin_waiting");
  });

  it("keeps it down when any other live fee, another Spanish copy included, has its category and price", () => {
    expect(translatedCopyRestoreVerdict(archived({ same_fee_live_id: "145990" }))).toBe("same_fee_live");
  });

  it("keeps it down when another rule took it down too", () => {
    expect(translatedCopyRestoreVerdict(archived({ own_state_clean: false }))).toBe("other_takedown");
    expect(translatedCopyRestoreVerdict(archived({ other_takedown: "hamilton.source_check" }))).toBe("other_takedown");
  });

  it("keeps it down when a newer copy of the schedule replaced the twin (OnPoint 64334, Oct 26)", () => {
    for (const reason of ["older_edition: #18549 dated 2026-10-01", "refreshed by #152577", "superseded by #9", "newer_copy_drops_fee: #1", "not_on_current_copy: #2"]) {
      expect(translatedCopyRestoreVerdict(archived({ named_twin_reason: reason }))).toBe("twin_replaced");
    }
  });

  it("keeps it down when its own document's newest read no longer states it", () => {
    expect(translatedCopyRestoreVerdict(archived({ newest_text: "Cargo por sobregiro $25.00 por partida" }))).toBe("not_on_own_document");
    expect(translatedCopyRestoreVerdict(archived({ newest_text: null }))).toBe("no_text");
    expect(translatedCopyRestoreVerdict(archived({ amount: null }))).toBe("no_amount");
  });

  it("counts the kept ones by verdict", () => {
    const judged = judgeTranslatedCopyRestores([
      archived(),
      archived({ fee_published_id: "145043", named_twin_live: true }),
      archived({ fee_published_id: "64334", named_twin_reason: "older_edition: #18549 dated 2026-10-01" }),
    ]);
    expect(judged.archived).toBe(3);
    expect(judged.restorable.map((fee) => fee.feePublishedId)).toEqual([145047]);
    expect(judged.kept).toEqual({ twin_live: 1, twin_replaced: 1 });
  });
});

describe("the restore in recheckTranslatedCopies (#1986)", () => {
  it("is off until a dry run's sample checks clean (DECISIONS 2026-10-20)", () => {
    expect(TRANSLATED_COPY_RESTORE_LIVE).toBe(false);
  });

  it("switched off, it reports what it would restore and writes no restore", async () => {
    const db = dbFor([], { archived: [archived()] });
    const result = await recheckTranslatedCopies(asDb(db), { runId: 9, stepId: 90, dryRun: false, live: false });
    expect(result.restore.restorable.map((fee) => fee.feePublishedId)).toEqual([145047]);
    expect(result.restore.restored).toEqual([]);
    expect(texts(db).some((text) => text.includes("WITH eligible AS"))).toBe(false);
  });

  it("a dry run restores nothing, even switched on", async () => {
    const db = dbFor([], { archived: [archived()] });
    const result = await recheckTranslatedCopies(asDb(db), { runId: 9, dryRun: true, live: false, restoreLive: true });
    expect(result.restore.restored).toEqual([]);
    expect(texts(db).some((text) => text.includes("UPDATE") || text.includes("INSERT"))).toBe(false);
  });

  it("switched on, restores the fee with its verified row, clears its second look and logs it", async () => {
    const db = dbFor([], { archived: [archived()] });
    const result = await recheckTranslatedCopies(asDb(db), { runId: 9, stepId: 90, dryRun: false, live: false, restoreLive: true });
    expect(result.restore.restored).toEqual([145047]);
    const all = JSON.stringify(db.mock.calls);
    expect(all).toContain("rules_recheck_restored:translated_copy_twin_gone");
    expect(all).toContain("hamilton.second_look:darwin.translated_copy:pub:145047");
    expect(all).toContain("takedown_cleared");
    expect(all).toContain("darwin.translated_copy_restored");
    // The write re-checks every condition, not only the fee's own state (review of #2707).
    const write = texts(db).find((text) => text.includes("WITH eligible AS")) ?? "";
    expect(write.match(/NOT EXISTS \(SELECT 1 \?\)/g)).toHaveLength(4);
  });
});
