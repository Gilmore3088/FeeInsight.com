import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerEvidenceCheck } from "./answer-gate";
import type { NarrativeBinding } from "./narrative-bound";

// The view and the "leaves nothing" rule are tested where they live; here only the decision over them.
const mocks = vi.hoisted(() => ({ leavesNothing: false, viewText: "Kept sentence." as string | null }));
vi.mock("./written-answer-binding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./written-answer-binding")>()),
  bindingLeavesNothing: () => mocks.leavesNothing,
}));
vi.mock("./output-gate-repair", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output-gate-repair")>()),
  bindingAnswerView: () => (mocks.viewText === null
    ? { status: "held", text: null, lead: null, corrections: [], leftOut: 0, heldBy: "cut_not_found" }
    : { status: "ready_partial", text: mocks.viewText, lead: null, corrections: [], leftOut: 1 }),
}));

const { analyzeAnswerDecision } = await import("./analyze-answer-decision");

const passed = { passed: true, problems: [] } as unknown as AnswerEvidenceCheck;
const failed = { passed: false, problems: ["untraced"] } as unknown as AnswerEvidenceCheck;
const whole = { omitted: [] } as unknown as NarrativeBinding;
const partial = { omitted: [{ sentence: "Left out.", reason: "contradicted" }] } as unknown as NarrativeBinding;

beforeEach(() => {
  mocks.leavesNothing = false;
  mocks.viewText = "Kept sentence.";
});

describe("the Analyze screen's decision on a finished written answer (route onFinish, paid eval shadow)", () => {
  it("shows a passing answer whole", () => {
    expect(analyzeAnswerDecision("t", passed, whole, true)).toEqual({ held: false, today: "shown", viewFailed: false });
    expect(analyzeAnswerDecision("t", passed, null, true)).toEqual({ held: false, today: "shown", viewFailed: false });
  });

  it("holds an answer whose check fails or whose binding leaves nothing", () => {
    expect(analyzeAnswerDecision("t", failed, whole, true)).toMatchObject({ held: true, today: "held", viewFailed: false });
    mocks.leavesNothing = true;
    expect(analyzeAnswerDecision("t", passed, partial, true)).toMatchObject({ held: true, today: "held", viewFailed: false });
  });

  it("shows an answer in part without its left-out sentences, and holds it when that view cannot be built", () => {
    expect(analyzeAnswerDecision("t", passed, partial, true)).toEqual({ held: false, today: "shown_partial", viewFailed: false, shownText: "Kept sentence." });
    mocks.viewText = null;
    expect(analyzeAnswerDecision("t", passed, partial, true)).toEqual({ held: true, today: "held", viewFailed: true, heldBy: "cut_not_found" });
  });

  it("holds nothing when answers are not held, and still marks a partial binding", () => {
    expect(analyzeAnswerDecision("t", failed, whole, false)).toEqual({ held: false, today: "shown", viewFailed: false });
    expect(analyzeAnswerDecision("t", passed, partial, false)).toEqual({ held: false, today: "shown_partial", viewFailed: false });
  });
});
