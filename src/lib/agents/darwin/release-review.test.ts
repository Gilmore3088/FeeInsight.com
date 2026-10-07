import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { DARWIN_RELEASE_ACTS, type HeldFeeRow } from "./release-held";
import {
  DARWIN_RELEASE_REVIEW_STRATEGY,
  parseReleaseReviews,
  releaseReviewPrompt,
  reviewPasses,
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
    expect(prompt).toContain("expedited, rush or overnight");
    expect(prompt).toContain("Cost plus $8");
  });

  it("records a review per fee and publishes nothing while release is off", async () => {
    expect(DARWIN_RELEASE_ACTS).toBe(false);
    const db = createDbMock([row(), row({ fee_raw_id: 2, fee_name: "HELOC Late Payment", amount: "100", source_line: "5% of Amount Owed, $100.00 Maximum" })]);
    const create = vi.fn(async () => reply({
      verdicts: [
        { id: 1, is_fee: true, category_fits: true, amount_is_price: true, reason: "stop payment price" },
        { id: 2, is_fee: true, category_fits: true, amount_is_price: false, reason: "amount is the cap" },
      ],
    }));

    const result = await runDarwinReleaseReview({ runId: 5, stepId: 6, db: asDb(db), create, calls: 2 });

    expect(create).toHaveBeenCalledTimes(1);
    expect(trackAnthropicRequest.mock.calls.at(-1)?.[0]).toMatchObject({ agent: "darwin", operation: "release_review" });
    expect(result).toMatchObject({ selected: 2, processed: 2, succeeded: 2, calls: 1, passed: 1, released: 0 });
    expect(attempts(db).map((attempt) => [attempt.strategy, attempt.outcome, attempt.detail.passes])).toEqual([
      [DARWIN_RELEASE_REVIEW_STRATEGY.strategy, "ok", true],
      [DARWIN_RELEASE_REVIEW_STRATEGY.strategy, "rejected", false],
    ]);
    const statements = db.mock.calls.map(([strings]) => templateText(strings));
    expect(statements.some((query) => query.includes("INSERT INTO verified_fee_observations"))).toBe(false);
  });

  it("spends nothing on a dry run or with no calls left", async () => {
    const db = createDbMock([row()]);
    const create = vi.fn();
    expect((await runDarwinReleaseReview({ runId: 5, dryRun: true, db: asDb(db), create, calls: 2 })).selected).toBe(1);
    expect((await runDarwinReleaseReview({ runId: 5, db: asDb(db), create, calls: 0 })).selected).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
