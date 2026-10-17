// @vitest-environment jsdom
/**
 * The written answer's sentence binding on screen (#981, H06-T06): supported sentences read as the
 * answer, Hamilton's reading sits under its own label, a contradicted sentence never shows, and an
 * untraced figure is named once, under the label, not in a second "Check these figures" warning.
 * A saved answer from before bindings renders exactly as it did.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { parseAnalyzeResponse } from "./parse-response";
import { INTERPRETATION_LABEL } from "@/lib/hamilton/narrative-bound";
import { bindWrittenAnswer, READING_ONLY_LEAD, withoutOmitted } from "@/lib/hamilton/written-answer-binding";

type Part = { type: string; text?: string; output?: unknown };
type Finished = { message: { id: string; role: string; metadata?: unknown; parts: Part[] }; isError: boolean; isAbort: boolean };
const chat = vi.hoisted(() => ({
  options: [] as Array<{ onFinish?: (event: Finished) => Promise<void> }>,
  save: vi.fn(),
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { onFinish?: (event: Finished) => Promise<void> }) => {
    chat.options.push(options);
    return { messages: [], status: "ready", sendMessage: vi.fn(), setMessages: vi.fn(), clearError: vi.fn(), stop: vi.fn(), error: undefined };
  },
}));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ saveAnalysis: chat.save }));
vi.mock("./StructuredAsk", async (importOriginal) => ({
  ...await importOriginal<typeof import("./StructuredAsk")>(),
  DownloadAnswerPdf: () => <button>Download PDF</button>,
}));
vi.mock("@/components/hamilton/basket/AddToReportButton", () => ({ AddToReportButton: () => <button>Add to report</button> }));
import { AnalyzeWorkspace } from "./AnalyzeWorkspace";

// Invented banks: Synthetic Bank A charges $10 for an overdraft, Synthetic Bank B $35.
const PROFILE_A = { identity: { id: 9001, name: "Synthetic Bank A" }, fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", status: "verified", record_id: 1, source_document_id: 101 }], provisional: [] } };
const PROFILE_B = { identity: { id: 9002, name: "Synthetic Bank B" }, fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 35, frequency: "per item", status: "verified", record_id: 2, source_document_id: 102 }], provisional: [] } };
const TOOLS = [PROFILE_A, PROFILE_B];
const TEXT = [
  "## Hamilton's View",
  "Synthetic Bank A charges $10 for an overdraft. Synthetic Bank A charges $35 for an overdraft.",
  "",
  "The peer median is $27.",
  "",
  "## Why It Matters",
  "- Overdraft draws the most complaints.",
].join("\n");
const SUPPORTED = "Synthetic Bank A charges $10 for an overdraft.";
const WRONG_BANK = "Synthetic Bank A charges $35 for an overdraft.";
const READING = "The peer median is $27.";
const binding = bindWrittenAnswer({ sections: parseAnalyzeResponse(TEXT), toolOutputs: TOOLS })!;

function saved(text: string, narrativeBinding?: AnalyzeResponse["narrativeBinding"]): AnalyzeResponse {
  const parsed = withoutOmitted(parseAnalyzeResponse(text), narrativeBinding);
  return {
    title: "Saved answer",
    confidence: { level: "medium", basis: ["Synthetic fixture"] },
    hamiltonView: parsed.hamiltonView,
    whatThisMeans: parsed.whatThisMeans,
    whyItMatters: parsed.whyItMatters,
    evidence: { metrics: [] },
    exploreFurther: [],
    ...(narrativeBinding ? { narrativeBinding } : {}),
  };
}

function finished(metadata?: unknown): Finished {
  return {
    message: { id: "m1", role: "assistant", metadata, parts: [...TOOLS.map((output) => ({ type: "tool-getInstitution", output })), { type: "text", text: TEXT }] },
    isError: false,
    isAbort: false,
  };
}

const page = () => document.body.textContent ?? "";

beforeEach(() => {
  chat.options.length = 0;
  chat.save.mockReset().mockResolvedValue({ id: "client-row" });
});
afterEach(() => cleanup());

describe("AnalyzeWorkspace written answer binding", () => {
  it("fixture check: the answer binds one sentence, reads one and leaves one out", () => {
    expect(binding.supported.map((s) => s.text)).toContain(SUPPORTED);
    expect(binding.interpretation).toEqual([READING]);
    expect(binding.omitted).toEqual([{ text: WRONG_BANK, reason: "wrong_institution" }]);
  });

  it("a reopened bound answer shows what was saved: the reading under its label, the left-out sentence nowhere", () => {
    render(<AnalyzeWorkspace userId={7} institutionId="9001" initialAnalysisId="saved-1" initialAnalysis={saved(TEXT, binding)} />);
    const label = screen.getByText(INTERPRETATION_LABEL);
    expect(label.closest("section")?.textContent).toContain(READING);
    expect(page()).toContain(SUPPORTED);
    expect(page()).not.toContain(WRONG_BANK);
    // The reading is shown once, under the label, never in the answer's own paragraphs.
    expect(page().split(READING)).toHaveLength(2);
    expect(page()).toContain("Some sentences were left out because a figure in them did not match its fee record.");
  });

  it("a reading-only answer leads with a plain line and offers the fee with sourced figures", () => {
    const readingOnly = "## Hamilton's View\nThe peer median is $27.";
    const only = bindWrittenAnswer({ sections: parseAnalyzeResponse(readingOnly), toolOutputs: TOOLS })!;
    render(<AnalyzeWorkspace userId={7} institutionId="9001" initialAnalysisId="saved-1" initialAnalysisPrompt="How does our overdraft fee compare?" initialAnalysis={saved(readingOnly, only)} />);
    expect(page()).toContain(READING_ONLY_LEAD);
    const box = screen.getByText(INTERPRETATION_LABEL).closest("section")!;
    expect(box.textContent).toContain(READING);
    expect(screen.getByRole("button", { name: "Compare the overdraft fee with sourced figures" })).toBeTruthy();
  });

  it("a reopened legacy answer with no binding renders as before: every sentence, no label", () => {
    render(<AnalyzeWorkspace userId={7} institutionId="9001" initialAnalysisId="saved-1" initialAnalysis={saved(TEXT)} />);
    expect(screen.queryByText(INTERPRETATION_LABEL)).toBeNull();
    expect(page()).toContain(SUPPORTED);
    expect(page()).toContain(WRONG_BANK);
    expect(page()).toContain(READING);
    expect(page()).not.toContain("left out");
  });

  it("a finished answer names its untraced figure once, under the label, instead of a second warning", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="9001" />);
    await act(async () => { await chat.options.at(-1)?.onFinish?.(finished({ savedAnalysisId: "server-row", narrativeBinding: binding })); });
    expect(page()).not.toContain("Check these figures");
    const section = screen.getByText(INTERPRETATION_LABEL).closest("section");
    expect(section?.textContent).toContain(READING);
    expect(section?.textContent).toContain("These figures were not in the data Hamilton looked up: $27.");
    expect(page()).not.toContain(WRONG_BANK);
  });

  it("a finished answer from a route that sent no binding keeps the old warning", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="9001" />);
    await act(async () => { await chat.options.at(-1)?.onFinish?.(finished({ savedAnalysisId: "server-row" })); });
    expect(page()).toContain("Check these figures:");
    expect(page()).toContain("$27");
    expect(screen.queryByText(INTERPRETATION_LABEL)).toBeNull();
  });

  it("the browser fallback save keeps the binding and never saves the left-out sentence", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="9001" />);
    await act(async () => { await chat.options.at(-1)?.onFinish?.(finished({ narrativeBinding: binding })); });
    expect(chat.save).toHaveBeenCalledTimes(1);
    const { responseJson } = chat.save.mock.calls[0][0] as { responseJson: AnalyzeResponse };
    expect(responseJson.narrativeBinding).toEqual(binding);
    expect(responseJson.hamiltonView).not.toContain(WRONG_BANK);
    expect(responseJson.hamiltonView).toContain(READING);
  });
});
