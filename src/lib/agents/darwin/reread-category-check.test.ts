import { describe, expect, it } from "vitest";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import {
  REREAD_CATEGORY_RECHECK_LIVE,
  REREAD_CATEGORY_ROWS_SQL,
  findRereadCategoryMoves,
  judgeRereadCategory,
  rereadCategoryDetail,
  rereadCategoryMessage,
  twinsToArchive,
  type RereadCategoryRow,
  type RereadCategoryVerdict,
} from "./reread-category-check";

// #1513: each bank's stored text around the fee's line (agent_source_texts, prod, read-only, Oct 26).
// Local 804 FCU (inst 6643, text 24713), live 128668.
const LOCAL_804 = "It will cover purchases of up to $500 over your available account balance for just $25 per occurrence. Local 804 FCU will only charge your account for five (5) items per business day. There is a grace period of 14 days to correct a negative balance. After the 14-day grace period, there will be a Negative Balance Fee of $2.00 per day. For ATM and Debit Card transactions ONLY, when funds are available in your savings, there will be a $1 Overdraft Transfer Fee.";
// First Interstate (inst 79, text 14767), live 85754.
const FIRST_INTERSTATE = "Review transactions via Online Banking and Day & Night Telephone Banking.\n\nYou will be assessed a $10 Excess Withdrawal Fee for each transfer or withdrawal after six (6) of the following transaction types in a service charge cycle:\nWithdrawals or Transfers to another account of yours or to a third party by means of pre-authorized or automatic transfer, or made by telephone (including data transmission), computer, check, draft, debit card, or similar order (including POS transactions) to a third party.\nThe fee will not apply to transactions made in person, at an ATM, or by mail.";
// Ripco (inst 8082, text 5408), live 35970.
const RIPCO = [
  "Dormant Account (Per Month) | $10.00 Safe Deposit Box Fees",
  "Any account with aggregate share balances of $500.00 or less, and no member | 3x5x21” per year | $20.00",
  "initiated activity on any share under that member number for the previous 12",
  "months, shall be considered dormant, and a fee will be assessed on each share. | 3x10x21” per year | $30.00",
  "Accounts where the primary owner is under age 18 are exempt. IRAs, HSAs,",
].join("\n");
// Library of Congress FCU (inst 4390, text 13450), live 60485.
const LOC_FCU = "Your account is in good standing if you (1) demonstrate responsible account management such as making regular deposits to bring your account to a positive balance at least once every 30 days (including the payment of all credit union fees and charges); (2) avoid excessive overdrafts suggesting the use of Member Privilege as a continuing line of credit, and (3) there are no legal orders, levies or liens against your account. Please note that the amount of the overdraft plus our standard NSF fee of $28 for each item will be deducted from your overdraft limit. No interest will be charged on the overdraft balance.";

const LOCAL_804_FRAGMENT = "For ATM and Debit Card transactions ONLY, when funds are available in your savings, there will be a";
const RIPCO_FRAGMENT = "months, shall be considered dormant, and a fee will be assessed on each share. | 3x10x21” per year";

function row(overrides: Partial<RereadCategoryRow>): RereadCategoryRow {
  return {
    fee_published_id: 1,
    fee_verified_id: 11,
    institution_id: 100,
    fee_name: "",
    amount: 1,
    canonical_fee_key: "atm_non_network",
    source_document_id: 1000,
    fragment_name: "",
    document_text_id: 1,
    normalized_text: "",
    same_amount: [],
    ...overrides,
  };
}

const local804 = row({ fee_published_id: 128668, institution_id: 6643, fee_name: LOCAL_804_FRAGMENT, fragment_name: LOCAL_804_FRAGMENT, amount: "1.00", canonical_fee_key: "atm_non_network", document_text_id: 24713, normalized_text: LOCAL_804 });
const firstInterstate = row({
  fee_published_id: 85754, institution_id: 79, fee_name: "You will be assessed a", fragment_name: "You will be assessed a", amount: "10.00", canonical_fee_key: "account_research", document_text_id: 14767, normalized_text: FIRST_INTERSTATE,
  same_amount: [{ fee_published_id: 32871, fee_name: "Dormant Account Fee", canonical_fee_key: "dormant_account" }],
});
const ripco = row({
  fee_published_id: 35970, institution_id: 8082, fee_name: RIPCO_FRAGMENT, fragment_name: RIPCO_FRAGMENT, amount: "30.00", canonical_fee_key: "dormant_account", document_text_id: 5408, normalized_text: RIPCO,
  same_amount: JSON.stringify([
    { fee_published_id: 85485, fee_name: "3x10x21” per year", canonical_fee_key: "safe_deposit_box" },
    { fee_published_id: 158740, fee_name: "Safe Deposit Box 3x10x21” per year", canonical_fee_key: "safe_deposit_box" },
  ]),
});
const locFcu = row({
  fee_published_id: 60485, institution_id: 4390, fee_name: "Please note that the amount of the overdraft plus our standard NSF fee of", fragment_name: "Please note that the amount of the overdraft plus our standard NSF fee of",
  amount: "28.00", canonical_fee_key: "overdraft", document_text_id: 13450, normalized_text: LOC_FCU,
  same_amount: [{ fee_published_id: 18066, fee_name: "NSF fee", canonical_fee_key: "nsf" }],
});

const judge = (fee: RereadCategoryRow) => findRereadCategoryMoves([fee]).verdicts[0];

