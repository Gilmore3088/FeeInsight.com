import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { DARWIN_RELEASE_ACTS, scheduleContext, type HeldFeeRow } from "./release-held";
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
  releaseHoldReason,
  runDarwinReleaseReview,
} from "./release-review";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    if (templateText(strings).includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
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
