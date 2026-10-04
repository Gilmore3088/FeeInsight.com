/**
 * Editor review module tests — second Claude pass on Hamilton drafts.
 * Uses vi.mock to avoid real API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ValidatedSection } from "../hamilton/types";
import type { ThesisOutput } from "../hamilton/types";

// mockCreate is defined at module scope so it can be configured in each test
const mockCreate = vi.fn();

// Mock Anthropic SDK — must be hoisted (vi.mock is hoisted by vitest)
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

vi.mock("@/lib/ai-provider-usage", () => ({
  trackAnthropicRequest: async (_context: unknown, request: () => Promise<unknown>) => request(),
}));

// Import after mock is set up
import { runEditorReview } from "./editor";

// Helper to build a minimal ValidatedSection
function makeSection(type: ValidatedSection["input"]["type"]): ValidatedSection {
  return {
    narrative: "National overdraft fees average $27.50, rising 3.2% year-over-year.",
    wordCount: 11,
    model: "claude-sonnet-4-20250514",
    usage: { inputTokens: 100, outputTokens: 50 },
    validation: {
      passed: true,
      inventedNumbers: [],
      checkedCount: 2,
      sourceValues: [27.5, 3.2],
    },
    input: {
      type,
      title: "Overdraft fees rise above national median",
      data: { median_amount: 27.5, yoy_pct: 3.2 },
    },
  };
}

// Helper to build a minimal ThesisOutput
function makeThesis(): ThesisOutput {
  return {
    core_thesis: "Fee commoditization is accelerating while revenue concentration increases.",
    tensions: [
      {
        force_a: "Pricing convergence",
        force_b: "Revenue divergence",
        implication: "Institutions cannot compete on price but must compete on fee revenue optimization.",
      },
    ],
    revenue_model: "NSF and overdraft fees drive 72% of fee revenue despite narrow spreads.",
    competitive_dynamic: "Banks charge premiums on convenience fees; credit unions on penalty fees.",
    contrarian_insight: "The most fee-competitive institutions are not the most revenue-efficient.",
    narrative_summary: "Banking fee strategy is bifurcating: large institutions use fees as margin protection while community banks and credit unions rely on fee waivers as differentiation. This creates a structural revenue gap that data-driven pricing can close.",
    model: "claude-sonnet-4-20250514",
    usage: { inputTokens: 500, outputTokens: 200 },
  };
}

function makeApprovedResponse(usage = { input_tokens: 150, output_tokens: 30 }) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          flaggedSections: [],
          reviewNote: "All sections approved.",
        }),
      },
    ],
    usage,
    model: "claude-haiku-4-5-20251001",
  };
}

describe("runEditorReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore ANTHROPIC_API_KEY for each test
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("returns approved=false when any flaggedSection has severity major", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            flaggedSections: [
              {
                sectionType: "overview",
                reason: "Statistic '$35.00 average' not present in source data",
                severity: "major",
              },
            ],
            reviewNote: "One unsupported statistic found in overview section.",
          }),
        },
      ],
      usage: { input_tokens: 200, output_tokens: 80 },
      model: "claude-haiku-4-5-20251001",
    });

    const sections: ValidatedSection[] = [makeSection("overview")];
    const result = await runEditorReview(sections);

    expect(result.approved).toBe(false);
    expect(result.flaggedSections).toHaveLength(1);
    expect(result.flaggedSections[0].severity).toBe("major");
    expect(result.reviewNote).toBe("One unsupported statistic found in overview section.");
  });

  it("returns approved=true when flaggedSections is empty", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            flaggedSections: [],
            reviewNote: "All sections approved.",
          }),
        },
      ],
      usage: { input_tokens: 150, output_tokens: 30 },
      model: "claude-haiku-4-5-20251001",
    });

    const sections: ValidatedSection[] = [makeSection("findings")];
    const result = await runEditorReview(sections);

    expect(result.approved).toBe(true);
    expect(result.flaggedSections).toHaveLength(0);
    expect(result.reviewNote).toBe("All sections approved.");
  });

  it("returns approved=true when all flags are minor severity", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            flaggedSections: [
              {
                sectionType: "trend_analysis",
                reason: "Phrase 'quite significant' detected (forbidden)",
                severity: "minor",
              },
              {
                sectionType: "recommendation",
                reason: "Section title states topic rather than conclusion",
                severity: "minor",
              },
            ],
            reviewNote: "Minor voice drift detected; no unsupported claims.",
          }),
        },
      ],
      usage: { input_tokens: 180, output_tokens: 60 },
      model: "claude-haiku-4-5-20251001",
    });

    const sections: ValidatedSection[] = [
      makeSection("trend_analysis"),
      makeSection("recommendation"),
    ];
    const result = await runEditorReview(sections);

    expect(result.approved).toBe(true);
    expect(result.flaggedSections).toHaveLength(2);
    expect(result.flaggedSections.every((f) => f.severity === "minor")).toBe(true);
    expect(result.reviewNote).toBe("Minor voice drift detected; no unsupported claims.");
  });
});

describe("Editor v2 — new checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("thesis-alignment-major: returns approved=false when thesis contradiction flagged", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            flaggedSections: [
              {
                sectionType: "trend_analysis",
                reason:
                  "Thesis contradiction: thesis claims 'Fee commoditization is accelerating' but section claims fees are rapidly differentiating by segment.",
                severity: "major",
              },
            ],
            reviewNote: "Section contradicts core thesis.",
          }),
        },
      ],
      usage: { input_tokens: 250, output_tokens: 90 },
      model: "claude-haiku-4-5-20251001",
    });

    const sections: ValidatedSection[] = [makeSection("trend_analysis")];
    const thesis = makeThesis();
    const result = await runEditorReview(sections, thesis);

    expect(result.approved).toBe(false);
    expect(result.flaggedSections).toHaveLength(1);
    expect(result.flaggedSections[0].severity).toBe("major");
    expect(result.flaggedSections[0].reason).toContain("thesis");
  });

  it("thesis-alignment-null-skip: when thesis=null, GLOBAL THESIS is not in user message", async () => {
    mockCreate.mockResolvedValueOnce(makeApprovedResponse());

    const sections: ValidatedSection[] = [makeSection("overview")];
    await runEditorReview(sections, null);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = callArgs.messages[0].content;
    expect(userContent).not.toContain("GLOBAL THESIS");
  });

  it("revenue-prioritization-minor: returns approved=true with minor revenue prioritization flag", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            flaggedSections: [
              {
                sectionType: "trend_analysis",
                reason:
                  "revenue prioritization: pricing leads, revenue buried — move revenue context to opening claim",
                severity: "minor",
              },
            ],
            reviewNote: "Minor revenue prioritization issue.",
          }),
        },
      ],
      usage: { input_tokens: 200, output_tokens: 70 },
      model: "claude-haiku-4-5-20251001",
    });

    const sections: ValidatedSection[] = [makeSection("trend_analysis")];
    const result = await runEditorReview(sections);

    expect(result.approved).toBe(true);
    expect(result.flaggedSections).toHaveLength(1);
    expect(result.flaggedSections[0].severity).toBe("minor");
    expect(result.flaggedSections[0].reason).toContain("revenue prioritization");
  });

  it("revenue-prioritization-clean: returns approved=true with no flag when revenue leads", async () => {
    mockCreate.mockResolvedValueOnce(makeApprovedResponse());

    const sections: ValidatedSection[] = [makeSection("trend_analysis")];
    const result = await runEditorReview(sections);

    expect(result.approved).toBe(true);
    expect(result.flaggedSections).toHaveLength(0);
  });

  it("so-what-minor: returns approved=true with minor implication flag", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            flaggedSections: [
              {
                sectionType: "findings",
                reason:
                  "missing implication: section ends in data description — add a so-what statement",
                severity: "minor",
              },
            ],
            reviewNote: "Section lacks implication statement.",
          }),
        },
      ],
      usage: { input_tokens: 200, output_tokens: 70 },
      model: "claude-haiku-4-5-20251001",
    });

    const sections: ValidatedSection[] = [makeSection("findings")];
    const result = await runEditorReview(sections);

    expect(result.approved).toBe(true);
    expect(result.flaggedSections).toHaveLength(1);
    expect(result.flaggedSections[0].severity).toBe("minor");
    expect(result.flaggedSections[0].reason).toMatch(/implication|so what/i);
  });

  it("so-what-clean: returns approved=true when implication is present", async () => {
    mockCreate.mockResolvedValueOnce(makeApprovedResponse());

    const sections: ValidatedSection[] = [makeSection("recommendation")];
    const result = await runEditorReview(sections);

    expect(result.approved).toBe(true);
    expect(result.flaggedSections).toHaveLength(0);
  });

  it("thesis-in-user-message: GLOBAL THESIS block appears in user message when thesis is passed", async () => {
    mockCreate.mockResolvedValueOnce(makeApprovedResponse());

    const sections: ValidatedSection[] = [makeSection("overview")];
    const thesis = makeThesis();
    await runEditorReview(sections, thesis);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = callArgs.messages[0].content;
    expect(userContent).toContain("GLOBAL THESIS");
    expect(userContent).toContain(thesis.core_thesis);
  });

  it("no-thesis-in-user-message: GLOBAL THESIS block absent when thesis not passed", async () => {
    mockCreate.mockResolvedValueOnce(makeApprovedResponse());

    const sections: ValidatedSection[] = [makeSection("overview")];
    // Call without second argument (default null)
    await runEditorReview(sections);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userContent = callArgs.messages[0].content;
    expect(userContent).not.toContain("GLOBAL THESIS");
  });
});
