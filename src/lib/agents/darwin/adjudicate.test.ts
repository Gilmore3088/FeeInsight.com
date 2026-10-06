import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import {
  adjudicatePrompt,
  DARWIN_ADJUDICATE_STRATEGY,
  parseVerdicts,
  qualifies,
  runDarwinAdjudicate,
  verdictSide,
  type AdjudicationCandidate,
} from "./adjudicate";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    if (templateText(strings).includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    return Promise.resolve([]);
  }) as DbMock;
  // The release review's candidates come first; these tests have none.
  db.unsafe = vi.fn((query: string) => Promise.resolve(query.includes("rel.detail->>'verdict' = 'review'") ? [] : rows));
  return db;
}

const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof runDarwinAdjudicate>[0]["db"]>;

const candidate = (overrides: Partial<AdjudicationCandidate> = {}): AdjudicationCandidate => ({
  feeRawId: 1,
  institutionId: 10,
  sourceDocumentId: 20,
  feeName: "Card Replacement Charge",
  amount: 10,
  conditions: null,
  knoxKey: "overdraft",
  suggestedKey: "card_replacement",
  suggestedProbability: 0.97,
  decision: "rejected",
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  fee_raw_id: 1,
  institution_id: 10,
  source_document_id: 20,
  fee_name: "Card Replacement Charge",
  amount: "10.00",
  conditions: null,
  knox_key: "overdraft",
  suggested_key: "card_replacement",
  suggested_probability: "0.97",
  decision: "rejected",
  ...overrides,
});

const reply = (body: unknown) =>
  ({
    content: [{ type: "text", text: JSON.stringify(body) }],
    usage: { input_tokens: 2000, output_tokens: 200 },
  }) as never;

/** Attempt rows the runner inserted, parsed from the recordAttempt calls. */
function attempts(db: DbMock): Array<{ strategy: unknown; outcome: unknown; detail: Record<string, unknown> }> {
  return db.mock.calls
    .filter(([strings]) => templateText(strings).includes("INSERT INTO pipeline_attempts"))
    .map((call) => {
      const values = call.slice(1);
      return { strategy: values[3], outcome: values[6], detail: JSON.parse(String(values[12])) };
    });
}

describe("Darwin layer 3 adjudicator", () => {
  it("only sends a reject when the guard accepts the model's confident category", () => {
    expect(qualifies(candidate())).toBe(true);
    expect(qualifies(candidate({ suggestedProbability: 0.6 }))).toBe(false);
    expect(qualifies(candidate({ suggestedKey: "overdraft" }))).toBe(false);
    expect(qualifies(candidate({ decision: "verified", suggestedProbability: 0.2 }))).toBe(true);
  });

  it("reads verdicts and sides them with Knox, the model, another category or not a fee", () => {
    const verdicts = parseVerdicts({
      verdicts: [
        { id: 1, is_fee: true, category: "card_replacement", reason: "card fee" },
        { id: 2, is_fee: true, category: "overdraft" },
        { id: 3, is_fee: false, category: null },
        { id: 4, is_fee: true, category: "made_up_key" },
      ],
    });
    expect(verdictSide(candidate(), verdicts.get(1)!)).toBe("model");
    expect(verdictSide(candidate(), verdicts.get(2)!)).toBe("knox");
    expect(verdictSide(candidate(), verdicts.get(3)!)).toBe("not_a_fee");
    expect(verdicts.get(4)!.category).toBeNull();
    expect(verdictSide(candidate(), verdicts.get(4)!)).toBe("other");
  });

  it("puts every fee and both guesses in the prompt", () => {
    const prompt = adjudicatePrompt([candidate(), candidate({ feeRawId: 2, feeName: "NSF Paid Fee" })]);
    expect(prompt).toContain("\"id\":1");
    expect(prompt).toContain("NSF Paid Fee");
    expect(prompt).toContain("\"filed_as\":\"overdraft\"");
    expect(prompt).toContain("card_replacement");
  });

  it("records one shadow attempt per fee and never changes a decision", async () => {
    const db = createDbMock([row(), row({ fee_raw_id: 2, fee_name: "Overdraft Fee", decision: "verified", knox_key: "overdraft", suggested_key: "nsf", suggested_probability: "0.5" })]);
    const create = vi.fn(async () => reply({
      verdicts: [
        { id: 1, is_fee: true, category: "card_replacement", reason: "card fee" },
        { id: 2, is_fee: true, category: "overdraft", reason: "overdraft" },
      ],
    }));

    const result = await runDarwinAdjudicate({ runId: 5, stepId: 6, db: asDb(db), create });

    expect(create).toHaveBeenCalledTimes(1);
    expect(trackAnthropicRequest.mock.calls.at(-1)?.[0]).toMatchObject({ agent: "darwin", operation: "adjudicate" });
    expect(result).toMatchObject({ selected: 2, processed: 2, succeeded: 2, failed: 0, budgetStopped: false });
    const rows = attempts(db);
    expect(rows.map((attempt) => [attempt.strategy, attempt.outcome, attempt.detail.side])).toEqual([
      [DARWIN_ADJUDICATE_STRATEGY.strategy, "evidence_mismatch", "model"],
      [DARWIN_ADJUDICATE_STRATEGY.strategy, "ok", "knox"],
    ]);
    // Shadow: no write outside the attempt log.
    const writes = db.mock.calls.map(([strings]) => templateText(strings)).filter((text) => /INSERT|UPDATE|DELETE/.test(text));
    expect(writes.every((text) => text.includes("INSERT INTO pipeline_attempts"))).toBe(true);
  });

  it("stops cleanly at the budget cap without recording attempts", async () => {
    const db = createDbMock([row()]);
    const create = vi.fn(async () => {
      const error = new Error("Provider budget policy agent:darwin is disabled");
      error.name = "ProviderBudgetBlockedError";
      throw error;
    });

    const result = await runDarwinAdjudicate({ runId: 5, db: asDb(db), create });

    expect(result).toMatchObject({ selected: 1, processed: 0, budgetStopped: true });
    expect(result.budgetReason).toContain("agent:darwin");
    expect(attempts(db)).toHaveLength(0);
  });

  it("lists candidates without calling the model on a dry run", async () => {
    const db = createDbMock([row()]);
    const create = vi.fn();
    const result = await runDarwinAdjudicate({ runId: 5, db: asDb(db), create, dryRun: true });
    expect(create).not.toHaveBeenCalled();
    expect(result.selected).toBe(1);
    expect(result.results[0]).toMatchObject({ fee_raw_id: 1, knox_key: "overdraft", suggested_key: "card_replacement" });
  });
});
