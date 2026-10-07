import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ANSWER_KEY_TEXTS,
  scoreChunks,
  scoreClaim,
  verdictFromRow,
  type StoredVerdict,
} from "./verdict-score";

type Fee = [string, number | null, string];

const prosperity: Fee[] = [
  ["atm_non_network", 3, "ATM/Debit Transactions, off premises, each transaction......... $3"],
  ["continuous_od", 3, "Business Overdraft (negative balance), per business day......... $3"],
  ["account_research", 27.5, "Account Balancing Assistance, per hour......... $27.50"],
  ["early_closure", 27.5, "Account Closed within 90 Days of Opening......... $27.50"],
  ["card_replacement", 5, "Replace lost ATM or Debit Card......... $5"],
  ["notary_fee", 5, "Notary Service......... $5"],
];
const rally: Fee[] = [["bill_pay", 0, "Bill Payment Monthly Fee (Non-Business Accounts) | FREE"]];
const rabun: Fee[] = [
  ["wire_domestic_outgoing", 20, "Wire Transfer Fee – Outgoing | $20.00"],
  ["wire_intl_incoming", 20, "Wire Transfer Fee – International Incoming | $20.00"],
];

describe("Darwin verdict score", () => {
  it("scores claims the way the 2026-10-07 hand scoring did", () => {
    // Right: the key has this fee, at this amount, in this category.
    expect(scoreClaim({ feeName: "Wire Transfer Fee – International Incoming", amount: 20, isFee: true, category: "wire_intl_incoming" }, rabun).result).toBe("right");
    expect(scoreClaim({ feeName: "ATM or Debit Card", amount: 5, isFee: true, category: "card_replacement" }, prosperity).result).toBe("right");
    // Right: a balance limit the key has no fee for, and a free service.
    expect(scoreClaim({ feeName: "Teen Accounts: You may not exceed", amount: 500, isFee: false, category: null }, prosperity).result).toBe("right");
    expect(scoreClaim({ feeName: "Bill Payment Monthly Fee", amount: 0, isFee: false, category: null }, rally).result).toBe("right");
    // Wrong: a price the key does not have, and a related line in another category.
    expect(scoreClaim({ feeName: "Account Inactivity Fee balance is less than", amount: 50, isFee: true, category: "dormant_account" }, rally).result).toBe("wrong");
    const knox = scoreClaim({ feeName: "Wire Transfer Fee – International Incoming", amount: 20, isFee: true, category: "wire_domestic_incoming" }, rabun);
    expect(knox).toMatchObject({ result: "wrong", keySays: ["wire_domestic_outgoing", "wire_intl_incoming"] });
    // Unclear: same amount, nothing in the key's lines relates to the name.
    expect(scoreClaim({ feeName: "Check Printing (Fee depends on style)", amount: 3, isFee: true, category: "check_printing" }, prosperity).result).toBe("unclear");
  });

  it("cuts verdicts into chunks of decided verdicts and leaves a partial chunk for later", () => {
    const keys = new Map([[1, [{ tid: 9, set: "holdout", fees: rabun }]]]);
    const verdict = (attemptId: number, category: string): StoredVerdict => ({
      attemptId,
      strategy: "verify.adjudicate",
      version: 2,
      institutionId: 1,
      sourceDocumentId: null,
      feeRawId: attemptId,
      feeName: "Wire Transfer Fee – International Incoming",
      amount: 20,
      knoxKey: "wire_domestic_incoming",
      claim: { feeName: "Wire Transfer Fee – International Incoming", amount: 20, isFee: true, category },
    });
    const verdicts = [verdict(1, "wire_intl_incoming"), verdict(2, "wire_domestic_incoming"), verdict(3, "wire_intl_incoming"), { ...verdict(4, "x"), institutionId: 2 }, verdict(5, "wire_intl_incoming")];
    const chunks = scoreChunks(verdicts, keys, 2);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ fromAttemptId: 1, toAttemptId: 2, right: 1, wrong: 1, knoxRight: 0, holdoutWrong: 1 });
    expect(chunks[0].misses[0].verdict.attemptId).toBe(2);
    expect(chunks[1]).toMatchObject({ fromAttemptId: 3, toAttemptId: 5, right: 2 });
  });

  it("reads a release review's pass as a fee in its held category and skips a plain fail", () => {
    const row = (detail: Record<string, unknown>) => ({ id: 7, strategy: "verify.release_review", strategy_version: 6, institution_id: 1, source_document_id: 3, detail: { fee_raw_id: 11, fee_name: "Notary", amount: 5, canonical_fee_key: "notary_fee", ...detail } });
    expect(verdictFromRow(row({ passes: true }))?.claim).toEqual({ feeName: "Notary", amount: 5, isFee: true, category: "notary_fee" });
    expect(verdictFromRow(row({ passes: false, amount_is_price: false }))?.claim.isFee).toBe(false);
    expect(verdictFromRow(row({ passes: false, is_fee: true, amount_is_price: true }))).toBeNull();
  });

  it("keeps the compact answer keys in step with the hand-keyed fixtures", () => {
    const fixtures = ["state", "texas"].flatMap((name) => {
      const file = path.join(__dirname, "../knox/__fixtures__", `${name}-answer-keys.json.gz`);
      return (JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as { keys: Array<{ tid: number; fees: Array<{ key: string; amount: number | null }> }> }).keys;
    });
    expect(ANSWER_KEY_TEXTS.map((text) => text.tid)).toEqual(fixtures.map((key) => key.tid));
    expect(ANSWER_KEY_TEXTS.map((text) => text.fees.map(([key, amount]) => [key, amount]))).toEqual(
      fixtures.map((key) => key.fees.map((fee) => [fee.key, fee.amount])),
    );
  });
});
