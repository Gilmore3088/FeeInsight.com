import { beforeEach, describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { KNOX_EXTRACT_STRATEGY } from "./extract";
import {
  groundPaidRow,
  KNOX_PAID_FLAG,
  KNOX_PAID_STRATEGY,
  PAID_MIN_PRICED_LINES,
  pricedLineCount,
  runKnoxPaidExtract,
} from "./paid-extract";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

/** A dense schedule the free team reads poorly: names and prices in one prose run. */
const denseText = [
  "Our fees are listed below for your convenience.",
  ...Array.from({ length: 16 }, (_, index) => `Service number ${index + 1} is offered to members for $${index + 2}.00 when requested.`),
  "Stop payment orders placed in a branch are charged $31.00 each time.",
  "Domestic wires you send cost $27.50 per wire.",
].join("\n");

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    if (text.includes("INSERT INTO raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 900 }]);
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => (query.includes("FROM agent_source_texts") ? Promise.resolve(rows) : Promise.resolve([])));
  return db;
}

function asDb(db: DbMock): NonNullable<Parameters<typeof runKnoxPaidExtract>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runKnoxPaidExtract>[0]["db"]>;
}

const textRow = {
  document_text_id: 801,
  source_document_id: 601,
  institution_id: 52,
  source_url: "https://densebank.example/fees.pdf",
  normalized_text: denseText,
  text_hash: "dense-hash",
  free_yield: 1,
};

const reply = (body: unknown) =>
  ({
    content: [{ type: "text", text: `Here are the fees:\n${JSON.stringify(body)}` }],
    usage: { input_tokens: 20_000, output_tokens: 1_000 },
  }) as never;

function insertCalls(db: DbMock): unknown[][] {
  return db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO raw_fee_observations"));
}

function attemptCalls(db: DbMock): unknown[][] {
  return db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts")).map((call) => call.slice(1));
}

