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
        if (text.includes("FROM pipeline_feedback") && text.includes("check_name =")) return [{ fee_published_id: 12264 }];
        if (text.includes("to_regclass")) return [{ ready: true }];
        return [];
      }),
      { unsafe: vi.fn(async () => []) },
    );
    const result = await retireProductPageConflicts(db as never, { runId: 2, batchId: "b", dryRun: false });
    expect(result).toMatchObject({ conflicts: 0, cleared: 1, rolledBack: [] });
    expect(calls.some(({ text }) => text.includes("UPDATE published_fee_records"))).toBe(false);
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

  it("starts off: logs first looks and takes nothing down", async () => {
    expect(PRODUCT_PAGE_CONFLICT_LIVE).toBe(false);
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
    const result = await retireProductPageConflicts(db as never, { runId: 1, batchId: "b", dryRun: false });
    expect(result).toMatchObject({ live: false, conflicts: 1, rolledBack: [] });
    expect(calls.some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(PRODUCT_PAGE_CONFLICT_CHECK).toBe("hamilton.product_page_conflict");
  });
});
