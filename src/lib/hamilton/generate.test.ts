/**
 * Tests for generateGlobalThesis() and formatContext() changes in generate.ts.
 *
 * Uses vi.mock to stub the Anthropic SDK — no real API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mockCreate reference hoisted to module scope so the mock factory can close over it
const mockCreate = vi.fn();

// Mock Anthropic SDK before importing generate.ts
// Must use a real class so `new Anthropic(...)` works in generate.ts
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockCreate };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic };
});

vi.mock("@/lib/ai-provider-usage", () => ({
  trackAnthropicRequest: async (_context: unknown, request: () => Promise<unknown>) => request(),
}));

import { generateGlobalThesis, generateSection } from "./generate";
import type { ThesisInput } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeThesisInput(scopeOverride: ThesisInput["scope"] = "quarterly"): ThesisInput {
  return {
    scope: scopeOverride,
    data: {
      quarter: "Q1 2025",
      total_institutions: 1200,
      top_categories: [
        {
          fee_category: "overdraft",
          display_name: "Overdraft Fee",
          median_amount: 35,
          bank_median: 38,
          cu_median: 28,
          institution_count: 900,
          maturity_tier: "strong",
        },
      ],
      revenue_snapshot: {
        latest_quarter: "Q4 2024",
        total_service_charges: 48_000_000_000,
        yoy_change_pct: -3.6,
        bank_service_charges: 36_000_000_000,
        cu_service_charges: 12_000_000_000,
        total_institutions: 8000,
      },
      fred_snapshot: {
        fed_funds_rate: 5.25,
        unemployment_rate: 3.9,
        cpi_yoy_pct: 3.1,
        consumer_sentiment: 72.5,
        as_of: "2024-12-01",
      },
      beige_book_themes: ["Boston: moderate activity.", "New York: tightening."],
      derived_tensions: ["Banks charge more than credit unions in 12 of 15 comparable categories"],
    },
  };
}

function makeQuarterlyResponse(): string {
  return JSON.stringify({
    core_thesis: "Fee convergence masks a revenue crisis as pricing power erodes across all tiers.",
    tensions: [
      {
        force_a: "Fee pricing converges across institutions",
        force_b: "Revenue diverges sharply by charter type",
        implication: "Banks must differentiate on experience, not price.",
      },
      {
        force_a: "Credit union fee advantage narrows",
        force_b: "Bank market share pressure intensifies",
        implication: "Competitive moat is eroding — repositioning required within 18 months.",
      },
    ],
    revenue_model:
      "Total service charges declined 3.6% YoY to $48,000,000,000, with banks capturing 75% of volume.",
    competitive_dynamic:
      "Banks charge more in 12 of 15 comparable categories — a premium not translating into revenue retention.",
    contrarian_insight:
      "The overdraft fee remains the single most stable revenue line across both charter types.",
    narrative_summary:
      "The Q1 2025 fee index reveals a sector at a pricing inflection point. Fee convergence accelerates while revenue diverges. Banks retain a pricing premium but are losing the revenue war as volume shifts to credit unions.",
  });
}

function makeLighterResponse(): string {
  // No contrarian_insight field — lighter scope (monthly_pulse, etc.)
  return JSON.stringify({
    core_thesis: "Monthly fee trends show overdraft compression without revenue offset.",
    tensions: [
      {
        force_a: "Overdraft fees decline under pressure",
        force_b: "No replacement revenue stream emerges",
        implication: "Banks face net fee income contraction through Q2.",
      },
    ],
    revenue_model: "Service charges are tracking below prior year across most categories.",
    competitive_dynamic: "Credit unions hold price discipline while banks absorb regulatory cost.",
    narrative_summary:
      "The monthly pulse for Q1 2025 shows overdraft fee compression accelerating without an offsetting revenue stream. Credit unions are holding price discipline while banks absorb the regulatory burden.",
  });
}

function mockSuccessResponse(rawJson: string) {
  mockCreate.mockResolvedValue({
    content: [{ type: "text", text: rawJson }],
    usage: { input_tokens: 800, output_tokens: 420 },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("generateGlobalThesis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key-12345";
  });

  it("returns ThesisOutput with all fields for quarterly scope", async () => {
    mockSuccessResponse(makeQuarterlyResponse());

    const input = makeThesisInput("quarterly");
    const result = await generateGlobalThesis(input);

    expect(result.core_thesis).toBeTruthy();
    expect(result.tensions).toHaveLength(2);
    expect(result.tensions[0]).toMatchObject({
      force_a: expect.any(String),
      force_b: expect.any(String),
      implication: expect.any(String),
    });
    expect(result.revenue_model).toBeTruthy();
    expect(result.competitive_dynamic).toBeTruthy();
    expect(result.contrarian_insight).toBeTypeOf("string");
    expect(result.narrative_summary).toBeTruthy();
    expect(result.model).toBeTruthy();
    expect(result.usage.inputTokens).toBe(800);
    expect(result.usage.outputTokens).toBe(420);
  });

  it("sets contrarian_insight to null for non-quarterly scope", async () => {
    mockSuccessResponse(makeLighterResponse());

    const input = makeThesisInput("monthly_pulse");
    const result = await generateGlobalThesis(input);

    // lighter response has no contrarian_insight field → should be null
    expect(result.contrarian_insight).toBeNull();
  });

  it("throws error with unparseable JSON message prefix", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "This is not JSON at all — just text." }],
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    const input = makeThesisInput("quarterly");

    await expect(generateGlobalThesis(input)).rejects.toThrow(
      "Hamilton thesis generation returned unparseable JSON [scope=quarterly]",
    );
  });

  it("throws error when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const input = makeThesisInput("quarterly");

    await expect(generateGlobalThesis(input)).rejects.toThrow(
      "Hamilton thesis generation: AI service not configured. Set ANTHROPIC_API_KEY.",
    );
  });

  it("throws error when Claude API call fails", async () => {
    mockCreate.mockRejectedValue(new Error("Connection timeout"));

    const input = makeThesisInput("quarterly");

    await expect(generateGlobalThesis(input)).rejects.toThrow(
      "Hamilton thesis generation failed [scope=quarterly]",
    );
  });

  it("throws error on empty response from Claude", async () => {
    mockCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 50, output_tokens: 0 },
    });

    const input = makeThesisInput("quarterly");

    await expect(generateGlobalThesis(input)).rejects.toThrow(
      "Hamilton returned empty thesis response [scope=quarterly]",
    );
  });
});

describe("formatContext change (no 75-word limit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key-12345";
  });

  it("generateSection does not inject HARD LIMIT text into Claude request", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Fee pricing is commoditized." }],
      usage: { input_tokens: 200, output_tokens: 15 },
    });

    await generateSection({
      type: "overview",
      title: "Test Section",
      data: { median: 25 },
      context: "This is the user-provided context.",
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage: string = callArgs.messages[0].content;

    expect(userMessage).not.toContain("HARD LIMIT");
    expect(userMessage).not.toContain("75 words");
    // Context should still appear when provided
    expect(userMessage).toContain("This is the user-provided context.");
  });

  it("generateSection omits CONTEXT block when no context provided", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Fees are stable." }],
      usage: { input_tokens: 180, output_tokens: 10 },
    });

    await generateSection({
      type: "findings",
      title: "Key Findings",
      data: { count: 42 },
      // no context field
    });

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage: string = callArgs.messages[0].content;

    expect(userMessage).not.toContain("CONTEXT:");
    expect(userMessage).not.toContain("HARD LIMIT");
  });
});

// SECTION-03: Word budget contract — 150-200 words per section.
// Tests 1-2 confirm countWords() accurately measures in-range output.
// Tests 3-4 confirm the measurement detects out-of-range output (CI with real keys will catch regressions).
describe("generateSection word count range (SECTION-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key-12345";
  });

  /**
   * Generate a deterministic n-word string using the pattern "word-1 word-2 word-3 ...".
   * Used to construct mock API responses of an exact known word count.
   */
  function makeNWords(n: number): string {
    return Array.from({ length: n }, (_, i) => `word-${i + 1}`).join(" ");
  }

  it("mock response with 150 words produces wordCount >= 150 and <= 200", async () => {
    const text = makeNWords(150);
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text }],
      usage: { input_tokens: 300, output_tokens: 150 },
    });

    const result = await generateSection({
      type: "overview",
      title: "Test Section",
      data: { median: 25 },
    });

    expect(result.wordCount).toBeGreaterThanOrEqual(150);
    expect(result.wordCount).toBeLessThanOrEqual(200);
  });

  it("mock response with 175 words produces wordCount in 150-200 range", async () => {
    const text = makeNWords(175);
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text }],
      usage: { input_tokens: 320, output_tokens: 175 },
    });

    const result = await generateSection({
      type: "findings",
      title: "Test Findings",
      data: { count: 10 },
    });

    expect(result.wordCount).toBeGreaterThanOrEqual(150);
    expect(result.wordCount).toBeLessThanOrEqual(200);
  });

  it("mock response with 120 words produces wordCount below minimum (detects under-range output)", async () => {
    const text = makeNWords(120);
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text }],
      usage: { input_tokens: 280, output_tokens: 120 },
    });

    const result = await generateSection({
      type: "overview",
      title: "Short Section",
      data: { value: 5 },
    });

    expect(result.wordCount).toBe(120);
    expect(result.wordCount).toBeLessThan(150);
  });

  it("mock response with 220 words produces wordCount above maximum (detects over-range output)", async () => {
    const text = makeNWords(220);
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text }],
      usage: { input_tokens: 350, output_tokens: 220 },
    });

    const result = await generateSection({
      type: "recommendation",
      title: "Long Section",
      data: { metric: 42 },
    });

    expect(result.wordCount).toBe(220);
    expect(result.wordCount).toBeGreaterThan(200);
  });
});

