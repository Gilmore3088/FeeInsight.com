import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { DARWIN_RELEASE_ACTS, scheduleContext, type HeldFeeRow } from "./release-held";
import { trainCategoryModel } from "./category-model";
import {
  DARWIN_RELEASE_REVIEW_STRATEGY,
  frequencyFromLine,
  lessonsFor,
  lineRefilesTo,
  loadReviewLessons,
  parseReleaseReviews,
  releaseReviewPrompt,
  reviewPasses,
  premiumServiceMisfiled,
  DARWIN_RECORDED_RELEASE_ACTS,
  RECORDED_RELEASE_DRY_RUN_FINGERPRINT,
  recordedPassHoldReason,
  releaseHoldReason,
  releaseRecordedPasses,
  runDarwinReleaseReview,
} from "./release-review";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

/** The stored schedules the release check reads (#1367): document 20 for `row()`, 21 a savings page. */
const SOURCE_TEXTS = [
  { source_document_id: 20, normalized_text: "Fee Schedule\nStop Payment $30.00\nHELOC Late Payment 5% of Amount Owed, $100.00 Maximum" },
  { source_document_id: 21, normalized_text: "Christmas Club Accounts\nMonthly charge $5.00\nEarly withdrawal $10.00" },
];

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    if (templateText(strings).includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    if (templateText(strings).includes("FROM agent_source_texts")) return Promise.resolve(SOURCE_TEXTS);
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof runDarwinReleaseReview>[0]["db"]>;

const row = (overrides: Record<string, unknown> = {}) => ({
  fee_raw_id: 1,
  institution_id: 10,
  source_url: "https://bank.example/fees.pdf",
  document_r2_key: null,
  extraction_confidence: null,
  fee_name: "Stop Payment",
  amount: "30.00",
  frequency: null,
  outlier_flags: [],
  conditions: null,
  institution_name: "Example Bank",
  source_document_id: 20,
  state_code: "VT",
  held_reason: "peer_outlier",
  held_canonical_fee_key: "stop_payment",
  source_line: "Stop Payment $30.00",
  ...overrides,
});

const reply = (body: unknown) =>
  ({
    content: [{ type: "text", text: JSON.stringify(body) }],
    usage: { input_tokens: 2000, output_tokens: 200 },
  }) as never;

function attempts(db: DbMock): Array<{ strategy: unknown; outcome: unknown; detail: Record<string, unknown> }> {
  return db.mock.calls
    .filter(([strings]) => templateText(strings).includes("INSERT INTO pipeline_attempts"))
    .map((call) => {
      const values = call.slice(1);
      return { strategy: values[3], outcome: values[6], detail: JSON.parse(String(values[12])) };
    });
}

describe("Darwin held-fee release review", () => {
  it("shows the review the schedule rows around a fee's line", () => {
    const text = ["Account Fees", "Return item $5.00", "Early close $10.00", "Stop Payment $30.00", "Wire $20.00", "Notary Free"].join("\n");
    expect(scheduleContext(text, "Return item $5.00")).toBe("Account Fees\nReturn item $5.00\nEarly close $10.00\nStop Payment $30.00\nWire $20.00");
    expect(scheduleContext(text, "Not on this page $1")).toBeNull();
    expect(scheduleContext(null, "Return item $5.00")).toBeNull();
    expect(scheduleContext("Closed Savings Fee\n$5.00\nIncorrect Address Fee\n$5.00 per month", "Incorrect Address Fee | $5.00 per month")).toBe(
      "Closed Savings Fee\n$5.00\nIncorrect Address Fee\n$5.00 per month",
    );
    const prompt = releaseReviewPrompt([
      { row: row() as unknown as HeldFeeRow, sourceLine: "Stop Payment $30.00", sourceContext: "Early close $10.00\nStop Payment $30.00" },
    ]);
    expect(prompt).toContain("schedule_rows_around");
    expect(prompt).toContain("Early close $10.00");
  });

  it("never passes a fee its own line re-files, and names the neighbouring categories", () => {
    const transfer = {
      row: row({ fee_name: "Service Overdraft Fee", held_canonical_fee_key: "overdraft" }) as unknown as HeldFeeRow,
      sourceLine: "Service Overdraft Fee | Fee Transfer from Savings to Checking: $5.00",
    };
    expect(lineRefilesTo(transfer)).toBe("od_protection_transfer");
    expect(lineRefilesTo({ row: row({ fee_name: "Overdraft Fee", held_canonical_fee_key: "overdraft" }) as unknown as HeldFeeRow, sourceLine: "Overdraft Fee | $30.00" })).toBeNull();
    const prompt = releaseReviewPrompt([transfer]);
    expect(prompt).toContain("not_these");
    expect(prompt).toContain("od_protection_transfer");
    expect(prompt).toContain("sentence fragment");
    expect(prompt).toContain("Smart Safe");
    expect(prompt).toContain("footnote marker");
    expect(prompt).toContain("jumbled text");
    expect(prompt).toContain("FEE WAIVED");
    expect(prompt).toContain("re-clearing a check");
    expect(prompt).toContain("online wires");
    expect(prompt).toContain("emergency");
    expect(prompt).toContain("prices go with the names in order");
  });

  it("puts the learning store's lessons for a batch's categories in the prompt", () => {
    const stop = { row: row() as unknown as HeldFeeRow, sourceLine: "Stop Payment $30.00" };
    const lessons = [
      { filedAs: "stop_payment", feeName: "Stop Payment Removal", amount: 5, scheduleLine: "Stop Payment Removal | $5.00", found: "wrong: filed under the wrong category" },
      { filedAs: "cashiers_check", feeName: "Cashier's Check", amount: 10, scheduleLine: null, found: "wrong: filed under the wrong category" },
    ];
    const forBatch = lessonsFor([stop], lessons);
    expect(forBatch.map((lesson) => lesson.filedAs)).toEqual(["stop_payment"]);
    const prompt = releaseReviewPrompt([stop], forBatch);
    expect(prompt).toContain("Lessons:");
    expect(prompt).toContain("Stop Payment Removal | $5.00");
    expect(prompt).not.toContain("Cashier's Check");
    expect(releaseReviewPrompt([stop])).not.toContain("Lessons:");
  });

  it("reads lessons only from category judgements and restores, never the source check's amount calls", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM pipeline_feedback pf")) {
        return Promise.resolve([
          { canonical_fee_key: "stop_payment", fee_name: "Stop Payment Removal", amount: "5.00", excerpt: "Stop Payment Removal | $5.00", kind: "wrong_category" },
          { canonical_fee_key: "stop_payment", fee_name: "Stop Payment", amount: "25.00", excerpt: null, kind: "restored" },
        ]);
      }
      return Promise.resolve([]);
    });
    const lessons = await loadReviewLessons(db as never, ["stop_payment", "stop_payment"]);
    const query = db.mock.calls.map(([strings]) => templateText(strings)).find((text) => text.includes("FROM pipeline_feedback pf")) ?? "";
    expect(query).toContain("'wrong_category', 'off_taxonomy'");
    expect(query).not.toContain("hamilton.source_check");
    // postgres.js sends numbers untyped; a CASE of untyped values is text, and bigint <= text fails on prod.
    expect(query).toMatch(/THEN\s+::int\s+ELSE\s+::int END/);
    expect(lessons).toEqual([
      { filedAs: "stop_payment", feeName: "Stop Payment Removal", amount: 5, scheduleLine: "Stop Payment Removal | $5.00", found: "wrong: filed under the wrong category" },
      { filedAs: "stop_payment", feeName: "Stop Payment", amount: 25, scheduleLine: null, found: "right: a check took it down by mistake; it is a real price in this category" },
    ]);
  });

  it("reviews without lessons when the learning store cannot be read", async () => {
    const db = vi.fn(() => Promise.reject(new Error("relation does not exist")));
    await expect(loadReviewLessons(db as never, ["stop_payment"])).resolves.toEqual([]);
    await expect(loadReviewLessons(db as never, [])).resolves.toEqual([]);
  });

  it("passes a fee only when it is a fee, fits its category, and the amount is the price", () => {
    const verdicts = parseReleaseReviews({
      verdicts: [
        { id: 1, is_fee: true, category_fits: true, amount_is_price: true },
        { id: 2, is_fee: true, category_fits: false, amount_is_price: true },
        { id: 3, is_fee: true, category_fits: true, amount_is_price: false },
        { id: 4, is_fee: true, category_fits: true },
      ],
    });
    expect(reviewPasses(verdicts.get(1))).toBe(true);
    expect(reviewPasses(verdicts.get(2))).toBe(false);
    expect(reviewPasses(verdicts.get(3))).toBe(false);
    expect(reviewPasses(verdicts.get(4))).toBe(false);
    expect(reviewPasses(undefined)).toBe(false);
  });

  it("puts the schedule line and the category's own names in the prompt", () => {
    const prompt = releaseReviewPrompt([
      { row: row({ fee_name: "Bad Address Fee", held_canonical_fee_key: "account_research" }) as unknown as HeldFeeRow, sourceLine: "Bad Address Fee | $5.00/month" },
    ]);
    expect(prompt).toContain("Bad Address Fee | $5.00/month");
    expect(prompt).toContain("account_research");
    expect(prompt).toContain("bad address");
    expect(prompt).toContain("removing or releasing a stop payment");
    expect(prompt).toContain("expedited, rush, emergency or overnight");
    expect(prompt).toContain("Cost plus $8");
  });

  it("records a review per fee and publishes nothing while release is off", async () => {
    const db = createDbMock([row(), row({ fee_raw_id: 2, fee_name: "HELOC Late Payment", amount: "100", source_line: "5% of Amount Owed, $100.00 Maximum" })]);
    const create = vi.fn(async () => reply({
      verdicts: [
        { id: 1, is_fee: true, category_fits: true, amount_is_price: true, reason: "stop payment price" },
        { id: 2, is_fee: true, category_fits: true, amount_is_price: false, reason: "amount is the cap" },
      ],
    }));

    const result = await runDarwinReleaseReview({ runId: 5, stepId: 6, db: asDb(db), create, calls: 2, acts: false });

    expect(create).toHaveBeenCalledTimes(1);
    expect(trackAnthropicRequest.mock.calls.at(-1)?.[0]).toMatchObject({ agent: "darwin", operation: "release_review" });
    expect(result).toMatchObject({ selected: 2, processed: 2, succeeded: 2, calls: 1, passed: 1, released: 0 });
    expect(attempts(db).map((attempt) => [attempt.strategy, attempt.outcome, attempt.detail.passes])).toEqual([
      [DARWIN_RELEASE_REVIEW_STRATEGY.strategy, "ok", true],
      [DARWIN_RELEASE_REVIEW_STRATEGY.strategy, "rejected", false],
    ]);
    expect(attempts(db).every((attempt) => attempt.detail.lessons === 0)).toBe(true);
    const statements = db.mock.calls.map(([strings]) => templateText(strings));
    expect(statements.some((query) => query.includes("INSERT INTO verified_fee_observations"))).toBe(false);
  });

  it("is paused: James chose Pause at 21:30 UTC Oct 8 after the v13 hand check scored 17 of 20", () => {
    expect(DARWIN_RELEASE_ACTS).toBe(false);
  });

  it("publishes only the fees that pass once release is on", async () => {
    const db = createDbMock([row(), row({ fee_raw_id: 2, fee_name: "HELOC Late Payment", amount: "100", source_line: "5% of Amount Owed, $100.00 Maximum" })]);
    const create = vi.fn(async () => reply({
      verdicts: [
        { id: 1, is_fee: true, category_fits: true, amount_is_price: true, reason: "stop payment price" },
        { id: 2, is_fee: true, category_fits: true, amount_is_price: false, reason: "amount is the cap" },
      ],
    }));

    await runDarwinReleaseReview({ runId: 5, stepId: 6, db: asDb(db), create, calls: 2, acts: true });

    const inserts = db.mock.calls.filter(([strings]) => templateText(strings).includes("INSERT INTO verified_fee_observations"));
    expect(inserts).toHaveLength(1);
    expect(attempts(db).map((attempt) => attempt.detail.acted)).toEqual([true, true]);
  });

  it("spends nothing on a dry run or with no calls left", async () => {
    const db = createDbMock([row()]);
    const create = vi.fn();
    expect((await runDarwinReleaseReview({ runId: 5, dryRun: true, db: asDb(db), create, calls: 2 })).selected).toBe(1);
    expect((await runDarwinReleaseReview({ runId: 5, db: asDb(db), create, calls: 0 })).selected).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps a premium version of a service held outside a premium category", () => {
    const held = (fee_name: string, held_canonical_fee_key: string) => ({ row: row({ fee_name, held_canonical_fee_key }) as unknown as HeldFeeRow });
    expect(premiumServiceMisfiled(held("Overnight Fee (Business Bill Pay)", "bill_pay"))).toBe(true);
    expect(premiumServiceMisfiled(held("Emergency Card Replacement", "card_replacement"))).toBe(true);
    expect(premiumServiceMisfiled(held("Debit Card Rush Delivery", "rush_card"))).toBe(false);
    expect(premiumServiceMisfiled(held("Bill Pay", "bill_pay"))).toBe(false);
  });

  it("v12 keeps business-service monthly fees, small returned checks and guard rejects held (hand check, Oct 8)", () => {
    const held = (fee_name: string, held_canonical_fee_key: string, amount: string, sourceContext: string | null = null) => ({
      row: row({ fee_name, held_canonical_fee_key, amount }) as unknown as HeldFeeRow,
      sourceContext,
    });
    expect(releaseHoldReason(held("Monthly Fee", "monthly_maintenance", "50.00", "ITEM | FEE\nMonthly Fee | $50.00\nNight Deposit Bag | $10.00"))).toBe(
      "business_service_monthly",
    );
    expect(releaseHoldReason(held("Monthly Fee", "monthly_maintenance", "10.00", "Basic Checking\nMonthly Fee | $10.00"))).toBeNull();
    expect(releaseHoldReason(held("Returned check fee", "nsf", "5.00"))).toBe("small_returned_item");
    expect(releaseHoldReason(held("Returned check fee", "nsf", "30.00"))).toBeNull();
    expect(releaseHoldReason(held("NSF Fee", "nsf", "5.00"))).toBeNull();
    expect(releaseHoldReason(held("IntraFi Network-ICS Monthly Fee (Consumer)", "monthly_maintenance", "25.00"))).toBe("category_guard");
  });

  it("v17 holds the cut-off shapes retidy v6 repairs, and releases a plain name", () => {
    const held = (fee_name: string, held_canonical_fee_key: string) => ({
      row: row({ fee_name, held_canonical_fee_key, amount: "5.00" }) as unknown as HeldFeeRow,
      sourceContext: null,
    });
    const fragments: Array<[string, string]> = [
      ["Inactive fee: This account may be subject to an Inactive fee of", "dormant_account"],
      ["to open the account. A Maintenance Service Charge of", "monthly_maintenance"],
      ["Charge Return Statement or Dormant Account Monthly Fee (Dormant Account Fee assessed after 12 months of inactivity.) | F", "dormant_account"],
      ["Fee Wire Transfer In", "wire_domestic_incoming"],
      ["+ drilling cost", "safe_deposit_box"],
      ["Late Fee | Up to", "late_payment"],
      ["Service Charge if balance falls below", "minimum_balance"],
      ["GUASFCU charges a", "check_image"],
    ];
    for (const [name, key] of fragments) {
      expect(releaseHoldReason(held(name, key)), name).toBe("name_fragment");
    }
    expect(releaseHoldReason(held("Maintenance Service Charge", "monthly_maintenance"))).toBeNull();
    expect(releaseHoldReason(held("Charge Back Fee", "deposited_item_return"))).toBeNull();
    expect(releaseHoldReason(held("Stop Payment Fee", "stop_payment"))).toBeNull();
  });

  it("v13 keeps names cut from the middle of a line held (hand check, Oct 8)", () => {
    const held = (fee_name: string, held_canonical_fee_key: string) => ({
      row: row({ fee_name, held_canonical_fee_key, amount: "5.00" }) as unknown as HeldFeeRow,
      sourceContext: null,
    });
    expect(releaseHoldReason(held("/hr incl. reproduction", "document_reproduction"))).toBe("name_fragment");
    expect(releaseHoldReason(held("account research fee may apply)", "account_research"))).toBe("name_fragment");
    expect(releaseHoldReason(held("Account Research (per 15 minutes)", "account_research"))).toBeNull();
    expect(releaseHoldReason(held("Undeliverable Mail / Locator fee", "account_research"))).toBeNull();
  });

  it("v14 keeps merchant fees, small overdraft protection fees and footnoted prices held (hand check, Oct 8)", () => {
    const held = (fee_name: string, key: string, amount: string, sourceLine = "", sourceContext: string | null = null) => ({
      row: row({ fee_name, held_canonical_fee_key: key, amount }) as unknown as HeldFeeRow,
      sourceLine,
      sourceContext,
    });
    // Guard v39 (PR 679) now fails a merchant's NSF filing first; it stays held either way.
    expect(releaseHoldReason(held("Merchant presenting NSF check from member", "nsf", "5.00"))).toBe("category_guard");
    expect(releaseHoldReason(held("Merchant overdraft charge", "overdraft", "5.00"))).toBe("charged_to_merchant");
    expect(releaseHoldReason(held("Charge Back (Merchant Returned Check) per item", "deposited_item_return", "10.00"))).toBeNull();
    expect(releaseHoldReason(held("Overdraft Protection Fee", "overdraft", "5.00"))).toBe("category_guard");
    expect(releaseHoldReason(held("Overdraft Protection Fee", "overdraft", "30.00"))).toBeNull();
    expect(releaseHoldReason(held("Courtesy Pay Overdraft Protection (Paid Item, per presentment)", "overdraft", "14.00"))).toBeNull();
    expect(releaseHoldReason(held("Early Account Closure", "early_closure", "251.00", "(Closed Within 180 Days of Opening) ....$251 | 1"))).toBe(
      "footnote_in_price",
    );
    expect(
      releaseHoldReason(held("IRA Direct Transfer Fee", "ira_termination", "251.00", "IRA Direct Transfer Fee ....$251 | 2", "Returned Deposit Item ....$7.501 | 1")),
    ).toBe("footnote_in_price");
    expect(releaseHoldReason(held("Wire Transfer", "wire_domestic_outgoing", "21.00", "Wire Transfer | $21", "Stop Payment | $30.00"))).toBeNull();
    expect(releaseHoldReason(held("Stop Payment", "stop_payment", "35.00", "Stop Payment | $35 | 1"))).toBeNull();
  });

  it("v15 keeps a fee whose frequency contradicts its schedule line held (James, complete-record bar, Oct 8)", () => {
    const held = (frequency: string | null, sourceLine: string) => ({
      row: row({ fee_name: "Excess activity charge", held_canonical_fee_key: "account_research", amount: "5.00", frequency }) as unknown as HeldFeeRow,
      sourceLine,
      sourceContext: null,
    });
    const excess = "6 Withdrawals/debits included per month; Excess activity charge - $5.00 each after 6";
    expect(releaseHoldReason(held("monthly", excess))).toBe("frequency_contradicts_line"); // "each" follows the $5.00
    expect(releaseHoldReason(held("monthly", "Monthly fee | $5.00 per month or $1.00 each"))).toBeNull();
    expect(releaseHoldReason(held("monthly", "Excess activity charge - $5.00 each after 6"))).toBe("frequency_contradicts_line");
    expect(releaseHoldReason(held("per_item", "Excess activity charge | $5.00 per month"))).toBe("frequency_contradicts_line");
    expect(releaseHoldReason(held("per_item", "Excess activity charge | $5.00 each"))).toBeNull();
    expect(releaseHoldReason(held(null, "Excess activity charge | $5.00 each"))).toBeNull();
  });

  it("v16 holds the name shapes the 200-fee eval found and reads a blank frequency from the line", () => {
    const held = (fee_name: string, key = "stop_payment") => ({
      row: row({ fee_name, held_canonical_fee_key: key, amount: "5.00" }) as unknown as HeldFeeRow,
      sourceContext: null,
    });
    const fragments: Array<[string, string]> = [
      ["Express Chip Debit Card Replacement ……………………", "card_replacement"],
      ["Below minimum balance . . . . . . . . . . . .", "minimum_balance"],
      ["00/item Counter Checks (per book of 8)", "counter_check"],
      ["charge for each one-time debit overdraft", "overdraft"],
      ["per month Stop Payment via Digital Banking", "stop_payment"],
      ["Fees: o A Minimum Balance Fee", "minimum_balance"],
      ["(for each overdraft item paid)", "overdraft"],
      ["Garnishment / Levy: Fee", "garnishment_levy"],
    ];
    for (const [name, key] of fragments) {
      expect(releaseHoldReason(held(name, key)), name).toBe("name_fragment");
    }
    const names: Array<[string, string]> = [
      ["Stop Payment", "stop_payment"],
      ["eStatement Fee", "estatement_fee"],
      ["Stop Payment (per item)", "stop_payment"],
      ["Levy/Garnishment", "garnishment_levy"],
      ["Replacement Debit Card", "card_replacement"],
    ];
    for (const [name, key] of names) {
      expect(releaseHoldReason(held(name, key)), name).toBeNull();
    }
    expect(frequencyFromLine("Stop Payment | $5.00 each", 5)).toBe("per_item");
    expect(frequencyFromLine("Paper statement $5.00 per month", 5)).toBe("monthly");
    expect(frequencyFromLine("Safe deposit box 3x5 $5.00 per year", 5)).toBe("annual");
    expect(frequencyFromLine("Dormant fee $5.00 quarterly", 5)).toBe("quarterly");
    expect(frequencyFromLine("Monthly fee | $5.00 per month or $1.00 each", 5)).toBeNull();
    expect(frequencyFromLine("Stop Payment | $5.00", 5)).toBeNull();
    expect(frequencyFromLine("6 included per month; Excess activity charge - $5.00 each after 6", 5)).toBe("per_item");
  });

  it("fills a state lane's short list with held fees from other states", async () => {
    const db = createDbMock([]);
    db.unsafe = vi.fn((_query: string, params: unknown[]) =>
      Promise.resolve(params.includes("UT") ? [row({ state_code: "UT" })] : [row(), row({ fee_raw_id: 2 })]),
    );
    const result = await runDarwinReleaseReview({ runId: 5, dryRun: true, db: asDb(db), create: vi.fn(), calls: 1, stateCode: "UT" });
    expect(result.results.map((entry) => entry.fee_raw_id)).toEqual([1, 2]);
    expect(db.unsafe).toHaveBeenCalledTimes(2);
  });
});