function candidate(feeName: string, amount: number, canonicalHint: string, excerpt: string): ExtractedFeeCandidate {
  return { feeName, amount, canonicalHint, excerpt, frequency: null, confidence: 0.9, waivable: false };
}

describe("Darwin's re-read category re-check (#1513)", () => {
  it("ships with its switch off", () => {
    expect(REREAD_CATEGORY_RECHECK_LIVE).toBe(true);
  });

  it("re-files Local 804's $1 under the overdraft transfer its sentence ends on (128668)", () => {
    const verdict = judge(local804);
    expect(verdict.outcome).toBe("refile");
    expect(verdict.newKey).toBe("od_protection_transfer");
    expect(verdict.newName).toBe("Overdraft Transfer Fee (For ATM and Debit Card transactions ONLY, when funds are available in your savings)");
    expect(verdict.sourceLine).toContain("$1 Overdraft Transfer Fee");
  });

  it("re-files First Interstate's $10 as its excess withdrawal fee (85754)", () => {
    const verdict = judge(firstInterstate);
    expect(verdict).toMatchObject({ outcome: "refile", newKey: "excess_withdrawal", newName: "Excess Withdrawal Fee" });
  });

  it("takes down Ripco's $30 box price live as a dormant fee, its box line being live already (35970)", () => {
    const verdict = judge(ripco);
    expect(verdict).toMatchObject({ outcome: "twin", newKey: "safe_deposit_box", twinFeePublishedId: 158740 });
    expect(verdict.reason).toBe("reread_category_twin: live fee #158740");
  });

  it("leaves an overdraft/NSF move to the paid-NSF convention (60485)", () => {
    const verdict = judge(locFcu);
    expect(verdict).toMatchObject({ outcome: "convention_pending", newKey: "nsf", newName: "NSF fee" });
  });

  it("judges only the fragment the request was about", () => {
    expect(judge({ ...local804, fee_name: "Overdraft Transfer Fee" }).outcome).toBe("stale");
    expect(judge({ ...local804, normalized_text: null }).outcome).toBe("no_text");
    expect(judge({ ...local804, amount: "2.00" }).outcome).toBe("not_found");
  });

  it("keeps a line any read still files under the live category", () => {
    const text = `Fee line A ${"x"} costs $5.00`;
    const fee = row({ fee_name: "Fee line A x", fragment_name: "Fee line A x", amount: 5, canonical_fee_key: "stop_payment", normalized_text: text });
    const verdict = judgeRereadCategory(fee, [
      candidate("Stop Payment Fee", 5, "wire_domestic_outgoing", "Fee line A x costs $5.00"),
      candidate("Fee line A x", 5, "stop_payment", "Fee line A x costs $5.00"),
    ]);
    expect(verdict.outcome).toBe("split_read");
  });

  it("keeps a line two proper reads disagree on, and a read the source check cannot trace", () => {
    const text = "Fee line B y costs $5.00";
    const fee = row({ fee_name: "Fee line B y", fragment_name: "Fee line B y", amount: 5, canonical_fee_key: "atm_non_network", normalized_text: text });
    expect(judgeRereadCategory(fee, [
      candidate("Stop Payment Fee", 5, "stop_payment", text),
      candidate("Paper Statement Fee", 5, "paper_statement", text),
    ]).outcome).toBe("ambiguous");
    const refused = judgeRereadCategory(fee, [candidate("Stop Payment Fee", 5, "stop_payment", text)]);
    expect(refused.outcome).toBe("refused");
    expect(refused.refusedBy).toMatch(/^source_check:/);
  });

  it("counts and reports without writing anything", () => {
    const found = findRereadCategoryMoves([local804, firstInterstate, ripco, locFcu]);
    expect(found).toMatchObject({ checked: 4, matched: 3, outcomes: { refile: 2, twin: 1, convention_pending: 1 } });
    const result = { ...found, live: false, dryRun: false, flagged: 0, waiting: 0, cleared: 0, refiled: [], takenDown: [] };
    expect(rereadCategoryMessage(result)).toContain("switch off, nothing written");
    expect(rereadCategoryDetail(result)).toMatchObject({ check: "darwin.reread_category", switch_live: false, matched: 3 });
  });

  it("reads only live fees whose re-read settled other_category", () => {
    expect(REREAD_CATEGORY_ROWS_SQL).toContain("res.evidence->>'outcome' = 'other_category'");
    expect(REREAD_CATEGORY_ROWS_SQL).toContain("'knox_reread_resolved'");
    expect(REREAD_CATEGORY_ROWS_SQL).toContain("fp.rolled_back_at IS NULL");
  });
});

describe("twin takedowns keep the line shown (#1513 review)", () => {
  const verdict = (id: number, outcome: "twin" | "refile", twin?: number): RereadCategoryVerdict => ({
    feePublishedId: id, feeVerifiedId: id * 10, institutionId: 1, sourceDocumentId: 1, amount: 5, canonicalFeeKey: "dormant_account",
    feeName: `fee ${id}`, outcome, newKey: "safe_deposit_box", newName: "Safe Deposit Box", reason: "r", ...(twin ? { twinFeePublishedId: twin } : {}),
  });

  it("holds back a twin pair and a twin whose twin is re-filed in the same pass", () => {
    const kept = twinsToArchive([verdict(1, "twin", 2), verdict(2, "twin", 1), verdict(3, "twin", 4), verdict(4, "refile"), verdict(5, "twin", 9)]);
    expect(kept.map((entry) => entry.feePublishedId)).toEqual([5]);
  });
});
