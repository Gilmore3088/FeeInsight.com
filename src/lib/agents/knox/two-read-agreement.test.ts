// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { sql } from "@/lib/data-store/connection";
import {
  checkTwoReadAgreement,
  foldExcerpt,
  pairVerdict,
  planTwoReadAgreement,
  sameReadLine,
  TWO_READ_AGREED_FLAG,
  TWO_READ_AGREEMENT_EVENT,
  TWO_READ_HOLD_FLAG,
  twoReadAgreementLive,
  twoReadAgreementNote,
  twoReadRowsSql,
  type TwoReadRow,
} from "./two-read-agreement";

/** A filed row waiting for Darwin; every value can be changed. */
function row(values: Partial<TwoReadRow> & Pick<TwoReadRow, "fee_raw_id" | "paid">): TwoReadRow {
  return {
    institution_id: 8078,
    source_document_id: 29531,
    fee_name: "Fee",
    amount: "10.00",
    category: "overdraft",
    excerpt: "A line long enough to compare with $10.00",
    product_name: null,
    pending: true,
    verified: false,
    live: false,
    held: false,
    agreed: false,
    ...values,
  };
}

// Dry run sample, Nov 2 (institution 8078, text 29531): one line, one price, two categories.
const OVERDRAFT_LINE = "Accounts will be charged the standard Overdraft fee of $32.00 for handling each overdraft created by checks, ACH";
const overdraftPair = (paid: Partial<TwoReadRow> = {}, free: Partial<TwoReadRow> = {}) => [
  row({ fee_raw_id: 667092, paid: true, fee_name: "Returned item fee", amount: "32.00", category: "nsf", excerpt: OVERDRAFT_LINE, ...paid }),
  row({ fee_raw_id: 667036, paid: false, fee_name: "Accounts will be charged the standard Overdraft fee of", amount: "32.00", category: "overdraft", excerpt: OVERDRAFT_LINE, ...free }),
];

describe("sameReadLine", () => {
  it("pairs equal lines and a long line inside a longer one", () => {
    expect(sameReadLine(foldExcerpt("LNB ATM Foreign Transaction fee $2.00."), foldExcerpt("LNB ATM Foreign Transaction fee $2.00."))).toBe(true);
    expect(sameReadLine(
      foldExcerpt("There is a Debit/ATM Card Replacement Card Fee of $10.00 per card."),
      foldExcerpt("* There is a Debit/ATM Card Replacement Card Fee of $10.00 per card."),
    )).toBe(true);
  });

  it("never pairs a short generic line that sits inside every row of a table (institution 8509)", () => {
    expect(sameReadLine(foldExcerpt("Fees & Charges / $5.00"), foldExcerpt("Paper Statement Fees & Charges $5.00"))).toBe(false);
    expect(sameReadLine(foldExcerpt("$5"), foldExcerpt("$5"))).toBe(false);
  });
});

describe("pairVerdict", () => {
  it("agrees, disagrees on category or amount, and leaves two fees on one line alone", () => {
    const base = { amount: 10, category: "nsf", product: null };
    expect(pairVerdict(base, base)).toBe("agree");
    expect(pairVerdict(base, { ...base, category: "overdraft" })).toBe("category");
    expect(pairVerdict(base, { ...base, amount: 1000 })).toBe("amount");
    expect(pairVerdict(base, { ...base, amount: 5, category: "overdraft" })).toBeNull();
  });

  it("treats categories equal under the shared equivalence as one category (v2)", () => {
    // "$10 fee if balance below $1,000": minimum balance to one reader, monthly maintenance to the other.
    const minimum = { amount: 10, category: "minimum_balance", product: null };
    const maintenance = { amount: 10, category: "monthly_maintenance", product: null };
    expect(pairVerdict(minimum, maintenance)).toBe("agree");
    expect(pairVerdict(maintenance, minimum)).toBe("agree");
    // Same equivalent category at another amount for one account is still an amount disagreement.
    expect(pairVerdict(minimum, { ...maintenance, amount: 12 })).toBe("amount");
  });

  it("keeps a non-equivalent category pair a disagreement", () => {
    expect(pairVerdict({ amount: 10, category: "minimum_balance", product: null }, { amount: 10, category: "account_research", product: null })).toBe("category");
    expect(pairVerdict({ amount: 32, category: "overdraft", product: null }, { amount: 32, category: "nsf", product: null })).toBe("category");
  });

  it("reads two accounts' prices on one line as two fees, not an amount disagreement", () => {
    // "Monthly fee | $3 | None | $10 | $5" (institution 395): one row per account.
    expect(pairVerdict({ amount: 10, category: "monthly_maintenance", product: "money market" }, { amount: 3, category: "monthly_maintenance", product: "savings" })).toBeNull();
    expect(pairVerdict({ amount: 10, category: "monthly_maintenance", product: "money market" }, { amount: 3, category: "monthly_maintenance", product: null })).toBeNull();
  });
});

