import { beforeEach, describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

const loadKnoxLessons = vi.fn(async (_db: unknown) => new Map());
vi.mock("./lessons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lessons")>()),
  loadKnoxLessons: (db: unknown) => loadKnoxLessons(db),
}));

import { KNOX_RULES_STRATEGY } from "./specialists";
import { lessonsFor } from "@/lib/agents/learning/lesson-reader";
import { categoryLessonsForText, lessonsFrom } from "./lessons";
import { articleLinkSql } from "@/lib/agents/magellan/link-coverage";
import { providerRefusalSql } from "@/lib/agents/paid-pass";
import {
  groundPaidRow,
  KNOX_PAID_FLAG,
  KNOX_PAID_STRATEGY,
  PAID_MIN_PRICED_LINES,
  paidExtractInstructions,
  paidExtractPrompt,
  paidReadLessons,
  planPaidReads,
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

  it("reads a monthly fee's lineup fields, keeping only the ones the text states", () => {
    const text = [
      "Premier Checking | $12.00 monthly maintenance fee",
      "Waived with a $1,500 minimum daily balance or $500 in direct deposits.",
      "Minimum opening deposit $100.",
    ].join("\n");
    const row = {
      fee_name: "Premier Checking monthly maintenance fee",
      canonical_key: "monthly_maintenance",
      amount: 12,
      frequency: "monthly",
      source_line: "Premier Checking | $12.00 monthly maintenance fee",
      product_name: "Premier  Checking",
      min_balance_to_avoid: 1500,
      // Invented: the text never states $2,500.
      min_opening_deposit: 2500,
      waiver_text: null,
      conditions: "Waived with a $1,500 minimum daily balance or $500 in direct deposits.",
    };
    expect(groundPaidRow(row, text)).toMatchObject({
      canonicalKey: "monthly_maintenance",
      lineup: {
        productName: "Premier Checking",
        minBalanceToAvoid: 1500,
        minOpeningDeposit: null,
        // The waiver came back in `conditions`; it is kept because the text states it.
        waiverText: "Waived with a $1,500 minimum daily balance or $500 in direct deposits.",
      },
    });
    expect(groundPaidRow({ ...row, min_opening_deposit: "$100", waiver_text: "Waived for students" }, text)).toMatchObject({
      lineup: { minOpeningDeposit: 100, waiverText: null },
    });
    // Other categories never carry lineup fields.
    expect(groundPaidRow({ ...row, canonical_key: "minimum_balance" }, text)).toMatchObject({ lineup: null });
    expect(paidExtractInstructions()).toContain("For a monthly_maintenance fee only");
    expect(paidExtractPrompt(text)).toBe(`Document text:\n${text}`);
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
    const request = (create.mock.calls[0] as unknown as [{ system: Array<{ text: string; cache_control?: unknown }>; messages: Array<{ content: string }> }])[0];
    const prompt = String(request.messages[0].content);
    expect(prompt).toContain("Domestic wires you send cost $27.50 per wire.");
    // #2068: the fixed instructions and fee list come first, cached; the document's lessons follow.
    expect(request.system[0].text).toContain("wire_domestic_outgoing (Wire Transfer (Domestic Out))");
    expect(request.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(prompt).not.toContain("Canonical keys:");
    // The lessons written for the paid step always ride, at most ten in all.
    const own = lessonsFor("knox", "extract-paid").filter((lesson) => lesson.appliesTo !== "all").map((lesson) => lesson.id);
    expect(own.length).toBeGreaterThan(0);
    const lessons = request.system[1].text;
    expect(lessons).toContain("LESSONS FOR YOUR ROLE");
    for (const id of own) expect(lessons).toContain(`[${id}]`);
    expect(lessons.split("\n").filter((line) => line.startsWith("- [")).length).toBeLessThanOrEqual(10);
    expect(trackAnthropicRequest).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ lessons_applied: expect.arrayContaining(own), category_lessons_sent: [] }) }),
      expect.any(Function),
    );
    expect(result.lessonsSent).toMatchObject({ reads: 1, readsWithCategoryLessons: 0 });

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
    const attemptDetail = JSON.parse(String(attempt[attempt.length - 1]));
    expect(attemptDetail).toMatchObject({ returned: 3, accepted: 2, rejected: { not_in_text: 1 } });
    // #1101: each kept fee is filed against today's free read of the same text, with the text's
    // layout and the page's host, on the attempt and in one step event.
    expect(attemptDetail.free_misses).toMatchObject({ version: 1, host: "densebank.example", paid_finds: 2 });
    const byKind = attemptDetail.free_misses.by_kind as Record<string, number>;
    expect(Object.values(byKind).reduce((sum, count) => sum + count, 0)).toBe(2);
    const allEvents = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO agent_run_events"));
    expect(allEvents).toHaveLength(2);
    expect(allEvents.some((call) => templateText(call[0]).includes("'knox.paid_lessons_sent'"))).toBe(true);
    const events = allEvents.filter((call) => templateText(call[0]).includes("'knox.paid_find_misses'"));
    expect(events).toHaveLength(1);
    expect(templateText(events[0][0])).toContain("'knox.paid_find_misses'");
    expect(String(events[0][3])).toMatch(/^Knox's paid pass kept 2 fees: the free team already read \d+/);
    expect(JSON.parse(String(events[0][4]))).toMatchObject({ by_kind: byKind, repeated: [], texts: [{ institution_id: 52, document_text_id: 801, host: "densebank.example" }] });

    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("pa.strategy_version");
    expect(query).toContain("free.yield_count <");
    // #1101: the bank's platform rides each selected text.
    expect(query).toContain("LEFT JOIN institution_source_profiles profile");
    expect(query).toContain("paid.strategy =");
    // No paid read for a closed bank or for a text Darwin judged another bank's (2026-10-17).
    expect(query).toContain("AND NOT (inst.");
    expect(query).toContain("'owner:' || adt.institution_id::text");
    expect(query).toContain("owner.strategy = 'verify.document_owner'");
    expect(query).toContain("WHERE latest.outcome = 'evidence_mismatch'");
    // No paid read of an article, blog, learning or advice page (#1774).
    expect(query).toContain(`AND NOT ${articleLinkSql("adt.source_url")}`);
    expect(params).toEqual(expect.arrayContaining([KNOX_RULES_STRATEGY.strategy, KNOX_RULES_STRATEGY.version, KNOX_PAID_STRATEGY.strategy, "TX"]));
  });

  it("writes a monthly fee's grounded lineup fields on its raw row", async () => {
    const line = "Premier Checking monthly maintenance fee $12.00, waived with a $1,500 minimum daily balance.";
    const db = createDbMock([{ ...textRow, normalized_text: `${denseText}\n${line}` }]);
    const create = vi.fn(async () =>
      reply({
        fees: [
          {
            fee_name: "Premier Checking monthly maintenance fee",
            canonical_key: "monthly_maintenance",
            amount: 12,
            frequency: "monthly",
            source_line: line,
            product_name: "Premier Checking",
            min_balance_to_avoid: 1500,
            min_opening_deposit: 50,
            waiver_text: "waived with a $1,500 minimum daily balance",
          },
        ],
      }),
    );

    await runKnoxPaidExtract({ runId: 306, db: asDb(db), create });

    const [insert] = insertCalls(db);
    expect(insert.slice(7, 9)).toEqual(["Premier Checking monthly maintenance fee", 12]);
    // product_name, min_balance_to_avoid, min_opening_deposit ($50 is not in the text), waiver_text
    expect(insert.slice(12, 16)).toEqual(["Premier Checking", 1500, null, "waived with a $1,500 minimum daily balance"]);
  });

  it("sends the category lessons its document prints and files kept fees by them (#2068)", async () => {
    const lessons = lessonsFrom([
      { name: "statement copy", wrongKey: "paper_statement", rightKey: "document_reproduction", wrongBanks: 3, rightBanks: 4 },
      // Another bank's lesson never rides this bank's read.
      { institutionId: 99, name: "stop payment", wrongKey: "stop_payment", rightKey: "wire_domestic_incoming", wrongBanks: 1, rightBanks: 1 },
      // Not printed in the text.
      { name: "overdraft transfer", wrongKey: "overdraft", rightKey: "od_protection_transfer", wrongBanks: 2, rightBanks: 2 },
      // A family printed within a few words ("Domestic wires you send").
      { name: "family:domestic send wire", wrongKey: "wire_intl_outgoing", rightKey: "wire_domestic_outgoing", wrongBanks: 2, rightBanks: 3 },
    ]);
    loadKnoxLessons.mockResolvedValueOnce(lessons);
    const line = "Statement copy $5.00 each";
    const db = createDbMock([{ ...textRow, normalized_text: `${denseText}\n${line}` }]);
    const create = vi.fn(async () =>
      reply({ fees: [{ fee_name: "Statement copy", canonical_key: "paper_statement", amount: 5, frequency: "per_item", conditions: null, source_line: line }] }),
    );

    const result = await runKnoxPaidExtract({ runId: 307, stepId: 37, db: asDb(db), create });

    const request = (create.mock.calls[0] as unknown as [{ system: Array<{ text: string }> }])[0];
    const block = request.system[1].text;
    expect(block).toContain("CATEGORY LESSONS FOR THIS DOCUMENT");
    expect(block).toContain('- "statement copy": file under document_reproduction, not paper_statement.');
    expect(block).toContain('- names with the words "domestic send wire": file under wire_domestic_outgoing, not wire_intl_outgoing.');
    expect(block).not.toContain("overdraft transfer");
    expect(block).not.toContain("wire_domestic_incoming");
    // The model kept the old category; the lesson files the fee anyway, with the free read's flag.
    const flags = JSON.parse(String(insertCalls(db)[0][11]));
    expect(flags).toEqual(expect.arrayContaining(["canonical_hint:document_reproduction", "knox_lesson:paper_statement->document_reproduction", KNOX_PAID_FLAG]));
    const detail = JSON.parse(String(attemptCalls(db)[0].at(-1)));
    expect(detail.lessons_sent.category).toEqual([
      "name:statement copy:paper_statement->document_reproduction",
      "family:domestic send wire:wire_intl_outgoing->wire_domestic_outgoing",
    ]);
    expect(detail.lesson_refiles).toEqual({ "knox_lesson:paper_statement->document_reproduction": 1 });
    expect(result.lessonsSent).toMatchObject({ reads: 1, readsWithCategoryLessons: 1, category: { "name:statement copy:paper_statement->document_reproduction": 1 } });
    const event = db.mock.calls.find((call) => templateText(call[0]).includes("'knox.paid_lessons_sent'"));
    expect(JSON.parse(String(event?.[4]))).toMatchObject({ reads: 1, texts: [{ institution_id: 52, document_text_id: 801 }] });
  });

  it("never names a retired category in the prompt (#2068)", () => {
    const lessons = lessonsFrom([
      { name: "statement copy", wrongKey: "paper_statement", rightKey: "document_reproduction", wrongBanks: 3, rightBanks: 4 },
      { name: "stop payment", wrongKey: "stop_payment", rightKey: "retired_category_key", wrongBanks: 3, rightBanks: 4 },
      { name: "domestic wires you send", wrongKey: "retired_category_key", rightKey: "wire_domestic_outgoing", wrongBanks: 3, rightBanks: 4 },
      { name: "family:domestic send wire", wrongKey: "wire_intl_outgoing", rightKey: "retired_category_key", wrongBanks: 3, rightBanks: 4 },
    ]);
    const read = paidReadLessons(`${denseText}\nStatement copy $5.00 each`, 52, lessons);
    expect(read.categoryLessons.map((lesson) => lesson.id)).toEqual(["name:statement copy:paper_statement->document_reproduction"]);
    expect(read.block).not.toContain("retired_category_key");
  });

  it("matches a family only within a few words on one line, as before the word index (#2068)", () => {
    const lessons = lessonsFrom([{ name: "family:domestic outgoing wire", wrongKey: "wire_intl_outgoing", rightKey: "wire_domestic_outgoing", wrongBanks: 2, rightBanks: 2 }]);
    const ids = (text: string) => categoryLessonsForText(lessons, text, 52).map((lesson) => lesson.id);
    const id = "family:domestic outgoing wire:wire_intl_outgoing->wire_domestic_outgoing";
    expect(ids("Outgoing Domestic Wires $25.00")).toEqual([id]);
    expect(ids("Wire transfer, domestic, outgoing: $25.00")).toEqual([id]);
    // All the words, but on two lines.
    expect(ids("Domestic wire $25.00\nOutgoing items $5.00")).toEqual([]);
    // All the words on one line, but too far apart.
    expect(ids("Domestic checking statement copy research notary photocopy wire $25.00 outgoing")).toEqual([]);
    // A word the document never prints.
    expect(ids("Domestic wire $25.00")).toEqual([]);
  });

  it("scopes role lessons to the document and caps category lessons by count and size", () => {
    const many = lessonsFrom(
      Array.from({ length: 40 }, (_, index) => ({ name: `service number ${["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][index % 10]} ${"x".repeat(index + 1)}`, wrongKey: "paper_statement", rightKey: "document_reproduction", wrongBanks: 2, rightBanks: 2 })),
    );
    const text = Array.from(many.values()).map((lesson) => `${lesson.name} $1.00`).join("\n");
    expect(paidReadLessons(text, 52, many).categoryLessons.length).toBe(20);
    expect(paidReadLessons(text, 52, new Map()).categoryLessons).toEqual([]);
    // A text about nothing in particular carries only the lessons written for the paid step.
    const own = lessonsFor("knox", "extract-paid").filter((lesson) => lesson.appliesTo !== "all").map((lesson) => lesson.id);
    expect(paidReadLessons("Zzz $1.00", 52, new Map()).roleLessonIds.sort()).toEqual([...own].sort());
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

  it("plans no paid call for a page whose paid read found no fee", () => {
    const rows = [
      { document_text_id: 1, source_document_id: 11, institution_id: 52, text_hash: "a", no_fee_read_id: null },
      { document_text_id: 2, source_document_id: 12, institution_id: 52, text_hash: "a", no_fee_read_id: null },
      { document_text_id: 4, source_document_id: 14, institution_id: 52, text_hash: "b", no_fee_read_id: 7001 },
      { document_text_id: 5, source_document_id: 15, institution_id: 52, text_hash: "c" },
      { document_text_id: 6, source_document_id: 16, institution_id: 52, text_hash: "d", no_fee_read_id: null },
    ];

    const plan = planPaidReads(rows, 3);

    // The same text under a second document is still read; the limit counts reads, not skips.
    expect(plan.reads.map((row) => row.document_text_id)).toEqual([1, 2, 5]);
    expect(plan.skips).toEqual([
      { documentTextId: 4, sourceDocumentId: 14, institutionId: 52, textHash: "b", reason: "page_read_before_no_fees", priorAttemptId: 7001 },
    ]);
  });

  it("logs each skipped read on the step and buys no call for it", async () => {
    const db = createDbMock([
      textRow,
      { ...textRow, document_text_id: 803, source_document_id: 603, text_hash: "refetched-hash", no_fee_read_id: 7001 },
    ]);
    const create = vi.fn(async () => reply({ fees: [] }));

    const result = await runKnoxPaidExtract({ runId: 307, stepId: 37, db: asDb(db), create });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ selected: 1, processed: 1 });
    expect(result.results).toEqual(
      expect.arrayContaining([{ document_text_id: 803, skip_reason: "page_read_before_no_fees", prior_attempt_id: 7001 }]),
    );
    // The no-fee page gets a $0 rejected attempt so it is not selected again.
    const attempts = attemptCalls(db);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(expect.arrayContaining([52, 603, "extract", KNOX_PAID_STRATEGY.strategy, KNOX_PAID_STRATEGY.version, "refetched-hash", "rejected", 0, 0, 307, 37]));
    expect(JSON.parse(String(attempts[0][attempts[0].length - 1]))).toEqual({ document_text_id: 803, skipped: "page_read_before_no_fees", prior_attempt_id: 7001 });
    expect(attempts[1]).toEqual(expect.arrayContaining([601, "dense-hash", "no_candidates"]));

    const event = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO agent_run_events"));
    expect(event).toBeDefined();
    expect(templateText(event?.[0])).toContain("'knox.paid_read_skipped'");
    expect(event?.slice(1, 4)).toEqual([
      307,
      37,
      "Knox skipped 1 paid read that would yield nothing, $0 spent: 1 because a paid read of this page found no fee before.",
    ]);

    const [query] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain(") AS no_fee_read_id");
    expect(query).toContain("prior.outcome = 'no_candidates'");
    expect(query).toContain("found.yield_count > 0");
    expect(query).toContain(`AND NOT ${providerRefusalSql("paid")}`);
  });

  it("selects without calling the model on a dry run", async () => {
    const db = createDbMock([textRow]);
    const create = vi.fn();

    const result = await runKnoxPaidExtract({ runId: 305, dryRun: true, db: asDb(db), create });

    expect(result).toMatchObject({ dryRun: true, selected: 1, processed: 0 });
    expect(create).not.toHaveBeenCalled();
  });
});
