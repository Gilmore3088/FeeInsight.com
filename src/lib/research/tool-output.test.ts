import { describe, expect, it } from "vitest";
import { cacheLatestMessage, cachedSystem, compactToolResult, ledgerUsage, withCompactResults } from "./tool-output";
import type { LanguageModelUsage, ModelMessage } from "ai";

const fee = (i: number) => ({ fee_name: `Fee ${i}`, amount: i, conditions: "x".repeat(200), source_url: `https://bank.example/fees/${i}` });

describe("compactToolResult", () => {
  it("returns a small result unchanged", () => {
    const small = { identity: { id: 1 }, fees: [fee(1)] };
    expect(compactToolResult(small)).toBe(small);
  });

  it("shortens the largest list until the result fits, and says which list and by how much", () => {
    const big = { identity: { id: 1, name: "Bank" }, fees: { verified: Array.from({ length: 200 }, (_, i) => fee(i)), provisional: [fee(1)] } };
    const out = compactToolResult(big, 12_000) as Record<string, unknown> & { fees: { verified: unknown[]; provisional: unknown[] } };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(12_000 + 300);
    expect(out.identity).toEqual({ id: 1, name: "Bank" });
    expect(out.fees.provisional).toHaveLength(1);
    expect(out.fees.verified.length).toBeLessThan(200);
    expect(out.fees.verified[0]).toEqual(fee(0));
    expect(out._shortened).toContain(`fees.verified: first ${out.fees.verified.length} of 200`);
    // The caller's object is not modified.
    expect(big.fees.verified).toHaveLength(200);
  });

  it("handles a top-level array and a result with no lists", () => {
    const rows = compactToolResult(Array.from({ length: 300 }, (_, i) => fee(i)), 5_000) as { _shortened: string; rows: unknown[] };
    expect(rows.rows.length).toBeLessThan(300);
    expect(rows._shortened).toContain("rows: first");
    const text = compactToolResult({ note: "y".repeat(20_000) }, 5_000) as { _shortened: string; text: string };
    expect(text.text).toHaveLength(5_000);
  });
});

describe("withCompactResults", () => {
  it("wraps execute and keeps the tool's other fields", async () => {
    const tools = withCompactResults({ t: { description: "d", execute: async () => ({ rows: Array.from({ length: 500 }, (_, i) => fee(i)) }) } } as never, 4_000);
    const t = (tools as Record<string, { description: string; execute: () => Promise<{ rows: unknown[]; _shortened: string }> }>).t;
    expect(t.description).toBe("d");
    const out = await t.execute();
    expect(out.rows.length).toBeLessThan(500);
    expect(out._shortened).toBeTruthy();
  });
});

describe("prompt caching", () => {
  it("marks the system prompt and the newest message as cache points", () => {
    expect(cachedSystem("s").providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    const messages: ModelMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    const marked = cacheLatestMessage(messages);
    expect(marked[0]).toBe(messages[0]);
    expect(marked[1].providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(messages[1].providerOptions).toBeUndefined();
  });

  it("records cache reads and writes apart from uncached input", () => {
    const usage = {
      inputTokens: 100_000,
      outputTokens: 2_000,
      inputTokenDetails: { noCacheTokens: 10_000, cacheReadTokens: 80_000, cacheWriteTokens: 10_000 },
    } as unknown as LanguageModelUsage;
    expect(ledgerUsage(usage)).toEqual({ inputTokens: 10_000, outputTokens: 2_000, cacheReadInputTokens: 80_000, cacheCreationInputTokens: 10_000 });
    expect(ledgerUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
  });
});
