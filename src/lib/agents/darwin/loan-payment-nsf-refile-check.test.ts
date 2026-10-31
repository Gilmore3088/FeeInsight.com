// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";

// The second look confirms every failing fee at once, so the live path reaches its UPDATE.
vi.mock("@/lib/agents/hamilton/second-look", () => ({
  secondLook: async (_db: unknown, options: { failing: unknown[] }) => ({ flagged: 0, waiting: 0, confirmed: options.failing }),
}));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: () => undefined }));
import { LOAN_PAYMENT_NSF_REFILE_LIVE } from "@/lib/fee-category-guard";
import {
  findLoanPaymentNsf,
  loanPaymentNsfVerdict,
  recheckLoanPaymentNsf,
  type LoanPaymentNsfRow,
} from "./loan-payment-nsf-refile-check";

// The live NSF fees the check's read selects on prod, read-only, 2026-10-31 (Global FCU, institution 5005).
const rows: LoanPaymentNsfRow[] = [
  { fee_published_id: 67818, fee_verified_id: 79598, institution_id: 5005, fee_name: "From a Savings or Money Market Share or: » NSF mortgage payment: Additional Cenlar charge", amount: "25.00", canonical_fee_key: "nsf", lending_twin: false },
  { fee_published_id: 67831, fee_verified_id: 79612, institution_id: 5005, fee_name: "» NSF mortgage payment: Additional Cenlar charge", amount: "25.00", canonical_fee_key: "nsf", lending_twin: false },
];

function fakeDb() {
  const calls: string[] = [];
  const unsafe: string[] = [];
  const db = Object.assign(
    (strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      const text = strings.join("?");
      if (/SELECT fp\.fee_published_id/.test(text)) return Promise.resolve(rows);
      if (/UPDATE published_fee_records/.test(text)) return Promise.resolve(rows.map((row) => ({ fee_published_id: row.fee_published_id })));
      return Promise.resolve([]);
    },
    { unsafe: (text: string) => { unsafe.push(text); return { unsafeFragment: text }; } },
  );
  return { db, calls, unsafe };
}

describe("Darwin's live re-file of NSF fees that price a bounced loan payment (Knox v144)", () => {
  it("ships with its switch off", () => {
    expect(LOAN_PAYMENT_NSF_REFILE_LIVE).toBe(false);
  });

  it("dry run: both live Global FCU rows re-file to other lending", () => {
    const found = findLoanPaymentNsf(rows);
    expect(found.checked).toBe(2);
    expect(found.outcomes).toEqual({ refile: 2 });
    expect(found.institutions).toBe(1);
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual([67818, 67831]);
  });

  it("keeps a fee whose bank has a live other lending fee at the same price, and one that only names the account's items", () => {
    expect(loanPaymentNsfVerdict({ ...rows[1], lending_twin: true })?.outcome).toBe("twin");
    expect(loanPaymentNsfVerdict({ ...rows[1], fee_name: "NSF check/Loan Payment" })?.outcome).toBe("not_matched");
  });

  it("never reads or re-files an admin-corrected fee, and re-files only an unchanged, live, unquarantined fee", async () => {
    const { db, calls, unsafe } = fakeDb();
    const result = await recheckLoanPaymentNsf(db as never, { runId: 1, dryRun: false, live: true });
    expect(result.refiled).toEqual([67818, 67831]);
    const read = (calls.find((sql) => /SELECT fp\.fee_published_id/.test(sql)) ?? "").replace(/\s+/g, " ");
    expect(unsafe).toContain(notAdminCorrectedSql("fp"));
    expect(read).toContain("fp.rolled_back_at IS NULL");
    expect(read).toContain("fp.quarantined_at IS NULL");
    const update = (calls.find((sql) => /UPDATE published_fee_records/.test(sql)) ?? "").replace(/\s+/g, " ");
    expect(update).toContain(notAdminCorrectedSql("fp"));
    expect(update).toContain("fp.canonical_fee_key = v.from_key");
    expect(update).toContain("btrim(fp.fee_name) = v.old_name");
    expect(update).toContain("fp.amount IS NOT DISTINCT FROM v.amount");
    expect(update).toContain("fp.rolled_back_at IS NULL");
    expect(update).toContain("fp.quarantined_at IS NULL");
    expect(update).toContain("live.canonical_fee_key = ?");
  });

  it("writes nothing while the switch is off or on a dry run", async () => {
    for (const options of [{ dryRun: false, live: false }, { dryRun: true, live: true }]) {
      const { db, calls } = fakeDb();
      const result = await recheckLoanPaymentNsf(db as never, { runId: 1, ...options });
      expect(result.matched).toBe(2);
      expect(result.refiled).toEqual([]);
      expect(calls.some((sql) => /UPDATE/.test(sql))).toBe(false);
    }
  });
});
