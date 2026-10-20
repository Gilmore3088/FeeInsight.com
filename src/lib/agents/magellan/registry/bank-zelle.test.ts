import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { isZelleListHost } from "@/lib/data-store/struck-sources";
import { BANK_ZELLE_MATCHER_VERSION } from "./bank-zelle-match";
import { BANK_ZELLE_BATCH_SIZE, BANK_ZELLE_STATEMENT_TIMEOUT, runRegistryBankZelle } from "./bank-zelle";
import type { RegistryDb } from "./partitions";

interface Call {
  text: string;
  values: unknown[];
  inTx: boolean;
}

/** A tagged-template stand-in for postgres.js: answers each query by its text, records every call. */
function fakeDb(answer: (text: string, values: unknown[]) => unknown[]) {
  const calls: Call[] = [];
  const make = (inTx: boolean) =>
    Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?");
        calls.push({ text, values, inTx });
        return Promise.resolve(answer(text, values));
      },
      { begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(make(true)) },
    );
  return { db: make(false) as unknown as RegistryDb, calls };
}

const texts = [
  { agent_source_text_id: 101, institution_id: 1, source_document_id: 11, url: "https://one.example/fees.pdf", text: "Send money with Zelle® in our app." },
  { agent_source_text_id: 102, institution_id: 1, source_document_id: 12, url: "https://one.example/rates.pdf", text: null },
  { agent_source_text_id: 201, institution_id: 2, source_document_id: 21, url: "https://two.example/fees.pdf", text: null },
  { agent_source_text_id: 301, institution_id: 3, source_document_id: 31, url: "https://www.zellepay.com/participants", text: "Zelle daily limit $500" },
  { agent_source_text_id: 401, institution_id: 4, source_document_id: 41, url: "https://four.example/faq", text: "We do not offer Zelle." },
];

function answer(cursorDetail: Record<string, unknown> | null, ids: number[]) {
  return (text: string) => {
    if (text.includes("FROM registry_ingest_partitions")) return cursorDetail ? [{ detail: cursorDetail }] : [];
    if (text.includes("FROM institution_sources")) return ids.map((id) => ({ id }));
    if (text.includes("FROM agent_source_texts")) return texts;
    if (text.includes("INSERT INTO institution_payment_features")) return [1, 1];
    if (text.includes("DELETE FROM institution_payment_features")) return [1];
    return [];
  };
}

describe("runRegistryBankZelle", () => {
  it("reads one bounded batch under a statement timeout and records where to start next", async () => {
    const ids = Array.from({ length: BANK_ZELLE_BATCH_SIZE }, (_, i) => i + 1);
    const { db, calls } = fakeDb(answer({ parser_version: BANK_ZELLE_MATCHER_VERSION, cursor: 0 }, ids));
    const r = await runRegistryBankZelle({ db, runId: 7, now: new Date("2026-10-18T00:00:00Z") });

    expect(r).toMatchObject({ institutionsRead: BANK_ZELLE_BATCH_SIZE, cursorFrom: 0, cursorTo: BANK_ZELLE_BATCH_SIZE, passFinished: false });
    expect(r).toMatchObject({ documentsRead: 5, documentsNamingZelle: 2, documentsSkipped: 1, offers: 1, doesNotOffer: 1, unclear: 0, written: 2, removed: 1 });

    // Every read and write runs inside a transaction that set the timeout first.
    const timeouts = calls.filter((c) => c.text.includes("set_config('statement_timeout'"));
    expect(timeouts).toHaveLength(2);
    expect(timeouts.every((c) => c.inTx && c.values[0] === BANK_ZELLE_STATEMENT_TIMEOUT)).toBe(true);
    for (const table of ["FROM institution_sources", "FROM agent_source_texts", "INSERT INTO institution_payment_features", "DELETE FROM institution_payment_features"]) {
      expect(calls.find((c) => c.text.includes(table))?.inTx, table).toBe(true);
    }
    expect(calls.find((c) => c.text.includes("FROM institution_sources"))?.values).toEqual([0, BANK_ZELLE_BATCH_SIZE]);

    // Rows carry the institution's own document; the Zelle site is never cited.
    const insert = calls.find((c) => c.text.includes("INSERT INTO institution_payment_features"))!;
    const rows = JSON.parse(String(insert.values.find((v) => typeof v === "string" && v.startsWith("[")))) as Array<Record<string, unknown>>;
    expect(rows.map((row) => [row.institution_id, row.status, row.evidence_url])).toEqual([
      [1, "offers", "https://one.example/fees.pdf"],
      [4, "does_not_offer", "https://four.example/faq"],
    ]);
    // Institutions with no mention (2, 3 and the rest of the batch) lose any stored row.
    const del = calls.find((c) => c.text.includes("DELETE FROM institution_payment_features"))!;
    expect((del.values[1] as number[]).slice(0, 2)).toEqual([2, 3]);

    const record = calls.find((c) => c.text.includes("INSERT INTO registry_ingest_partitions"))!;
    const detail = JSON.parse(String(record.values.find((v) => typeof v === "string" && v.includes("parser_version"))));
    expect(detail).toMatchObject({ parser_version: BANK_ZELLE_MATCHER_VERSION, cursor: BANK_ZELLE_BATCH_SIZE, pass_finished: false, pass_started_at: "2026-10-18T00:00:00.000Z" });
    expect(record.values).toContain(1); // next batch in an hour
  });

  it("finishes the pass on a short batch and waits a week", async () => {
    const { db, calls } = fakeDb(answer({ parser_version: BANK_ZELLE_MATCHER_VERSION, cursor: 900, pass_started_at: "2026-10-17T00:00:00.000Z" }, [901, 902]));
    const r = await runRegistryBankZelle({ db });
    expect(r).toMatchObject({ cursorFrom: 900, cursorTo: 0, passFinished: true });
    const record = calls.find((c) => c.text.includes("INSERT INTO registry_ingest_partitions"))!;
    expect(record.values).toContain(24 * 7);
  });

  it("starts again from the first institution when the rules changed", async () => {
    const { db, calls } = fakeDb(answer({ parser_version: BANK_ZELLE_MATCHER_VERSION - 1, cursor: 5000 }, [1]));
    await runRegistryBankZelle({ db });
    expect(calls.find((c) => c.text.includes("FROM institution_sources"))?.values[0]).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const { db, calls } = fakeDb(answer(null, [1, 4]));
    const r = await runRegistryBankZelle({ db, dryRun: true });
    expect(r).toMatchObject({ dryRun: true, offers: 1, doesNotOffer: 1, written: 0 });
    expect(calls.some((c) => /INSERT|DELETE/.test(c.text))).toBe(false);
  });
});

describe("isZelleListHost", () => {
  it("matches Zelle's own sites and their subdomains, and treats an unreadable URL as one", () => {
    expect(isZelleListHost("https://www.zellepay.com/get-started")).toBe(true);
    expect(isZelleListHost("https://earlywarning.com/x")).toBe(true);
    expect(isZelleListHost("not a url")).toBe(true);
    expect(isZelleListHost("https://www.bank.example/zellepay.com")).toBe(false);
    expect(isZelleListHost("https://notzellepay.com/")).toBe(false);
  });
});
