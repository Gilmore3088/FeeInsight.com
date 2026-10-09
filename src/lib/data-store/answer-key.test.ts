import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { banksToCheck, isPersonChecked, normalizeFeeAmount, parseAnswerKeyPrefill } from "./answer-key";

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
});