// Oct 15: a hand check of 20 of the 421 v17 passes recorded while the release did not act (19 right).
describe("releasing the recorded v17 passes", () => {
  const recorded = (
    feeName: string,
    key: string,
    frequency: string | null,
    sourceLine: string,
    sourceContext: string | null = null,
    overrides: Record<string, unknown> = {},
  ) => ({
    row: row({ fee_name: feeName, held_canonical_fee_key: key, frequency, ...overrides }) as unknown as HeldFeeRow,
    sourceLine,
    sourceContext,
  });

  it.each([
    // The hand check's miss (raw 418400): a business activity row filed as an out-of-network ATM fee.
    [recorded("Per Each ATM Withdrawal", "atm_non_network", null, "Per Each ATM Withdrawal $ .25",
      "Per Each ACH Debit $ .25\nPer Each POS Withdrawal $ .25\nPer Each ATM Withdrawal $ .25\nThe monthly average collected balance may earn an Earnings Allowance"), "business_activity_row"],
    [recorded("Vacation Club Excessive Withdrawals (Over 3 per Year)", "account_research", "annual", "Vacation Club Excessive Withdrawals (Over 3 per Year) | $5.00"), "frequency_word_disagrees"],
    [recorded("Monthly Service Charge, Minimum Bal", "monthly_maintenance", "per_item", "Monthly Service Charge, $1000 Minimum Bal. $25.00 Check Copy Fee, Each Check $7.50"), "frequency_word_disagrees"],
    [recorded("Account Fees: Excessive Withdrawal Fee (Share Account)", "account_research", null, "Account Fees | Excessive Withdrawal Fee (Share Account) | $5.00 (at the 5th withdrawal in the same month)"), "glued_or_cut_name"],
    [recorded("Notary: Outgoing", "notary_fee", "per_item", "This fee is charged by | Outgoing | $55.00 per item"), "glued_or_cut_name"],
    [recorded("Savings Excessive Withdrawal - 5 free per month then", "account_research", "per_item", "Savings Excessive Withdrawal - 5 free per month then | $2.00 per withdrawal"), "glued_or_cut_name"],
    // Released: the allowance's period agrees with a per-item price, and a real qualifier stays.
    [recorded("Withdrawal Limit Fee charged for each withdrawal, transfer, and payment that exceeds 6 per monthly statement cycle", "account_research", "per_item", "$3 Withdrawal Limit Fee charged for each withdrawal, transfer, and payment that exceeds 6 per monthly statement cycle4"), null],
    [recorded("Cashier's Checks: Non-Customer", "cashiers_check", null, "Cashier's Checks | Non-Customer $8.00"), null],
    [recorded("Share Draft Reconciliation per month", "account_research", "monthly", "Share Draft Reconciliation per month | $5.00"), null],
    // The second hand check (Oct 15, 15 of 20): its five misses, each held for its shape.
    [recorded("Monthly Service Charge", "monthly_maintenance", "monthly", "Monthly Service Charge: $31",
      "Minimum to open: $50\nMonthly Service Charge: $31\nMinimum daily balance needed to avoid monthly service charge: $300", { amount: "31" }), "footnote_in_price"],
    [recorded("ACH-NSF", "nsf", null, "ACH-NSF | Item paid through overdraft transfer from separate account | $3.00",
      "ACH-NSF | Item Returned | $30.00\nACH-NSF | Item paid through overdraft transfer from separate account | $3.00", { amount: "3" }), "overdraft_transfer_as_od_nsf"],
    [recorded("NSF/Uncollected Funds (per occurrence) Excess Withdrawal Item Over 6", "nsf", null, "NSF/Uncollected Funds (per occurrence) Excess Withdrawal Item Over 6……..$5.00",
      "Inactive Account…….. $10.00 Excess Withdrawal Item Over 6……….$5.00\nNSF/Uncollected Funds (per occurrence) Excess Withdrawal Item Over 6……..$5.00", { amount: "5" }), "two_column_glue"],
    [recorded("Debit Card Overdraft Service Fee8 – Lessthan", "overdraft", null, "Debit Card Overdraft Service Fee8 – Lessthan $5.00",
      "Debit Card Overdraft Service Fee8 – Greater than $5.00\nDebit Card Overdraft Service Fee8 – Lessthan $5.00", { amount: "5" }), "band_as_price"],
    [recorded("Overdraft Privilege Fee Per Presentment (less than $500)", "overdraft", "per_item", "Overdraft Privilege Fee Per Presentment: | Less Than $500 | $5 00",
      "Overdraft Privilege Fee Per Presentment: | Less Than $500 | $5 00\nResulting Negative Balance Greater Than $25 | $15 00 | Each VIP MMA Share Draft Less Than $500 | $5 00", { amount: "5" }), "two_column_glue"],
    // Every other overdraft and NSF pass in the batch waits for a person.
    [recorded("Courtesy Pay Overdraft Fee", "overdraft", null, "Courtesy Pay Overdraft Fee | $5.00", null, { amount: "5" }), "overdraft_nsf_for_person"],
    // Not footnotes: a price ending in 5, or one of several prices on the line; a price at its band is not the band.
    [recorded("Subpoena", "legal_process", null, "Subpoena | $25 per instance", null, { amount: "25" }), null],
    [recorded("Return Mail", "account_research", null, "Return Mail | $3.00 / item | Updating your address", "Return Mail | $3.00 / item | Updating your address\nOther | Return Mail | $3.00 / item | Updating your address", { amount: "3" }), null],
    // The third hand check (Oct 15, 18 of 20): two good fees the glue check held now release, and its two misses hold.
    [recorded("Monthly service fee", "monthly_maintenance", "monthly", "| You can avoid the $30.00 monthly service fee by maintaining a minimum daily balance of $5,000 or more.",
      "Ways to Avoid the Monthly Service Fee | You can avoid the $10.00 monthly service fee by maintaining a minimum daily balance of $500 or more. | You can avoid the $30.00 monthly service fee by maintaining a minimum daily balance of $5,000 or more. | Not Applicable",
      { amount: "30" }), null],
    [recorded("Monthly service fee", "monthly_maintenance", "monthly", "$100 of your deposits, however, may be available on the first business day. | account will be subject to a monthly service fee of $1.00 for that monthly | Ins",
      "$100 of your deposits, however, may be available on the first business day. | account will be subject to a monthly service fee of $1.00 for that monthly | Insurance Fund.",
      { amount: "1" }), null],
    [recorded("LEVIES/GARNISHMENTS", "garnishment_levy", null, "ACCOUNT CLOSURE | LEVIES/GARNISHMENTS | $30.00 – within 90 days | $75.00",
      "ACCOUNT CLOSURE | LEVIES/GARNISHMENTS\n$30.00 – within 90 days | $75.00", { amount: "30" }), "two_column_glue"],
    [recorded("Monthly Service Fee", "monthly_maintenance", "monthly", "Monthly Service Fee $29.95", null, { amount: "29.95" }), "maintenance_without_context"],
    // Its price under its own heading: released.
    [recorded("LEVIES/GARNISHMENTS", "garnishment_levy", null, "ACCOUNT CLOSURE | LEVIES/GARNISHMENTS | $30.00 – within 90 days | $75.00",
      "ACCOUNT CLOSURE | LEVIES/GARNISHMENTS\n$30.00 – within 90 days | $75.00", { amount: "75" }), null],
  ])("holds a recorded pass for its shape (%#)", (candidate, reason) => {
    expect(recordedPassHoldReason(candidate)).toBe(reason);
  });

  it("switched off: counts what it would release and hold, and writes nothing", async () => {
    expect(DARWIN_RELEASE_ACTS).toBe(false);
    const rows = [
      row({ fee_raw_id: 418400, fee_name: "Per Each ATM Withdrawal", held_canonical_fee_key: "atm_non_network", amount: "0.25", source_line: "Per Each ATM Withdrawal $ .25", source_context: "Per Each ACH Debit $ .25\nPer Each ATM Withdrawal $ .25" }),
      row({ fee_raw_id: 2 }),
    ];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (text.includes("FROM agent_source_texts")) return Promise.resolve(SOURCE_TEXTS);
      if (text.includes("verify.release_recorded") || text.includes("FROM pipeline_attempts pa")) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
    const result = await releaseRecordedPasses(db as never, { runId: 9, acts: false });
    expect(result).toMatchObject({ acts: false, recordedPasses: 2, wouldRelease: 1, released: 0, held: { business_activity_row: 1 } });
    expect(result.heldExamples[0]).toMatchObject({ feeRawId: 418400, reason: "business_activity_row" });
    expect(result.releaseByCategory).toEqual({ stop_payment: 1 });
    expect(db.mock.calls.some(([strings]) => /INSERT|UPDATE/.test(templateText(strings)))).toBe(false);
  });

  // The live release follows a ledger dry run from an earlier tick, never the same step.
  it.each([
    [false, { acts: false, dryRunRecorded: true, released: 0 }],
    [true, { acts: true, dryRunRecorded: false, released: 1 }],
  ])("switched on, releases only after a recorded dry run (dry run done: %s)", async (dryRunDone, expected) => {
    expect(DARWIN_RECORDED_RELEASE_ACTS).toBe(true);
    const rows = [row({ fee_raw_id: 2 })];
    const writes: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = templateText(strings);
      if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (text.includes("FROM agent_source_texts")) return Promise.resolve(SOURCE_TEXTS);
      if (text.includes("AS done")) {
        expect(values).toContain(RECORDED_RELEASE_DRY_RUN_FINGERPRINT);
        return Promise.resolve([{ done: dryRunDone }]);
      }
      if (text.includes("FROM pipeline_attempts pa")) return Promise.resolve(rows);
      if (/INSERT/.test(text)) {
        writes.push({ text, values });
        if (text.includes("verified_fee_observations")) return Promise.resolve([{ fee_verified_id: 77 }]);
      }
      return Promise.resolve([]);
    });
    const result = await releaseRecordedPasses(db as never, { runId: 9, acts: true });
    expect(result).toMatchObject({ ...expected, recordedPasses: 1, wouldRelease: 1, releaseByCategory: { stop_payment: 1 } });
    const attempts = writes.filter((write) => write.text.includes("INSERT INTO pipeline_attempts"));
    expect(attempts).toHaveLength(1);
    expect(attempts[0].values.includes(RECORDED_RELEASE_DRY_RUN_FINGERPRINT)).toBe(!dryRunDone);
    expect(writes.some((write) => write.text.includes("verified_fee_observations"))).toBe(dryRunDone);
  });

  // #1367: the recorded passes were sorted by a release check that passed "." as the category
  // pattern. Each is now checked again against its own stored schedule with the category's pattern.
  it("holds a recorded pass whose schedule never names its category (#1367)", async () => {
    const rows = [
      // The name passes today's category guard; the bank's own row says only "Monthly charge".
      row({ fee_raw_id: 3, fee_name: "Monthly Fee", held_canonical_fee_key: "monthly_maintenance", amount: "5.00", source_document_id: 21,
        source_line: "Monthly charge $5.00", source_context: "Christmas Club Accounts\nMonthly charge $5.00" }),
      row({ fee_raw_id: 2 }),
    ];
    const writes: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (text.includes("AS done")) return Promise.resolve([{ done: true }]);
      if (text.includes("FROM pipeline_attempts pa")) return Promise.resolve(rows);
      if (text.includes("FROM agent_source_texts")) return Promise.resolve(SOURCE_TEXTS);
      if (/INSERT/.test(text)) {
        writes.push(text);
        if (text.includes("verified_fee_observations")) return Promise.resolve([{ fee_verified_id: 77 }]);
      }
      return Promise.resolve([]);
    });
    const result = await releaseRecordedPasses(db as never, { runId: 9, acts: true });
    expect(result).toMatchObject({ acts: true, recordedPasses: 2, wouldRelease: 1, released: 1, held: { "release_check:category_not_in_text": 1 } });
    expect(result.heldExamples[0]).toMatchObject({ feeRawId: 3, reason: "release_check:category_not_in_text" });
    expect(writes.filter((text) => text.includes("verified_fee_observations"))).toHaveLength(1);
  });

  it("holds a recorded pass whose category Darwin's category model disputes (#1367)", () => {
    const model = trainCategoryModel([
      ...Array.from({ length: 20 }, () => ({ name: "Stop Payment", categoryKey: "stop_payment", count: 1 })),
      ...Array.from({ length: 20 }, () => ({ name: "Bad Address Fee", categoryKey: "account_research", count: 1 })),
    ]);
    const text = SOURCE_TEXTS[0].normalized_text;
    const filedWrong = recorded("Stop Payment", "account_research", null, "Stop Payment $30.00");
    expect(recordedPassHoldReason(filedWrong)).toBeNull();
    expect(recordedPassHoldReason(filedWrong, { text, categoryModel: model })).toBe("release_check:category_disputed");
    expect(recordedPassHoldReason(recorded("Stop Payment", "stop_payment", null, "Stop Payment $30.00"), { text, categoryModel: model })).toBeNull();
    // No stored schedule to read: held, never released on the recorded verdict alone.
    expect(recordedPassHoldReason(recorded("Stop Payment", "stop_payment", null, "Stop Payment $30.00"), { text: null, categoryModel: model })).toBe("release_check:no_source_text");
  });

  it("a dry_run run never releases or records the dry run", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (text.includes("FROM agent_source_texts")) return Promise.resolve(SOURCE_TEXTS);
      if (text.includes("AS done")) return Promise.resolve([{ done: true }]);
      if (text.includes("FROM pipeline_attempts pa")) return Promise.resolve([row({ fee_raw_id: 2 })]);
      return Promise.resolve([]);
    });
    const result = await releaseRecordedPasses(db as never, { runId: 9, acts: true, dryRun: true });
    expect(result).toMatchObject({ acts: false, dryRunRecorded: false, wouldRelease: 1 });
    expect(db.mock.calls.some(([strings]) => /INSERT|UPDATE/.test(templateText(strings)))).toBe(false);
  });
});