describe("Knox paid extraction (pass 3)", () => {
  beforeEach(() => {
    trackAnthropicRequest.mockClear();
    trackAnthropicRequest.mockImplementation(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
  });

  it("counts priced lines, one per amount on a flattened line", () => {
    expect(pricedLineCount(denseText)).toBe(18);
    expect(pricedLineCount(`Fee schedule ${"Item $5.00 ".repeat(40)}`)).toBe(40);
  });

  it("keeps only rows grounded in the text with an existing canonical key", () => {
    const text = "Stop payment orders placed in a branch are charged $31.00 each time.\nOutgoing wire ........ 25.00";
    expect(
      groundPaidRow({ fee_name: "Stop payment", canonical_key: "stop_payment", amount: 31, source_line: "Stop payment orders placed in a branch are charged $31.00 each time." }, text),
    ).toMatchObject({ feeName: "Stop payment", canonicalKey: "stop_payment", amount: 31 });
    // PDFs drop the dollar sign after a dot leader.
    expect(groundPaidRow({ fee_name: "Outgoing wire", canonical_key: "wire_domestic_outgoing", amount: "25.00", source_line: "Outgoing wire ........ 25.00" }, text)).toMatchObject({ amount: 25 });
    // Without a source line, the name and amount must both appear in the text.
    expect(groundPaidRow({ fee_name: "Stop payment", canonical_key: "stop_payment", amount: 31, source_line: "" }, text)).toMatchObject({ canonicalKey: "stop_payment" });
    // The model's amount must be on the quoted line.
    expect(groundPaidRow({ fee_name: "Stop payment", canonical_key: "stop_payment", amount: 35, source_line: "Stop payment orders placed in a branch are charged $31.00 each time." }, text)).toBe("not_in_text");
    // A line the document does not contain.
    expect(groundPaidRow({ fee_name: "Overdraft", canonical_key: "overdraft", amount: 31, source_line: "Overdraft fee $31.00" }, text)).toBe("not_in_text");
    expect(groundPaidRow({ fee_name: "Stop payment", canonical_key: "stop_fee_custom", amount: 31, source_line: "x" }, text)).toBe("unknown_canonical");
    expect(groundPaidRow({ fee_name: "Stop payment", canonical_key: "stop_payment", amount: -2 }, text)).toBe("invalid_amount");
    expect(groundPaidRow({ canonical_key: "stop_payment", amount: 31 }, text)).toBe("missing_fields");
  });

  it("never takes a limit as a fee, and counts prices under a dollar", () => {
    const line = "Digital Banking | Zelle® transfer limit | $1,000.00";
    expect(groundPaidRow({ fee_name: "Zelle transfer limit", canonical_key: "zelle_fee", amount: 1000, source_line: line }, line)).toBe("limit_not_fee");
    expect(pricedLineCount("Paid check | $.50 each\nPhotocopy | 75¢ per page\nCoin | 25 cents")).toBe(3);
  });

  it("never grounds a balance threshold as the fee (Texar $50.01)", () => {
    const line = "Overdraft Protection Items - Negative from $50.01 and more | $35";
    expect(groundPaidRow({ fee_name: "Overdraft Protection Items", canonical_key: "overdraft", amount: 50.01, source_line: line }, line)).toBe("not_in_text");
    expect(groundPaidRow({ fee_name: "Overdraft Protection Items", canonical_key: "overdraft", amount: 35, source_line: line }, line)).toMatchObject({ amount: 35 });
  });

  it("makes one budget-checked call per document and writes grounded rows like the rule path", async () => {
    const db = createDbMock([textRow]);
    const create = vi.fn(async () =>
      reply({
        fees: [
          { fee_name: "Stop payment", canonical_key: "stop_payment", amount: 31, frequency: "per_item", conditions: null, source_line: "Stop payment orders placed in a branch are charged $31.00 each time." },
          { fee_name: "Domestic wires you send", canonical_key: "wire_domestic_outgoing", amount: 27.5, frequency: null, conditions: null, source_line: "Domestic wires you send cost $27.50 per wire." },
          { fee_name: "Overdraft fee", canonical_key: "overdraft", amount: 35, frequency: "per_item", conditions: null, source_line: "Overdraft fee $35.00 per item" },
        ],
      }),
    );

    const result = await runKnoxPaidExtract({ runId: 301, stepId: 31, stateCode: "tx", db: asDb(db), create });

    expect(create).toHaveBeenCalledTimes(1);
    expect(trackAnthropicRequest).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "knox", operation: "paid_extract", agentRunId: 301 }),
      expect.any(Function),
    );
    const prompt = String((create.mock.calls[0] as unknown as [{ messages: Array<{ content: string }> }])[0].messages[0].content);
    expect(prompt).toContain("wire_domestic_outgoing (Wire Transfer (Domestic Out))");
    expect(prompt).toContain("Domestic wires you send cost $27.50 per wire.");

    expect(result).toMatchObject({ selected: 1, processed: 1, succeeded: 1, failed: 0, budgetStopped: false });
    expect(result.costMicrousd).toBeGreaterThan(0);

    const inserts = insertCalls(db);
    expect(inserts).toHaveLength(2);
    expect(inserts.map((call) => [call[7], call[8]])).toEqual([
      ["Stop payment", 31],
      ["Domestic wires you send", 27.5],
    ]);
    const flags = JSON.parse(String(inserts[0][11]));
    expect(flags).toEqual(expect.arrayContaining(["needs_darwin_verification", "canonical_hint:stop_payment", KNOX_PAID_FLAG]));
    expect(String(inserts[0][10])).toContain("text_hash=dense-hash;");

    // Older-text rows are retired the same way the rule path does it.
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("superseded_by_reread"))).toBe(true);

    const [attempt] = attemptCalls(db);
    expect(attempt).toEqual(
      expect.arrayContaining([52, 601, "extract", KNOX_PAID_STRATEGY.strategy, KNOX_PAID_STRATEGY.version, "dense-hash", "ok", 2, result.costMicrousd, 301, 31]),
    );
    expect(JSON.parse(String(attempt[attempt.length - 1]))).toMatchObject({ returned: 3, accepted: 2, rejected: { not_in_text: 1 } });

    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("pa.strategy_version");
    expect(query).toContain("free.yield_count <");
    expect(query).toContain("paid.strategy =");
    expect(params).toEqual(expect.arrayContaining([KNOX_EXTRACT_STRATEGY.strategy, KNOX_EXTRACT_STRATEGY.version, KNOX_PAID_STRATEGY.strategy, "TX"]));
  });

  it("records evidence_mismatch when the model returns only ungrounded rows", async () => {
    const db = createDbMock([textRow]);
    const create = vi.fn(async () => reply([{ fee_name: "Overdraft fee", canonical_key: "overdraft", amount: 35, source_line: "Overdraft fee $35.00" }]));

    const result = await runKnoxPaidExtract({ runId: 302, db: asDb(db), create });

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
    expect(insertCalls(db)).toHaveLength(0);
    expect(attemptCalls(db)[0]).toEqual(expect.arrayContaining(["evidence_mismatch", 0]));
  });

  it("skips texts with too few priced lines", async () => {
    const db = createDbMock([{ ...textRow, normalized_text: "Stop payment $31.00\nWire $25.00" }]);
    const create = vi.fn();

    const result = await runKnoxPaidExtract({ runId: 303, db: asDb(db), create });

    expect(PAID_MIN_PRICED_LINES).toBe(15);
    expect(result).toMatchObject({ selected: 0, processed: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it("stops cleanly at the budget cap without spending or recording an attempt", async () => {
    const db = createDbMock([textRow, { ...textRow, document_text_id: 802, text_hash: "dense-hash-2" }]);
    const create = vi.fn();
    trackAnthropicRequest.mockImplementation(async () => {
      const error = new Error("Knox paid budget reached ($150/month)");
      error.name = "ProviderBudgetBlockedError";
      throw error;
    });

    const result = await runKnoxPaidExtract({ runId: 304, db: asDb(db), create });

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ selected: 2, processed: 0, budgetStopped: true, budgetReason: "Knox paid budget reached ($150/month)", costMicrousd: 0 });
    expect(attemptCalls(db)).toHaveLength(0);
  });

  it("selects without calling the model on a dry run", async () => {
    const db = createDbMock([textRow]);
    const create = vi.fn();

    const result = await runKnoxPaidExtract({ runId: 305, dryRun: true, db: asDb(db), create });

    expect(result).toMatchObject({ dryRun: true, selected: 1, processed: 0 });
    expect(create).not.toHaveBeenCalled();
  });
});
