import { describe, expect, it, vi } from "vitest";

import { trainCategoryModel } from "@/lib/agents/darwin/category-model";

import { isBusinessOnlyPage, restoreCrossPageSupersedes, wasCrossPage } from "./cross-page-restore";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const categoryModel = trainCategoryModel([
  { name: "Cashier's check", categoryKey: "cashiers_check", count: 50 },
  { name: "Notary fee", categoryKey: "notary_fee", count: 40 },
  { name: "Account research", categoryKey: "account_research", count: 40 },
]);

const CREDIT_UNION_SCHEDULE = "https://cu.example/files/Fee-Schedule.pdf";
const CREDIT_UNION_DISCLOSURE = "https://cu.example/files/Truth-in-Savings-Disclosure.pdf";

function row(id: number, overrides: Record<string, unknown> = {}) {
  return {
    fee_published_id: id,
    fee_verified_id: id + 1000,
    review_status: "verified",
    institution_id: 5806,
    canonical_fee_key: "notary_fee",
    fee_name: "Notary Fee",
    amount: "2.00",
    closed_url: CREDIT_UNION_SCHEDULE,
    replacement_id: id + 500,
    replacement_url: CREDIT_UNION_DISCLOSURE,
    replacement_live: true,
    closed_read_at: "2026-10-05T00:00:00.000Z",
    replacement_read_at: "2026-10-06T00:00:00.000Z",
    newest_text: "Notary Fee | $2.00\nAccount Research | $25.00 per hour",
    ...overrides,
  };
}

function createDb(rows: unknown[]) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("SET rolled_back_at = NULL")) return Promise.resolve([{ fee_published_id: 1, lineage_ref: 1001, institution_id: 5806 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as Parameters<typeof restoreCrossPageSupersedes>[0] & ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve(rows));
  (db as unknown as { savepoint: unknown }).savepoint = vi.fn((fn: (scope: unknown) => unknown) => fn(db));
  return db;
}

describe("wasCrossPage", () => {
  it("is true only for two different known pages", () => {
    expect(wasCrossPage(CREDIT_UNION_SCHEDULE, CREDIT_UNION_DISCLOSURE)).toBe(true);
    expect(wasCrossPage("https://cu.example/files/2024/Fee-Schedule-Oct-1-2024.pdf", "https://www.cu.example/files/2026/Fee-Schedule-08.15.2026-final.pdf")).toBe(false);
    expect(wasCrossPage(null, CREDIT_UNION_DISCLOSURE)).toBe(false);
  });
});

describe("isBusinessOnlyPage", () => {
  it("reads the address the way the business-schedule rule does", () => {
    expect(isBusinessOnlyPage("https://opportunitybank.com/content/files/BUSINESS-FEE-SCHEDULE.pdf")).toBe(true);
    expect(isBusinessOnlyPage("https://opportunitybank.com/content/files/Consumer-Fee-Schedule.pdf")).toBe(false);
    expect(isBusinessOnlyPage("https://www.mcclainbank.com/personal/checking")).toBe(false);
  });
});

describe("restoreCrossPageSupersedes", () => {
  const rows = [
    row(1),
    // Same page, a newer copy: a real price change, never restored.
    row(2, { closed_url: "https://cu.example/files/2024/Fee-Schedule.pdf", replacement_url: "https://cu.example/files/2026/Fee-Schedule.pdf" }),
    // A business schedule's fee beside a live consumer fee stays down (business-schedule rule).
    row(3, { closed_url: "https://cu.example/files/Business-Fee-Schedule.pdf" }),
    // No longer on its own page: fails the restore bar.
    row(4, { canonical_fee_key: "cashiers_check", fee_name: "Cashier's Check", amount: "8.00" }),
    // A page last read months before its replacement may be gone: stays down.
    row(5, { closed_read_at: "2026-02-17T00:00:00.000Z" }),
  ];

  it("dry run reports what would come back and writes nothing", async () => {
    const db = createDb(rows);
    const result = await restoreCrossPageSupersedes(db, { runId: 9, dryRun: true, categoryModel });
    expect(result).toMatchObject({ superseded: 5, crossPage: 4, businessLeftDown: 1 });
    expect(result.restored.map((fee) => fee.feePublishedId)).toEqual([1]);
    expect(result.failing.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[4, expect.any(String)], [5, "stale_page"]]);
    expect(db).not.toHaveBeenCalled();
  });

  it("restores a fee another page superseded, queues it for the source check and logs it", async () => {
    const db = createDb(rows);
    const result = await restoreCrossPageSupersedes(db, { runId: 9, dryRun: false, categoryModel });
    expect(result.restored.map((fee) => fee.feePublishedId)).toEqual([1]);
    const texts = db.mock.calls.map((call) => templateText(call[0]));
    expect(texts.some((text) => text.includes("SET rolled_back_at = NULL") && text.includes("NOT EXISTS"))).toBe(true);
    expect(texts.some((text) => text.includes("INSERT INTO pipeline_attempts"))).toBe(true);
    expect(texts.some((text) => text.includes("hamilton.cross_page_restore"))).toBe(true);
    expect(texts.some((text) => /DELETE/i.test(text))).toBe(false);
  });

  it("restores nothing without Darwin's category model", async () => {
    const db = createDb(rows);
    const result = await restoreCrossPageSupersedes(db, { runId: 9, dryRun: false, categoryModel: null });
    expect(result.restored).toEqual([]);
    expect(db).not.toHaveBeenCalled();
  });
});
