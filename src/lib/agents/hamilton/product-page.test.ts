import { describe, expect, it, vi } from "vitest";

import { isProductPage, PRODUCT_PAGE_TAKEDOWN_ON, productPageTakedownEnabled, retireProductPageFees } from "./product-page";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("isProductPage", () => {
  it("names checking and account pages, not schedules, files or legal pages", () => {
    expect(isProductPage("https://www.pnc.com/en/personal-banking/banking/checking/simple-checking.html")).toBe(true);
    expect(isProductPage("https://www.northeastbank.com/personal-checking")).toBe(true);
    expect(isProductPage("https://www.farmersebank.com/Accounts/Personal/checking")).toBe(true);
    expect(isProductPage("https://bank.example/personal/checking/fee-schedule")).toBe(false);
    expect(isProductPage("https://bank.example/disclosures/truth-in-savings")).toBe(false);
    expect(isProductPage("https://bank.example/personal/checking/schedule.pdf")).toBe(false);
    expect(isProductPage("https://bank.example/assets/files/ajsicgxx")).toBe(false);
    expect(isProductPage("https://squareup.com/us/en/legal/general/sqchecking-tos")).toBe(false);
    expect(isProductPage(null)).toBe(false);
  });

  it("is on since James's \"take down the fees\" (Oct 9)", () => {
    expect(productPageTakedownEnabled()).toBe(true);
    expect(productPageTakedownEnabled(false)).toBe(false);
  });
});

const rows = [
  { fee_published_id: 101901, fee_verified_id: 90001, institution_id: 4400, source_document_id: 13403, document_url: "https://www.pnc.com/en/personal-banking/banking/checking/simple-checking.html", canonical_fee_key: "overdraft", fee_name: "Overdraft Fees" },
];

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pendingFlag ? [{ fee_published_id: 101901, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "product_page: #13403" } }] : []);
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 101901 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db as unknown as Parameters<typeof retireProductPageFees>[0] & typeof db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 7, batchId: "agentic-run-7", dryRun: false };

describe("retireProductPageFees", () => {
  it("with the switch as shipped, flags a product-page $0 fee and keeps it live until its second look", async () => {
    expect(PRODUCT_PAGE_TAKEDOWN_ON).toBe(true);
    const db = createDb(null);
    const result = await retireProductPageFees(db, options);
    expect(result).toMatchObject({ enabled: true, productFees: 1, flagged: 1, rolledBack: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
  });

  it("only counts while off: no flag, no takedown", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireProductPageFees(db, { ...options, enabled: false });
    expect(result).toMatchObject({ enabled: false, productFees: 1, flagged: 0, rolledBack: [] });
    expect(db).not.toHaveBeenCalled();
    expect(String(db.unsafe.mock.calls[0][0])).toContain("Knox read a free fee");
  });

  it("on, flags a product-page $0 fee the first time and keeps it live", async () => {
    const db = createDb(null);
    const result = await retireProductPageFees(db, { ...options, enabled: true });
    expect(result).toMatchObject({ productFees: 1, flagged: 1, rolledBack: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
  });

  it("on, archives it on its second look and teaches Knox, never deleting", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireProductPageFees(db, { ...options, enabled: true });
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[101901, "product_page: #13403"]]);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("hamilton.product_page:published:101901");
    expect(calls).toContain("not_on_schedule");
  });
});