describe("planTwoReadAgreement", () => {
  it("holds both pending rows of a category disagreement", () => {
    const plan = planTwoReadAgreement(overdraftPair());
    expect(plan.byKind).toEqual({ category: 1, amount: 0 });
    expect(plan.hold).toEqual([667036, 667092]);
    expect(plan.agree).toEqual([]);
    expect(plan.paidPaired).toBe(1);
    expect(plan.paidDisagreed).toBe(1);
  });

  it("holds an amount disagreement on one line: a balance threshold read as the fee (institution 5316)", () => {
    const line = "For High Yield Savings, a $2.00 monthly service charge is applied to balances less than $1,000.00.";
    const plan = planTwoReadAgreement([
      row({ fee_raw_id: 175429, paid: true, amount: "2.00", category: "monthly_maintenance", excerpt: line }),
      row({ fee_raw_id: 112124, paid: false, amount: "1000.00", category: "monthly_maintenance", excerpt: line }),
    ]);
    expect(plan.byKind.amount).toBe(1);
    expect(plan.hold).toEqual([112124, 175429]);
  });

  it("records agreement on both rows and holds nothing", () => {
    const plan = planTwoReadAgreement(overdraftPair({ category: "overdraft" }));
    expect(plan.paidAgreed).toBe(1);
    expect(plan.agree).toEqual([667036, 667092]);
    expect(plan.hold).toEqual([]);
    expect(planTwoReadAgreement(overdraftPair({ category: "overdraft", agreed: true }, { agreed: true })).agree).toEqual([]);
  });

  it("does not hold a row that agrees with another read of the line (a line priced for two fees)", () => {
    const line = "Overdraft Fee, NSF fee for check or ACH item – $20 per occurrence";
    const plan = planTwoReadAgreement([
      row({ fee_raw_id: 1, paid: true, amount: "20", category: "nsf", excerpt: line }),
      row({ fee_raw_id: 2, paid: true, amount: "20", category: "overdraft", excerpt: line }),
      row({ fee_raw_id: 3, paid: false, amount: "20", category: "overdraft", excerpt: line }),
    ]);
    // Paid NSF meets free overdraft at one price, but free overdraft agrees with paid overdraft.
    expect(plan.hold).toEqual([]);
    expect(plan.byKind).toEqual({ category: 0, amount: 0 });
    expect(plan.agree).toEqual([2, 3]);
  });

  it("never changes a verified or live row: it counts them", () => {
    const plan = planTwoReadAgreement(overdraftPair(
      { pending: false, verified: true, live: true },
      { pending: false, verified: true, live: false },
    ));
    expect(plan.hold).toEqual([]);
    expect(plan.liveInDisagreement).toEqual([667092]);
    expect(plan.verifiedInDisagreement).toEqual([667036]);
  });

  it("releases a held row whose disagreement no longer stands, and keeps one that still does", () => {
    const stillHeld = overdraftPair({ held: true, pending: false }, { held: true, pending: false });
    expect(planTwoReadAgreement(stillHeld).release).toEqual([]);
    expect(planTwoReadAgreement(stillHeld).hold).toEqual([]);
    // The free row was retired by a re-read: the paid row is alone again.
    expect(planTwoReadAgreement(stillHeld.slice(0, 1)).release).toEqual([667092]);
  });

  it("never releases a row held for another reason too, and compares it with nothing (review of gap 4)", () => {
    // Held by this check, then Knox's promotion re-check withdrew it as unclassified (canonical_hint=none).
    const [paid, free] = overdraftPair();
    const withdrawn = { ...paid, category: "none", held: true, pending: false, other_hold: true };
    const plan = planTwoReadAgreement([withdrawn, free]);
    expect(plan.release).toEqual([]);
    expect(plan.hold).toEqual([]);
    expect(plan.paidRows).toBe(0);
    // Even alone on its text, it stays held.
    expect(planTwoReadAgreement([withdrawn]).release).toEqual([]);
  });

  it("holds again a held row Knox's insert takeover sent back to Darwin", () => {
    // The takeover keeps knox_review:two_read_disagreement and re-adds needs_darwin_verification.
    const plan = planTwoReadAgreement(overdraftPair({ held: true, pending: true }, { held: true, pending: true }));
    expect(plan.hold).toEqual([667036, 667092]);
    expect(plan.release).toEqual([]);
  });

  it("releases a pending held row whose disagreement is gone, so its hold flag comes off", () => {
    expect(planTwoReadAgreement([overdraftPair({ held: true, pending: true })[0]]).release).toEqual([667092]);
  });

  it("puts the agreement flag on unverified rows only", () => {
    const plan = planTwoReadAgreement(overdraftPair({ category: "overdraft", pending: false, verified: true, live: true }));
    expect(plan.agree).toEqual([667036]);
  });

  it("compares nothing on a text only one reader read, or rows from different documents", () => {
    expect(planTwoReadAgreement([overdraftPair()[0]]).documentsWithTwoReads).toBe(0);
    const [paid, free] = overdraftPair();
    expect(planTwoReadAgreement([paid, { ...free, source_document_id: 1 }]).hold).toEqual([]);
  });

  it("skips rows without a category, an amount or a long enough excerpt", () => {
    expect(planTwoReadAgreement(overdraftPair({ category: null })).paidPaired).toBe(0);
    expect(planTwoReadAgreement(overdraftPair({ amount: null })).paidPaired).toBe(0);
    expect(planTwoReadAgreement(overdraftPair({ excerpt: "$32" }, { excerpt: "$32" })).paidPaired).toBe(0);
  });
});

