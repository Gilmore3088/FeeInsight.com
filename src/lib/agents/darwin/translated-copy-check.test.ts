import { describe, expect, it, vi } from "vitest";

import {
  TRANSLATED_COPY_CHECK,
  TRANSLATED_COPY_TAKEDOWN_LIVE,
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
function dbFor(rows: Array<Record<string, unknown>>, options: { flags?: Array<Record<string, unknown>> } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
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
