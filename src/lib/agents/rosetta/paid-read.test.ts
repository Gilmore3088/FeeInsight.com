import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { ProviderBudgetBlockedError } from "@/lib/ai-provider-usage";
import { PAID_PASS_MODELS } from "@/lib/agents/paid-pass";

import { PAID_READ_PROMPT, runRosettaPaidRead } from "./paid-read";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const scan = (id: number) => ({
  source_document_id: id,
  institution_id: 40 + id,
  institution_name: `Scan Bank ${id}`,
  document_url: `https://scan${id}.example/fees.pdf`,
  content_hash: `hash-${id}`,
});

function paidDb(rows: Array<Record<string, unknown>>, { learning = true } = {}): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: learning }]);
    if (text.includes("vault_schema_ready")) return Promise.resolve([{ vault_schema_ready: true }]);
    if (text.includes("rosetta_text_columns_ready")) return Promise.resolve([{ rosetta_text_columns_ready: true }]);
    if (text.includes("INSERT INTO agent_source_texts")) return Promise.resolve([{ id: 990 }]);
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => Promise.resolve(query.includes("FROM agent_source_texts adt") ? rows : []));
  return db;
}

const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof runRosettaPaidRead>[0]["db"]>;

const pdfBytes = new TextEncoder().encode("%PDF-1.4 scanned bytes");
const pdfFetch = () => vi.fn(async () => new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf" } }));
const message = (text: string, stop_reason = "end_turn") =>
  ({ content: [{ type: "text", text }], stop_reason, usage: { input_tokens: 3000, output_tokens: 400 } }) as never;

function attempts(db: DbMock): Array<[string, string, number]> {
  return db.mock.calls
    .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
    .map((call) => [call[4] as string, call[7] as string, call[9] as number]);
}

describe("Rosetta paid read (pass 3)", () => {
  it("sends a scan as a PDF document block and stores the transcription like a normal read", async () => {
    const db = paidDb([scan(1)]);
    const transcription = ["SCHEDULE OF FEES", "Overdraft fee | $35.00", "NSF fee | $35.00", "Stop payment | $30.00"].join("\n");
    const create = vi.fn<(params: unknown) => Promise<never>>(async () => message(transcription));

    const result = await runRosettaPaidRead({ runId: 900, stepId: 4, db: asDb(db), create, fetchImpl: pdfFetch(), pageCounter: async () => 3 });

    expect(result).toMatchObject({ selected: 1, processed: 1, succeeded: 1, failed: 0, budgetStopped: false });
    expect(result.costMicrousd).toBeGreaterThan(0);
    const params = create.mock.calls[0][0] as { model: string; messages: Array<{ content: Array<Record<string, unknown>> }> };
    expect(params.model).toBe(PAID_PASS_MODELS.read());
    expect(params.messages[0].content[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdfBytes).toString("base64") },
    });
    expect(params.messages[0].content[1]).toEqual({ type: "text", text: PAID_READ_PROMPT });
    expect(trackAnthropicRequest).toHaveBeenCalledWith(expect.objectContaining({ agent: "rosetta", operation: "paid_read", agentRunId: 900 }), expect.any(Function));

    const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO agent_source_texts"));
    expect(insert).toEqual(expect.arrayContaining([900, 1, 41, "completed", transcription]));
    const update = db.mock.calls.find((call) => templateText(call[0]).includes("SET table_rows ="));
    expect(JSON.parse(update![1] as string).rows).toHaveLength(3);
    expect(update![2]).toBe("read.paid_transcribe");
    const recorded = attempts(db);
    expect(recorded[0]).toEqual(["read.paid_transcribe", "ok", result.costMicrousd]);
    expect(recorded.map(([strategy]) => strategy)).toEqual(["read.paid_transcribe", "read.table_rows", "read.page_check"]);
  });

  describe("text PDFs whose fees did not hold up after the free readers", () => {
    const current = ["SCHEDULE OF FEES", "Overdraft fee | $35.00", "NSF fee | $35.00", "Stop payment | $30.00"].join("\n");
    const lost = (id: number) => ({ ...scan(id), text_status: "completed", current_text: current });
    function survivalDb(rows: Array<Record<string, unknown>>): DbMock {
      const db = paidDb(rows);
      const base = db.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;
      db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
        templateText(strings).includes("to_regclass('public.pipeline_feedback')") ? Promise.resolve([{ ready: true }]) : base(strings, ...values),
      );
      return db;
    }

    it("selects them after scans, once free OCR has had the same bytes", async () => {
      const db = survivalDb([]);

      await runRosettaPaidRead({ runId: 910, db: asDb(db), create: vi.fn(), fetchImpl: pdfFetch() });

      const query = String(db.unsafe.mock.calls[0][0]);
      expect(query).toContain("adt.status = 'completed'");
      expect(query).toContain("lost.signal = 'wrong'");
      expect(query).toContain("rung.strategy =");
      expect(query).toContain("ORDER BY (adt.status = 'needs_ocr') DESC");
      expect(db.unsafe.mock.calls[0][1]).toEqual(expect.arrayContaining(["rosetta.text_survival", "read.ocr_tesseract", "read.pdf_layout"]));
    });

    it("replaces the stored text only with a transcription that lists at least as many fees", async () => {
      const richer = [current, "Wire transfer fee | $25.00"].join("\n");
      const db = survivalDb([lost(1)]);
      const create = vi.fn<(params: unknown) => Promise<never>>(async () => message(richer));

      const result = await runRosettaPaidRead({ runId: 911, db: asDb(db), create, fetchImpl: pdfFetch(), pageCounter: async () => 2 });

      expect(result).toMatchObject({ processed: 1, succeeded: 1 });
      expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO agent_source_texts"))).toBe(true);
      expect(attempts(db)[0].slice(0, 2)).toEqual(["read.paid_transcribe", "ok"]);
    });

    it("keeps the earlier text and logs low_yield when the transcription is thinner", async () => {
      const db = survivalDb([lost(2)]);
      const create = vi.fn<(params: unknown) => Promise<never>>(async () => message("SCHEDULE OF FEES\nOverdraft fee | $35.00"));

      const result = await runRosettaPaidRead({ runId: 912, db: asDb(db), create, fetchImpl: pdfFetch(), pageCounter: async () => 2 });

      expect(result).toMatchObject({ processed: 1, succeeded: 1 });
      expect(result.costMicrousd).toBeGreaterThan(0);
      expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO agent_source_texts"))).toBe(false);
      expect(db.mock.calls.some((call) => templateText(call[0]).includes("fee_schedule_url = NULL"))).toBe(false);
      expect(attempts(db)).toEqual([["read.paid_transcribe", "low_yield", result.costMicrousd]]);
    });
  });

  it("stops cleanly at the budget cap without spending or recording", async () => {
    const db = paidDb([scan(1), scan(2)]);
    const create = vi.fn();
    trackAnthropicRequest.mockImplementationOnce(async () => {
      throw new ProviderBudgetBlockedError("budget_monthly_exhausted", "Rosetta monthly cap reached");
    });

    const result = await runRosettaPaidRead({ runId: 901, db: asDb(db), create, fetchImpl: pdfFetch(), pageCounter: async () => 2 });

    expect(result).toMatchObject({ selected: 2, processed: 0, budgetStopped: true, budgetReason: "Rosetta monthly cap reached", costMicrousd: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(attempts(db)).toEqual([]);
  });

  it("records an empty transcription with its cost and leaves the text queued", async () => {
    const db = paidDb([scan(3)]);
    const result = await runRosettaPaidRead({
      runId: 902,
      db: asDb(db),
      create: vi.fn(async () => message("NO_TEXT")),
      fetchImpl: pdfFetch(),
      pageCounter: async () => 1,
    });

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
    expect(attempts(db)).toEqual([["read.paid_transcribe", "empty", result.costMicrousd]]);
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO agent_source_texts"))).toBe(false);
  });

  it("does not send scans longer than the API reads", async () => {
    const db = paidDb([scan(4)]);
    const create = vi.fn();

    const result = await runRosettaPaidRead({ runId: 903, db: asDb(db), create, fetchImpl: pdfFetch(), pageCounter: async () => 250 });

    expect(create).not.toHaveBeenCalled();
    expect(attempts(db)).toEqual([["read.paid_transcribe", "too_large", 0]]);
    expect(result.failed).toBe(1);
  });

  it("selects only scans the current free reader already tried, without a settled paid attempt", async () => {
    const db = paidDb([]);

    await runRosettaPaidRead({ runId: 904, db: asDb(db), stateCode: "vt", create: vi.fn() });

    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("adt.status = 'needs_ocr'");
    expect(query).toContain("free_read.strategy_version >=");
    expect(query).toContain("paid.strategy =");
    const valueAt = (placeholder: string) => params[Number(placeholder) - 1];
    for (const [, n] of query.matchAll(/\$(\d+)::text\[\]/g)) expect(Array.isArray(valueAt(n))).toBe(true);
    expect(valueAt(query.match(/LIMIT \$(\d+)/)![1])).toBe(10);
    expect(params).toContain("VT");
  });

  it("does nothing before the learning schema exists, and dry runs never call the model", async () => {
    const noLearning = paidDb([scan(5)], { learning: false });
    expect(await runRosettaPaidRead({ runId: 905, db: asDb(noLearning) })).toMatchObject({ selected: 0, processed: 0 });
    expect(noLearning.unsafe).not.toHaveBeenCalled();

    const create = vi.fn();
    const dry = await runRosettaPaidRead({ runId: 906, dryRun: true, db: asDb(paidDb([scan(5)])), create });
    expect(dry).toMatchObject({ selected: 1, processed: 0, dryRun: true });
    expect(create).not.toHaveBeenCalled();
  });
});
