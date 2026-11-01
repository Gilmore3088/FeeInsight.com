// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
// The budget check and usage ledger are paid-pass's own (tested there); here a call is the fake model's reply.
vi.mock("@/lib/agents/paid-pass", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/agents/paid-pass")>();
  return {
    ...original,
    paidModelCall: async (options: { params: { model: string }; create: (params: unknown) => Promise<{ usage: unknown }> }) => {
      const message = await options.create(options.params);
      return { message, costMicrousd: original.paidCallCostMicrousd(options.params.model, message as never) };
    },
  };
});

import {
  bankCeilingMicrousd, feeMatchKey, normalizeForMatch, parseReadFees, reconcileReads, rekeyPrompt, REKEY_DONE,
  REKEY_FEE_KEYS, REKEY_MAX_COST_MICROUSD, REKEY_READS, REKEY_RESERVED, runAnswerKeyRekey, type ReadFee,
} from "./answer-key-rekey";

const DOC = "Monthly Maintenance Fee $12.00\nOverdraft Fee  $35.00 per item\nNSF fee: $35.00\nStop Payment – $30";

function fee(partial: Partial<ReadFee>): ReadFee {
  return { canonical_key: "overdraft", fee_name: "Overdraft", amount: 35, amount_kind: "fixed", frequency: "per item", audience: "consumer", source_line: "Overdraft Fee $35.00 per item", line_found: true, ...partial };
}

describe("answer-key re-key reconciliation", () => {
  it("finds a quoted line in the document whatever its spacing, case or dash", () => {
    const fees = parseReadFees({ fees: [
      { canonical_key: "overdraft", amount: "$35.00", amount_kind: "fixed", source_line: "overdraft fee $35.00 per item" },
      { canonical_key: "stop_payment", amount: 30, amount_kind: "fixed", source_line: "Stop Payment - $30" },
      { canonical_key: "nsf", amount: 36, amount_kind: "fixed", source_line: "NSF fee: $36.00" },
      { canonical_key: "", amount: 1, source_line: "no key" },
    ] }, DOC);
    expect(fees.map((f) => [f.canonical_key, f.amount, f.line_found])).toEqual([
      ["overdraft", 35, true], ["stop_payment", 30, true], ["nsf", 36, false],
    ]);
    expect(normalizeForMatch("A’s  “X”")).toBe("a's \"x\"");
  });

  it("agrees a fee only when both reads give the same type, kind and amount with lines in the document", () => {
    const a = [fee({}), fee({ canonical_key: "nsf", amount: 35 }), fee({ canonical_key: "monthly_maintenance", amount: 12 }), fee({ canonical_key: "made_up" })];
    const b = [fee({ source_line: "Overdraft Fee  $35.00 per item" }), fee({ canonical_key: "nsf", amount: 30 }), fee({ canonical_key: "monthly_maintenance", amount: 12, line_found: false })];
    const result = reconcileReads(a, b, [
      { canonical_key: "overdraft", amount: 35, amount_kind: "fixed" },
      { canonical_key: "paper_statement", amount: 2, amount_kind: "fixed" },
    ]);
    expect(result.agreed.map(feeMatchKey)).toEqual(["overdraft|fixed|35.00"]);
    expect(result.onlyA.map(feeMatchKey)).toEqual(["nsf|fixed|35.00", "monthly_maintenance|fixed|12.00"]);
    expect(result.onlyB.map(feeMatchKey)).toEqual(["nsf|fixed|30.00"]);
    expect(result.unproven.map((f) => [f.read, f.canonical_key, f.reason])).toEqual([
      ["a", "made_up", "unknown_fee_type"], ["b", "monthly_maintenance", "line_not_in_document"],
    ]);
    expect(result.oldKey).toEqual({ matched: 1, oldOnly: [{ canonical_key: "paper_statement", amount: 2, amount_kind: "fixed" }], newOnly: 0 });
  });

  it("matches repeated fees as a multiset", () => {
    const two = [fee({}), fee({})];
    expect(reconcileReads(two, [fee({})], []).agreed).toHaveLength(1);
    expect(reconcileReads(two, [fee({})], []).onlyA).toHaveLength(1);
  });

  it("frames the two reads differently, gives each the whole fee type list and never the old key", () => {
    const [a, b] = REKEY_READS.map((read) => rekeyPrompt(read, DOC));
    expect(a).not.toBe(b);
    expect(REKEY_READS[0].model()).not.toBe(REKEY_READS[1].model());
    for (const prompt of [a, b]) {
      expect(prompt).toContain(REKEY_FEE_KEYS.join(", "));
      expect(prompt).toContain(DOC);
      expect(prompt).not.toMatch(/answer key/i);
    }
  });

  it("prices a bank's ceiling at both reads' worst case, and an unpriced model dearly", () => {
    const ceiling = bankCeilingMicrousd(30_000);
    // 14,000 input tokens and 16,000 output at $4/$20 (Opus 5.5) and $2/$10 (Sonnet 5).
    expect(ceiling).toBe(14_000 * 4 + 16_000 * 20 + 14_000 * 2 + 16_000 * 10);
    const unpriced = bankCeilingMicrousd(30_000, [{ id: "a", model: () => "no-such-model", framing: "" }]);
    expect(unpriced).toBe(14_000 * 10 + 16_000 * 50);
  });
});

