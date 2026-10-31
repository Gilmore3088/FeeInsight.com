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
  { fee_published_id: 67818, fee_verified_id: 79598, institution_id: 5005, fee_name: "From a Savings or Money Market Share or: » NSF mortgage payment: Additional Cenlar charge", amount: "25.00", canonical_fee_key: "nsf", lending_twin_id: null },
  { fee_published_id: 67831, fee_verified_id: 79612, institution_id: 5005, fee_name: "» NSF mortgage payment: Additional Cenlar charge", amount: "25.00", canonical_fee_key: "nsf", lending_twin_id: null },
];

/**
 * A fake database that holds the live rows and applies each UPDATE's guards the way Postgres would:
 * the re-file's live-twin test reads the table as it was before the statement (one snapshot for the
 * whole UPDATE), and the twin takedown needs its twin live as other lending at the same price.
 */
function fakeDb(start: LoanPaymentNsfRow[] = rows) {
  const calls: string[] = [];
  const unsafe: string[] = [];
  const table = start.map((row) => ({ id: Number(row.fee_published_id), inst: Number(row.institution_id), amount: Number(row.amount), key: row.canonical_fee_key, live: true }));
  const db = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(strings.join("?"));
      const text = strings.join("?");
      if (/SELECT fp\.fee_published_id/.test(text)) return Promise.resolve(start);
      if (/UPDATE published_fee_records/.test(text) && /SET canonical_fee_key/.test(text)) {
        const ids = values[1] as number[];
        const snapshot = table.map((row) => ({ ...row }));
        const moved = table.filter((row) => ids.includes(row.id) && row.live && row.key === "nsf" &&
          !snapshot.some((other) => other.live && other.inst === row.inst && other.key === "other_lending_fee" && other.amount === row.amount));
        for (const row of moved) row.key = "other_lending_fee";
        return Promise.resolve(moved.map((row) => ({ fee_published_id: row.id })));
      }
      if (/UPDATE published_fee_records/.test(text) && /SET rolled_back_at/.test(text)) {
        const ids = values[1] as number[];
        const twins = values[2] as number[];
        const down = table.filter((row) => {
          const at = ids.indexOf(row.id);
          if (at < 0 || !row.live || row.key !== "nsf") return false;
          const twin = table.find((other) => other.id === twins[at]);
          return !ids.includes(twins[at]) && !!twin && twin.live && twin.key === "other_lending_fee" && twin.inst === row.inst && twin.amount === row.amount;
        });
        for (const row of down) row.live = false;
        return Promise.resolve(down.map((row) => ({ fee_published_id: row.id })));
      }
      return Promise.resolve([]);
    },
    { unsafe: (text: string) => { unsafe.push(text); return { unsafeFragment: text }; } },
  );
  return { db, calls, unsafe, table };
}

describe("Darwin's live re-file of NSF fees that price a bounced loan payment (Knox v144)", () => {
  it("ships with its switch off", () => {
    expect(LOAN_PAYMENT_NSF_REFILE_LIVE).toBe(false);
  });

  it("dry run: the two live Global FCU rows at one price are one charge: 67818 re-files, 67831 is its twin", () => {
    const found = findLoanPaymentNsf(rows);
    expect(found.checked).toBe(2);
    expect(found.outcomes).toEqual({ refile: 1, twin: 1 });
    expect(found.institutions).toBe(1);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.outcome, fee.twinFeePublishedId])).toEqual([[67818, "refile", undefined], [67831, "twin", 67818]]);
    expect(found.matches[1].reason).toBe("loan_payment_nsf_twin: live fee #67818");
  });

  it("re-files one fee per bank and price, whatever order the rows come in; other banks and prices re-file too", () => {
    const more: LoanPaymentNsfRow[] = [
      rows[1], rows[0],
      { ...rows[1], fee_published_id: 70001, amount: "30.00" },
      { ...rows[1], fee_published_id: 70002, institution_id: 6006 },
    ];
    const found = findLoanPaymentNsf(more);
    expect(found.outcomes).toEqual({ refile: 3, twin: 1 });
    expect(found.matches.filter((fee) => fee.outcome === "refile").map((fee) => fee.feePublishedId)).toEqual([67818, 70001, 70002]);
  });

  it("takes down a fee whose bank has a live other lending fee at the same price, and keeps one that only names the account's items", () => {
    expect(loanPaymentNsfVerdict({ ...rows[1], lending_twin_id: 555 })).toMatchObject({ outcome: "twin", twinFeePublishedId: 555 });
    expect(loanPaymentNsfVerdict({ ...rows[1], fee_name: "NSF check/Loan Payment" })?.outcome).toBe("not_matched");
  });

  it("never reads or re-files an admin-corrected fee, and re-files only an unchanged, live, unquarantined fee", async () => {
    const { db, calls, unsafe } = fakeDb();
    const result = await recheckLoanPaymentNsf(db as never, { runId: 1, dryRun: false, live: true });
    expect(result.refiled).toEqual([67818]);
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

  it("on: the two same-price rows leave one live other lending fee, 67818, and 67831 comes down as its twin", async () => {
    const { db, calls, table } = fakeDb();
    const result = await recheckLoanPaymentNsf(db as never, { runId: 1, dryRun: false, live: true });
    expect(result.refiled).toEqual([67818]);
    expect(result.takenDown).toEqual([67831]);
    expect(table.filter((row) => row.live).map((row) => [row.id, row.key])).toEqual([[67818, "other_lending_fee"]]);
    const takedown = (calls.find((sql) => /SET rolled_back_at/.test(sql)) ?? "").replace(/\s+/g, " ");
    expect(takedown).toContain("twin.canonical_fee_key = ?");
    expect(takedown).toContain("v.twin_id <> ALL(");
    expect(takedown).toContain("corrected.status = 'current'");
    // Re-file first, then the takedown, so the twin finds its re-file live as other lending.
    expect(calls.findIndex((sql) => /SET canonical_fee_key/.test(sql))).toBeLessThan(calls.findIndex((sql) => /SET rolled_back_at/.test(sql)));
  });

  it("on: a fee whose bank already has a live other lending fee at its price comes down, and is not re-filed", async () => {
    const withTwin: LoanPaymentNsfRow[] = [{ ...rows[1], lending_twin_id: 90000 }];
    const { db, table } = fakeDb(withTwin);
    table.push({ id: 90000, inst: 5005, amount: 25, key: "other_lending_fee", live: true });
    const result = await recheckLoanPaymentNsf(db as never, { runId: 1, dryRun: false, live: true });
    expect(result.refiled).toEqual([]);
    expect(result.takenDown).toEqual([67831]);
  });

  it("writes nothing while the switch is off or on a dry run", async () => {
    for (const options of [{ dryRun: false, live: false }, { dryRun: true, live: true }]) {
      const { db, calls } = fakeDb();
      const result = await recheckLoanPaymentNsf(db as never, { runId: 1, ...options });
      expect(result.matched).toBe(2);
      expect(result.outcomes).toEqual({ refile: 1, twin: 1 });
      expect(result.refiled).toEqual([]);
      expect(result.takenDown).toEqual([]);
      expect(calls.some((sql) => /UPDATE/.test(sql))).toBe(false);
    }
  });
});
