import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import {
  PER_ACCOUNT_CATEGORIES,
  PRODUCT_PAGE_CONFLICT_CHECK,
  PRODUCT_PAGE_CONFLICT_LIVE,
  parseAmounts,
  productPageConflictSql,
  retireProductPageConflicts,
  toConflict,
  isSameItemConflict,
  sameItem,
} from "./product-page-conflict";
import { TIER_NAME_SQL, TIER_PATH_SQL } from "@/lib/agents/darwin/tier-perk";

describe("product-page fees the schedule prices differently (James, 2026-10-13)", () => {
  it("reads only product pages against non-product documents, leaving per-account and multi-item categories out", () => {
    const text = productPageConflictSql("all");
    expect(text).toContain("WHERE NOT product");
    expect(text).toContain("NOT (p.amount = ANY(s.amounts))");
    for (const key of PER_ACCOUNT_CATEGORIES) expect(text).toContain(`'${key}'`);
    expect(productPageConflictSql("institution")).toContain("fp.institution_id = $1");
    expect(productPageConflictSql("fees")).toContain("fee_published_id = ANY($1::bigint[])");
  });

  it("never counts a tier's own schedule as the bank's price (#1397)", () => {
    const text = productPageConflictSql("all");
    expect(text).toContain(`!~* '${TIER_PATH_SQL}'`);
    expect(text).toContain(`!~* '${TIER_NAME_SQL}'`);
    // The patterns go into SQL as literals, so they never carry a quote.
    expect(TIER_PATH_SQL + TIER_NAME_SQL).not.toContain("'");
    // The address test the SQL runs is the one Darwin runs.
    expect(new RegExp(TIER_PATH_SQL, "i").test("/agreements-disclosures/truth-in-savings/premium-account-fees")).toBe(true);
    expect(new RegExp(TIER_PATH_SQL, "i").test("/agreements-disclosures/truth-in-savings/personal-account")).toBe(false);
  });

  it("clears a pending flag the check no longer raises", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = Object.assign(
      vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const text = parts.join("?");
        calls.push({ text, values });
        if (text.includes("SELECT fee_published_id, kind, evidence")) return [{ fee_published_id: 12264, kind: "takedown_pending", evidence: { flag_run_id: 6430, reason: "product_page_conflict: #5166 at $35.00 vs schedule $0.00" } }];
        if (text.includes("FROM pipeline_feedback pf")) return [{ fee_published_id: 12264 }];
        if (text.includes("to_regclass")) return [{ ready: true }];
        return [];
      }),
      { unsafe: vi.fn(async () => []) },
    );
    const result = await retireProductPageConflicts(db as never, { runId: 2, batchId: "b", dryRun: false });
    expect(result).toMatchObject({ conflicts: 0, cleared: 1, rolledBack: [] });
    expect(calls.some(({ text }) => text.includes("UPDATE published_fee_records"))).toBe(false);
    // Only live fees, and only this bank's when the run covers one.
    const read = calls.find(({ text }) => text.includes("FROM pipeline_feedback pf"))!;
    expect(read.text).toContain("rolled_back_at IS NULL");
    await retireProductPageConflicts(db as never, { runId: 3, batchId: "b", dryRun: false, institutionId: 49 });
    expect(calls.filter(({ text }) => text.includes("FROM pipeline_feedback pf")).at(-1)!.values).toContain(49);
  });

  it("parses Postgres arrays either way and names both prices in the reason", () => {
    expect(parseAmounts("{4.00,5.00}")).toEqual([4, 5]);
    expect(parseAmounts(["30.00"])).toEqual([30]);
    expect(parseAmounts(null)).toEqual([]);
    const conflict = toConflict({
      fee_published_id: "7", fee_verified_id: "8", institution_id: "9", source_document_id: "10",
      document_url: "https://bank.example/personal/checking", canonical_fee_key: "nsf", fee_name: "NSF", amount: "25.00",
      schedule_amounts: "{30.00}",
    });
    expect(conflict).toMatchObject({ feePublishedId: 7, amount: 25, scheduleAmounts: [30] });
    expect(conflict.reason).toBe("product_page_conflict: #10 at $25.00 vs schedule $30.00");
  });

  it("is on, and with live off logs first looks and takes nothing down", async () => {
    expect(PRODUCT_PAGE_CONFLICT_LIVE).toBe(true);
    const calls: string[] = [];
    const db = Object.assign(
      vi.fn(async (parts: TemplateStringsArray) => {
        calls.push(parts.join("?"));
        return [];
      }),
      {
        unsafe: vi.fn(async () => [
          { fee_published_id: 7, fee_verified_id: 8, institution_id: 9, source_document_id: 10, document_url: "https://bank.example/checking", canonical_fee_key: "nsf", fee_name: "NSF", amount: 25, schedule_amounts: [30] },
        ]),
      },
    );
    const result = await retireProductPageConflicts(db as never, { runId: 1, batchId: "b", dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, conflicts: 1, rolledBack: [] });
    expect(calls.some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(PRODUCT_PAGE_CONFLICT_CHECK).toBe("hamilton.product_page_conflict");
  });

  describe("judges the same item, not only the same category (Lane speed sample, 2026-10-20: 12 of 20 wrong)", () => {
    const row = (feeName: string, amount: number, lines: Array<[string, number]>) => ({
      fee_published_id: 1, fee_verified_id: 1, institution_id: 1, source_document_id: 1, document_url: "https://bank.test/checking",
      canonical_fee_key: "x", fee_name: feeName, amount, schedule_amounts: lines.map(([, a]) => a),
      schedule_lines: lines.map(([name, a]) => ({ name, amount: a })),
    });

    it("leaves a fee live when the schedule prices a different item in its category", () => {
      expect(isSameItemConflict(row("HSA Account Closing Fee", 25, [["Christmas Club Early Withdrawal Penalty", 10]]))).toBe(false);
      expect(isSameItemConflict(row("Returned Item Fee", 30, [["Bill Pay NSF Fee", 25]]))).toBe(false);
      expect(isSameItemConflict(row("Loan Application Fee", 50, [["Payoff Quote Fee", 20]]))).toBe(false);
    });

    it("takes down a fee the schedule prices differently under the same name", () => {
      expect(isSameItemConflict(row("Stop Payment Fee", 25, [["Stop Payment", 30]]))).toBe(true);
      expect(isSameItemConflict(row("Overdraft Fee", 25, [["Overdraft fees", 35], ["Bill Pay NSF Fee", 25]]))).toBe(true);
    });

    it("leaves a fee live when any schedule line for the same item has its price, or it is named as a discount", () => {
      expect(isSameItemConflict(row("Stop Payment Fee", 30, [["Stop Payment", 35], ["Stop Payment Fee", 30]]))).toBe(false);
      expect(isSameItemConflict(row("Discounted Return Item Fee", 24.99, [["Return Item Fee", 30]]))).toBe(false);
    });

    it("reads same-item names past case, plurals and a trailing fee, not across items", () => {
      expect(sameItem("Stop Payments", "stop payment fee")).toBe(true);
      expect(sameItem("Returned Item", "Bill Pay NSF")).toBe(false);
      expect(sameItem("", "Stop Payment")).toBe(false);
    });

    it("pairs only the same item: one extra word is another item (re-sample, 2026-10-20)", () => {
      expect(sameItem("Rush Card", "International Rush Card")).toBe(false);
      expect(sameItem("Cashing Money Orders", "Money Orders")).toBe(false);
      expect(sameItem("Early closing fee", "Early Closing Fees")).toBe(true);
      expect(sameItem("Check copy", "Check Copies")).toBe(true);
      expect(sameItem("Cashier's Checks", "Cashiers Check Fee")).toBe(true);
    });

    describe("counts only schedule lines that can speak against the page", () => {
      const at = (feeName: string, amount: number, host: string, readAt: string, lines: Array<[string, number, string, string]>) => ({
        ...row(feeName, amount, []),
        product_host: host,
        product_read_at: readAt,
        schedule_amounts: lines.map(([, a]) => a),
        schedule_lines: lines.map(([name, a, h, r]) => ({ name, amount: a, host: h, read_at: r })),
      });

      it("never another host's schedule (Popular: populardirect.com is another division's)", () => {
        expect(isSameItemConflict(at("Overdraft fee", 34, "popularbank.com", "2026-10-09", [["Overdraft Fee", 10, "populardirect.com", "2026-10-09"]]))).toBe(false);
        expect(isSameItemConflict(at("Overdraft fee", 34, "popularbank.com", "2026-10-09", [["Overdraft Fee", 10, "popularbank.com", "2026-10-09"]]))).toBe(true);
      });

      it("never a $0 benefits line", () => {
        expect(isSameItemConflict(at("Domestic Wire", 20, "ffcu.test", "2026-10-09", [["Domestic Wire", 0, "ffcu.test", "2026-10-10"]]))).toBe(false);
      });

      it("never a copy older than the page (GTE: the newer page is itself the full schedule)", () => {
        expect(isSameItemConflict(at("NSF Fee", 37, "gte.test", "2026-10-09", [["NSF Fee", 35, "gte.test", "2026-10-03"]]))).toBe(false);
        expect(isSameItemConflict(at("NSF Fee", 37, "gte.test", "2026-10-09", [["NSF Fee", 35, "gte.test", "2026-10-12"]]))).toBe(true);
      });
    });

    it("leaves a tier's own product page or fee out (two BankOn $0s in the sample)", () => {
      const text = productPageConflictSql("all");
      expect(text).toContain("bank[\\s_-]?on");
      expect(text).toContain("COALESCE(p.fee_name, '') !~*");
    });
  });
});