type Call = { text: string; values: unknown[] };

function fakeDb(state: { charge: number; banks: number }) {
  const calls: Call[] = [];
  let eventId = 100;
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$");
    calls.push({ text, values });
    if (text.includes("FROM answer_key_institutions k")) {
      const limit = Number(values[values.length - 1]);
      return Array.from({ length: Math.min(state.banks, limit) }, (_, i) => ({
        institution_id: 10 + i, answer_key_institution_id: 500 + i, text_id: 900 + i, source_document_id: 700 + i, source_url: "https://bank.example/fees.pdf", char_count: DOC.length,
      }));
    }
    if (text.includes("AS charge")) return [{ charge: state.charge }];
    if (text.includes("INSERT INTO agent_run_events")) return [{ id: eventId++ }];
    if (text.includes("SELECT normalized_text")) return [{ normalized_text: DOC }];
    if (text.includes("FROM answer_key_fees")) return [{ canonical_key: "overdraft", amount: "35.00", amount_kind: "fixed" }];
    return [];
  });
  return { db: db as never, calls };
}

const reply = (fees: unknown[]) => ({
  content: [{ type: "text", text: JSON.stringify({ fees }) }],
  usage: { input_tokens: 1_000, output_tokens: 500 },
}) as never;

describe("runAnswerKeyRekey", () => {
  it("reserves each bank before its calls, reads it twice and records the reconciliation without writing keys", async () => {
    const { db, calls } = fakeDb({ charge: 0, banks: 1 });
    const line = { canonical_key: "overdraft", amount: 35, amount_kind: "fixed", source_line: "Overdraft Fee $35.00 per item" };
    const create = vi.fn(async (params: { model: string }) => reply(params.model.includes("opus") ? [line, { ...line, canonical_key: "nsf", source_line: "NSF fee: $35.00" }] : [line]));
    const result = await runAnswerKeyRekey({ runId: 1, stepId: 2, db, create });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ read: 1, agreed: 1, disagreed: 1, failed: 0, stopped: null });
    const events = calls.filter((c) => c.text.includes("INSERT INTO agent_run_events"));
    expect(events.map((e) => e.values[2])).toEqual([REKEY_RESERVED, REKEY_DONE]);
    const done = JSON.parse(String(events[1].values[4]));
    expect(done).toMatchObject({ batchId: "2026-11-01", institutionId: 10, state: "read", costKnown: true, oldKey: { matched: 1, newOnly: 0 } });
    expect(calls.some((c) => /INSERT INTO answer_key|UPDATE answer_key/i.test(c.text))).toBe(false);
  });

  it("reads no bank whose ceiling would pass the batch cap", async () => {
    const { db, calls } = fakeDb({ charge: REKEY_MAX_COST_MICROUSD - 1_000, banks: 2 });
    const create = vi.fn();
    const result = await runAnswerKeyRekey({ runId: 1, db, create });
    expect(create).not.toHaveBeenCalled();
    expect(result.stopped).toMatch(/Batch cap/);
    expect(calls.some((c) => c.text.includes("INSERT INTO agent_run_events"))).toBe(false);
  });

  it("marks a bank stopped, not read, when a budget cap refuses a call, so a later step reads it again", async () => {
    const { db, calls } = fakeDb({ charge: 0, banks: 1 });
    const create = vi.fn(async () => { throw Object.assign(new Error("Monthly cap agent:answer_key_rekey"), { name: "ProviderBudgetBlockedError" }); });
    const result = await runAnswerKeyRekey({ runId: 1, db, create });
    expect(result.read).toBe(0);
    expect(result.stopped).toMatch(/Monthly cap/);
    const done = calls.filter((c) => c.text.includes("INSERT INTO agent_run_events")).map((c) => JSON.parse(String(c.values[4])));
    expect(done.at(-1)).toMatchObject({ state: "stopped", costKnown: true });
    expect(calls.find((c) => c.text.includes("FROM answer_key_institutions k"))?.text).toContain("<> 'stopped'");
  });

  it("makes no call on a dry run of the step", async () => {
    const { db } = fakeDb({ charge: 0, banks: 3 });
    const create = vi.fn();
    const result = await runAnswerKeyRekey({ runId: 1, db, create, dryRun: true });
    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, selected: 2 });
  });
});
