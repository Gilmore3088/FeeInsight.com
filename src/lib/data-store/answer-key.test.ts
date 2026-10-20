import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { banksToCheck, confirmAnswerKeyInstitution, feeCheckedBy, isPersonChecked, listScoreboardSnapshots, normalizeFeeAmount, parseAnswerKeyPrefill, seriesBreaks } from "./answer-key";

describe("normalizeFeeAmount", () => {
  it("derives the amount kind when it is missing", () => {
    expect(normalizeFeeAmount(32, undefined)).toEqual({ amount: 32, amount_kind: "fixed" });
    expect(normalizeFeeAmount("$1,000.50", undefined)).toEqual({ amount: 1000.5, amount_kind: "fixed" });
    expect(normalizeFeeAmount(0, undefined)).toEqual({ amount: 0, amount_kind: "free" });
    expect(normalizeFeeAmount(null, undefined)).toEqual({ amount: null, amount_kind: "varies" });
    expect(normalizeFeeAmount(12, "varies")).toEqual({ amount: null, amount_kind: "varies" });
  });

  it("rejects a fixed fee without an amount and negative amounts", () => {
    expect(normalizeFeeAmount(null, "fixed")).toEqual({ error: "a fixed fee needs an amount" });
    expect(normalizeFeeAmount(-1, undefined)).toHaveProperty("error");
  });
});

describe("parseAnswerKeyPrefill", () => {
  it("keeps valid rows and reports bad ones", () => {
    const parsed = parseAnswerKeyPrefill({
      version: 1,
      institutions: [
        {
          institution_id: 5,
          institution_name: "Example",
          document_url: "https://example.com/fees.pdf",
          document_type: "text_pdf",
          fees: [
            { canonical_key: "overdraft", amount: 32, source_line: "Overdraft $32.00" },
            { canonical_key: "not_a_key", amount: 5 },
            { canonical_key: "nsf", amount: null, amount_kind: "fixed" },
            { canonical_key: "estatement_fee", amount: 0, uncertain: true },
          ],
        },
        { institution_id: 5, document_url: "x", document_type: "html", fees: [] },
      ],
    });
    expect(parsed.institutions).toHaveLength(1);
    expect(parsed.institutions[0]).toMatchObject({ institution_id: 5, document_type: "text_pdf", content_hash: null });
    expect(parsed.institutions[0].fees).toEqual([
      { canonical_key: "overdraft", amount: 32, amount_kind: "fixed", frequency: null, conditions: null, source_line: "Overdraft $32.00", uncertain: false },
      { canonical_key: "estatement_fee", amount: 0, amount_kind: "free", frequency: null, conditions: null, source_line: null, uncertain: true },
    ]);
    expect(parsed.errors).toHaveLength(3);
  });

  it("rejects a file that is not version 1", () => {
    expect(parseAnswerKeyPrefill({ institutions: [] }).errors[0]).toMatch(/version 1/);
    expect(parseAnswerKeyPrefill({ version: 1, institutions: [{ institution_id: 1, document_url: "u", document_type: "docx" }] }).institutions).toEqual([]);
  });
});

describe("person-checked answer keys", () => {
  const bank = (id: number, status: "confirmed" | "prefilled", confirmed_by: string | null, fee_count: number) => ({ id, status, confirmed_by, fee_count });

  it("never counts a key a Claude thread confirmed as checked by a person (Oct 8)", () => {
    expect(isPersonChecked(bank(1, "confirmed", "knox-hand-key", 14))).toBe(false);
    expect(isPersonChecked(bank(2, "confirmed", "james", 14))).toBe(true);
    expect(isPersonChecked(bank(3, "prefilled", null, 14))).toBe(false);
  });

  it("queues every bank a person still has to check, shortest key first", () => {
    const rows = [bank(1, "confirmed", "knox-hand-key", 38), bank(2, "confirmed", "james", 5), bank(3, "prefilled", null, 21), bank(4, "confirmed", "knox-hand-key", 14)];
    expect(banksToCheck(rows).map((row) => row.id)).toEqual([4, 3, 1]);
  });

  it("a person's bank-level confirm covers rows a Claude thread keyed, so nobody re-presses Confirm", () => {
    expect(feeCheckedBy("knox-hand-key", { status: "confirmed", confirmed_by: "hello@bankfeeindex.com" })).toBe("hello@bankfeeindex.com");
    expect(feeCheckedBy("knox-hand-key", { status: "confirmed", confirmed_by: "knox-hand-key" })).toBe("knox-hand-key");
    expect(feeCheckedBy("knox-hand-key", { status: "prefilled", confirmed_by: null })).toBe("knox-hand-key");
    expect(feeCheckedBy("james", { status: "confirmed", confirmed_by: "hello@bankfeeindex.com" })).toBe("james");
  });

  it("Confirm all re-stamps rows a Claude thread keyed to the person, not only unconfirmed rows (#629)", async () => {
    const queries: { text: string; values: unknown[] }[] = [];
    const tx = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ text: strings.join("?"), values });
      return [];
    });
    const db = { begin: async (fn: (tx: unknown) => Promise<void>) => fn(tx) };
    await confirmAnswerKeyInstitution(12, "hello@bankfeeindex.com", db as never);
    const feeUpdate = queries[0];
    expect(feeUpdate.text).toContain("UPDATE answer_key_fees");
    expect(feeUpdate.text).toContain("confirmed_by = ANY(");
    expect(feeUpdate.text).not.toContain("COALESCE(confirmed_by");
    expect(feeUpdate.values).toEqual(["hello@bankfeeindex.com", 12, ["knox-hand-key"]]);
    expect(queries[1].text).toContain("UPDATE answer_key_institutions");
  });
});

describe("scoreboard snapshots and the answer-key scorer version (#1354)", () => {
  it("starts a new run of a trend wherever the scorer version changes", () => {
    expect(seriesBreaks([1, 1, 3, 3, null, 3])).toEqual([
      { start: 0, key: 1 },
      { start: 2, key: 3 },
    ]);
    // A day with no version does not split one version's run in two.
    expect(seriesBreaks([null, 3, null, 3])).toEqual([{ start: 1, key: 3 }]);
  });

  it("reads the version from the snapshot, else from the score run it names", async () => {
    const db = vi.fn(async () => [
      { snapshot_day: "2026-10-13", accuracy_recall: "0.575", accuracy_score_run_id: 7, run_scorer_version: 1, detail: {} },
      { snapshot_day: "2026-10-14", accuracy_recall: "0.53", accuracy_score_run_id: 9, run_scorer_version: 3, detail: { accuracy_scorer_version: 3 } },
      { snapshot_day: "2026-10-15", accuracy_recall: null, accuracy_score_run_id: null, run_scorer_version: null, detail: {} },
    ]);
    const rows = await listScoreboardSnapshots(30, db as never);
    expect(rows.map((row) => row.legacy_accuracy_recall)).toEqual([0.575, 0.53, null]);
    expect(rows.map((row) => [row.snapshot_date, row.accuracy_recall, row.accuracy_scorer_version])).toEqual([
      ["2026-10-13", null, 1],
      ["2026-10-14", null, 3],
      ["2026-10-15", null, null],
    ]);
  });
});
