import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import { knoxExcerpt, limitGuardReason, limitGuardVerdict, rollBackLimitsPublishedAsFees } from "./limit-guard";

function row(canonical_fee_key: string, fee_name: string, amount: number, excerpt?: string) {
  return { canonical_fee_key, fee_name, amount, conditions: excerpt ? `Knox read. excerpt="${excerpt}"` : null };
}

describe("limitGuardVerdict", () => {
  it("reads a name that ends on its limit as a limit", () => {
    expect(limitGuardVerdict(row("bill_pay", "Bill Payment Limits (per 24 Hours)", 1000))?.code).toBe("name_states_limit");
    expect(limitGuardVerdict(row("zelle_fee", "Digital Banking | Zelle® transfer limit", 1000))?.code).toBe("name_states_limit");
    expect(limitGuardVerdict(row("mobile_deposit", "Mobile Deposit Checks are limited to", 1000))?.code).toBe("name_states_limit");
    expect(limitGuardVerdict(row("cash_advance", "1 cash Advance limit is", 500))?.code).toBe("name_states_limit");
    expect(limitGuardVerdict(row("zelle_fee", "Zelle® have daily limits set by the Bank of", 500))?.code).toBe("name_states_limit");
  });

  it("reads a figure next to limit wording in Knox's excerpt as a limit", () => {
    expect(limitGuardVerdict(row("cash_advance", "Cash Advance: Customer", 2500, "Customer | $2,500 Limit"))?.code).toBe("source_states_limit");
    expect(limitGuardVerdict(row("zelle_fee", "Zelle® (", 2000, "Zelle® ($2,000 daily"))?.code).toBe("source_states_limit");
    expect(limitGuardVerdict(row("gift_card_purchase", "Visa® gift card (", 1000, "Visa® gift card ($1,000 max.) | $5"))?.code).toBe(
      "source_states_limit",
    );
  });

  it("reads a figure no bank charges in a transfer category as a limit", () => {
    expect(limitGuardVerdict(row("zelle_fee", "Zelle® Online Personal Payments", 2500, "Zelle® Online Personal Payments: | $2,500"))?.code).toBe(
      "above_category_ceiling",
    );
  });

  it("keeps over-limit fees, which are fees", () => {
    expect(limitGuardVerdict(row("nsf_daily_cap", "Wire Transfer (over daily limit)", 135))).toBeNull();
    expect(limitGuardVerdict(row("account_research", "Regulation D Transfer Limit Violation", 135))).toBeNull();
    expect(limitGuardVerdict(row("bill_pay", "Bill Pay Program Over-Limit Fee (per item)", 150))).toBeNull();
  });

  it("keeps a small fee whose row also states a limit", () => {
    expect(
      limitGuardVerdict(row("atm_non_network", "ATM cash withdrawal at other bank locations - Dollar Limit", 2.5, "Dollar Limit | $2.50 $500 per day")),
    ).toBeNull();
  });

  it("keeps daily fee caps, and reads a cap category row that caps no fee as a limit", () => {
    expect(limitGuardVerdict(row("od_daily_cap", "Overdraft Item Fee/Non-Sufficient Funds Fee Daily Maximum", 224))).toBeNull();
    expect(limitGuardVerdict(row("od_daily_cap", "Overdraft Daily Cap", 150, "| Per Item | Maximum of $150.00 per day"))).toBeNull();
    expect(limitGuardVerdict(row("od_daily_cap", "No Bounce Courtesy Pay Limit", 600))?.code).toBe("name_states_limit");
  });

  it("keeps fees whose excerpt adds costs after the price", () => {
    expect(limitGuardVerdict(row("garnishment_levy", "Tax Levy / Garnishment", 100, "Tax Levy / Garnishment | $100.00 + Atty Fees"))).toBeNull();
    expect(limitGuardVerdict(row("safe_deposit_box", "Safe Deposit Box 10x10", 120, "Safe Deposit Box 10x10 | $120.00/Per Year +Tax"))).toBeNull();
  });

  it("records a fixed reason group per reading", () => {
    const verdict = limitGuardVerdict(row("bill_pay", "Bill Payment Limits (per 24 Hours)", 1000))!;
    expect(limitGuardReason(verdict)).toMatch(/^limit_as_fee:name_states_limit: /);
    expect(knoxExcerpt('a; excerpt="Zelle® ($2,000 daily"')).toBe("Zelle® ($2,000 daily");
  });
});

describe("rollBackLimitsPublishedAsFees", () => {
  function templateText(strings: unknown): string {
    return Array.isArray(strings) ? strings.join(" ") : String(strings);
  }
  const live = [
    { fee_published_id: 1, institution_id: 7, canonical_fee_key: "bill_pay", fee_name: "Bill Payment Limits (per 24 Hours)", amount: "1000.00", conditions: null },
    { fee_published_id: 2, institution_id: 7, canonical_fee_key: "safe_deposit_box", fee_name: "Safe Deposit Box 10x10", amount: "120.00", conditions: null },
  ];
  function createDb() {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("SELECT fp.fee_published_id")) return Promise.resolve(live);
      if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 1 }]);
      return Promise.resolve([]);
    });
    return db as unknown as Parameters<typeof rollBackLimitsPublishedAsFees>[0] & typeof db;
  }

  it("rolls back only the limit, keeping the row and its reason", async () => {
    const db = createDb();
    const result = await rollBackLimitsPublishedAsFees(db, { runId: 3, batchId: "agentic-run-3", dryRun: false });
    expect(result.map((r) => r.feePublishedId)).toEqual([1]);
    const update = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"));
    expect(templateText(update?.[0])).toContain("rolled_back_reason");
    expect(templateText(update?.[0])).not.toContain("DELETE");
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("hamilton.limit_guard_rolled_back"))).toBe(true);
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb();
    const result = await rollBackLimitsPublishedAsFees(db, { runId: 3, batchId: "agentic-run-3", dryRun: true });
    expect(result).toHaveLength(1);
    expect(db.mock.calls.some((call) => /UPDATE|INSERT INTO/.test(templateText(call[0])))).toBe(false);
  });
});
