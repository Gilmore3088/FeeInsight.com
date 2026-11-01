// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateText, readUIMessageStream, simulateReadableStream, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { answerText, messageText } from "./message-text";

// Invented institution and figures for tests only; nothing here is live data.
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};
const text = (id: string, delta: string): LanguageModelV3StreamPart[] => [
  { type: "text-start", id }, { type: "text-delta", id, delta }, { type: "text-end", id },
];
// Step 1: two text blocks, then a tool call. Step 2: two more text blocks, as the provider sends them
// (block ids restart at 0 in each step, and each block ends a sentence with no trailing space).
const STEPS: LanguageModelV3StreamPart[][] = [
  [
    ...text("0", "First Example Bank charges $35.00 for an overdraft."),
    ...text("1", "Reading the peer fees now."),
    { type: "tool-call", toolCallId: "call-1", toolName: "peerFees", input: "{}" },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
  ],
  [
    ...text("0", "Across 7 peers, the median is $34.00."),
    ...text("1", "## What this means\nThe fee sits $1.00 above the median."),
    { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
  ],
];

function model() {
  let step = 0;
  return new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: STEPS[step++], initialDelayInMs: 0, chunkDelayInMs: 0 }) }),
  });
}

/** One streamed answer: what the screen builds from the streamed message, and what the route's onFinish receives. */
async function answer() {
  let finished: { text: string; steps: Parameters<typeof answerText>[0] } | null = null;
  const result = streamText({
    model: model(),
    prompt: "Is our overdraft fee high?",
    tools: { peerFees: tool({ inputSchema: z.object({}), execute: async () => ({ peer_median: 34 }) }) },
    stopWhen: stepCountIs(4),
    onFinish: ({ text, steps }) => { finished = { text, steps }; },
  });
  let message: UIMessage | undefined;
  for await (const m of readUIMessageStream({ stream: result.toUIMessageStream() })) message = m;
  if (!message || !finished) throw new Error("the stream did not finish");
  return { screen: messageText(message), finished: finished as { text: string; steps: Parameters<typeof answerText>[0] } };
}

describe("the answer the screen shows and the answer the route checks and saves", () => {
  it("are the same text for a multi-step answer with several text blocks per step", async () => {
    const { screen, finished } = await answer();
    expect(screen).toBe(
      "First Example Bank charges $35.00 for an overdraft. Reading the peer fees now. Across 7 peers, the median is $34.00.\n\n"
      + "## What this means\nThe fee sits $1.00 above the median.",
    );
    // The route checks, binds and saves answerText(steps), the same text the screen shows.
    expect(answerText(finished.steps)).toBe(screen);
  });

  it("would differ with the provider's own text, which is the last step alone, joined with nothing", async () => {
    const { screen, finished } = await answer();
    // Before this fix the route saved this: the first step's sentence (the bank's own $35.00) was
    // missing from the saved answer, PDF and board brief, and two sentences ran together.
    expect(finished.text).toBe("Across 7 peers, the median is $34.00.## What this means\nThe fee sits $1.00 above the median.");
    expect(finished.text).not.toBe(screen);
  });
});

// The buffered path (a report caller sends gate_citations) calls generateText, not streamText. Its
// result.text is the last step alone too, so a model that writes before a tool call lost those sentences
// from the report, and their figures were never checked.
const GENERATED: LanguageModelV3GenerateResult[] = [
  {
    content: [
      { type: "text", text: "First Example Bank charges $35.00 for an overdraft." },
      { type: "text", text: "Reading the peer fees now." },
      { type: "tool-call", toolCallId: "call-1", toolName: "peerFees", input: "{}" },
    ],
    finishReason: { unified: "tool-calls", raw: "tool_use" }, usage, warnings: [],
  },
  {
    content: [
      { type: "text", text: "Across 7 peers, the median is $34.00." },
      { type: "text", text: "## What this means\nThe fee sits $1.00 above the median." },
    ],
    finishReason: { unified: "stop", raw: "end_turn" }, usage, warnings: [],
  },
];

describe("the buffered answer a report caller is checked against and sent", () => {
  it("is every step's text, while generateText's own text is the last step alone", async () => {
    let step = 0;
    const result = await generateText({
      model: new MockLanguageModelV3({ doGenerate: async () => GENERATED[step++] }),
      prompt: "Is our overdraft fee high?",
      tools: { peerFees: tool({ inputSchema: z.object({}), execute: async () => ({ peer_median: 34 }) }) },
      stopWhen: stepCountIs(4),
    });
    expect(result.steps).toHaveLength(2);
    // The provider's text drops the first step: the bank's own $35.00 was never checked or sent.
    expect(result.text).toBe("Across 7 peers, the median is $34.00.## What this means\nThe fee sits $1.00 above the median.");
    expect(result.text).not.toContain("$35.00");
    expect(answerText(result.steps)).toBe(
      "First Example Bank charges $35.00 for an overdraft. Reading the peer fees now. Across 7 peers, the median is $34.00.\n\n"
      + "## What this means\nThe fee sits $1.00 above the median.",
    );
  });
});