describe("twoReadAgreementLive", () => {
  it("is off unless set to 1 or true", () => {
    expect(twoReadAgreementLive({} as NodeJS.ProcessEnv)).toBe(false);
    expect(twoReadAgreementLive({ KNOX_TWO_READ_AGREEMENT_LIVE: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(twoReadAgreementLive({ KNOX_TWO_READ_AGREEMENT_LIVE: " \"True\" " } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(twoReadAgreementLive({ KNOX_TWO_READ_AGREEMENT_LIVE: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("twoReadRowsSql", () => {
  it("reads current texts' filed rows only, with no provider or archived table", () => {
    const text = twoReadRowsSql("", "$1");
    expect(text).toContain("superseded_by_id IS NULL");
    expect(text).toContain("knox_paid_extraction");
    expect(text).toContain(TWO_READ_HOLD_FLAG);
    expect(text).not.toMatch(/extracted_fees|fees_raw|crawl_/);
  });
});

type Call = { text: string; values: unknown[] };

function fakeDb(rows: TwoReadRow[]) {
  const calls: Call[] = [];
  const db = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      calls.push({ text, values });
      if (/UPDATE raw_fee_observations/.test(text)) return (values.find(Array.isArray) as number[]).map((id) => ({ fee_raw_id: id }));
      return [];
    },
    { unsafe: async (text: string, values: unknown[]) => { calls.push({ text, values }); return rows; } },
  );
  return { db: db as unknown as typeof sql, calls };
}

describe("checkTwoReadAgreement", () => {
  it("does nothing unscoped", async () => {
    const { db, calls } = fakeDb(overdraftPair());
    const result = await checkTwoReadAgreement(db, { runId: 1, dryRun: false, live: true });
    expect(calls).toEqual([]);
    expect(result.plan.documents).toBe(0);
  });

  it("switch off: reports on one event and changes no row", async () => {
    const { db, calls } = fakeDb(overdraftPair());
    const result = await checkTwoReadAgreement(db, { runId: 7, stepId: 9, dryRun: false, live: false, stateCode: "tx" });
    expect(result.dryRun).toBe(true);
    expect(result.plan.hold).toEqual([667036, 667092]);
    expect(result.held).toEqual([]);
    expect(calls.some((call) => /UPDATE/.test(call.text))).toBe(false);
    const event = calls.find((call) => /agent_run_events/.test(call.text));
    expect(event?.values).toContain(TWO_READ_AGREEMENT_EVENT);
    expect(calls[0].values).toContain("TX");
    expect(twoReadAgreementNote(result)).toContain("switch off, nothing written");
    expect(twoReadAgreementNote(result)).toContain("2 would be held");
  });

  it("a dry-run run writes nothing at all", async () => {
    const { db, calls } = fakeDb(overdraftPair());
    await checkTwoReadAgreement(db, { runId: 7, dryRun: true, live: true, institutionId: 8078 });
    expect(calls).toHaveLength(1);
  });

  it("switch on: holds the pending rows of a disagreement and flags an agreement", async () => {
    const agreeing = [
      row({ fee_raw_id: 10, paid: true, source_document_id: 2, excerpt: "LNB ATM Foreign Transaction fee $2.00.", amount: "2", category: "card_foreign_txn" }),
      row({ fee_raw_id: 11, paid: false, source_document_id: 2, excerpt: "LNB ATM Foreign Transaction fee $2.00.", amount: "2", category: "card_foreign_txn" }),
    ];
    const { db, calls } = fakeDb([...overdraftPair(), ...agreeing]);
    const result = await checkTwoReadAgreement(db, { runId: 7, dryRun: false, live: true, sourceDocumentIds: [29531, 2] });
    expect(result.held).toEqual([667036, 667092]);
    expect(result.agreedFlagged).toEqual([10, 11]);
    const hold = calls.find((call) => /UPDATE/.test(call.text) && call.values.includes(JSON.stringify([TWO_READ_HOLD_FLAG])));
    // The hold drops needs_darwin_verification and never doubles its own flag.
    expect(hold?.text).toMatch(/- 'needs_darwin_verification' - \?::text\)/);
    const agree = calls.find((call) => call.values.includes(JSON.stringify([TWO_READ_AGREED_FLAG])));
    expect(agree).toBeDefined();
    expect(calls.some((call) => /agent_run_events/.test(call.text))).toBe(true);
  });

  it("switch on: a release keeps any other knox_review hold and never doubles needs_darwin_verification", async () => {
    const { db, calls } = fakeDb([overdraftPair({ held: true, pending: false })[0]]);
    const result = await checkTwoReadAgreement(db, { runId: 7, dryRun: false, live: true, institutionId: 8078 });
    expect(result.released).toEqual([667092]);
    const release = calls.find((call) => /UPDATE/.test(call.text) && /\["needs_darwin_verification"\]/.test(call.text));
    expect(release?.text).toMatch(/- 'needs_darwin_verification'\)/);
    expect(release?.text).toMatch(/NOT EXISTS[\s\S]*LIKE 'knox_review:%'/);
  });

  it("reads documents with a row waiting and unverified, or held, newest paid read first", () => {
    const text = twoReadRowsSql("", "$1");
    expect(text).toMatch(/NOT EXISTS \(SELECT 1 FROM verified_fee_observations wv/);
    expect(text).toMatch(/ORDER BY work\.waiting DESC, paid_docs\.newest DESC/);
    expect(text).toContain("AS other_hold");
  });

  it("a failed read never throws", async () => {
    const db = Object.assign(async () => [], { unsafe: async () => { throw new Error("boom"); } }) as unknown as typeof sql;
    const result = await checkTwoReadAgreement(db, { runId: 1, dryRun: false, live: true, institutionId: 1 });
    expect(result.error).toBe("boom");
  });
});