describe("generateVerifiedSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key-12345";
  });

  const reply = (text: string) => ({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 } });

  it("accepts a narrative whose figures trace to the data", async () => {
    mockCreate.mockResolvedValueOnce(reply("Overdraft sits at $35, $5 above the $30 peer median (16.7% higher)."));
    const { generateVerifiedSection } = await import("./generate");
    const result = await generateVerifiedSection({ type: "overview", title: "T", data: { amount: 35, median: 30 } });
    expect(result.status).toBe("ok");
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("regenerates once naming the bad figure, then flags needs_review if it persists", async () => {
    mockCreate
      .mockResolvedValueOnce(reply("Peers charge $42 on average."))
      .mockResolvedValueOnce(reply("Peers still charge $42."));
    const { generateVerifiedSection } = await import("./generate");
    const result = await generateVerifiedSection({ type: "overview", title: "T", data: { median: 30 } });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0].messages[0].content).toContain("FIGURE CHECK FAILED");
    expect(result).toMatchObject({ status: "needs_review", unmatched: ["$42"] });
  });

  it("passes after a corrected retry", async () => {
    mockCreate
      .mockResolvedValueOnce(reply("Peers charge $42."))
      .mockResolvedValueOnce(reply("The peer median is $30."));
    const { generateVerifiedSection } = await import("./generate");
    const result = await generateVerifiedSection({ type: "overview", title: "T", data: { median: 30 } });
    expect(result.status).toBe("ok");
  });
});
