import { describe, expect, it } from "vitest";
import { NARRATIVE_BINDING_VERSION, type NarrativeBinding } from "./narrative-bound";
import { writtenAnswerResponse } from "./answer-save";
import { fallbackSaveTitle, questionTitle, savedAnswerTitle } from "./saved-title";

const READING = "Your overdraft fee sits about 21% above the peer median.";
const SUPPORTED = "Your overdraft fee is $35.";
const OMITTED = "First Example Bank charges $40 for overdraft.";
const QUESTION = "How does my overdraft fee compare with peers?";

function binding(parts: Partial<NarrativeBinding>): NarrativeBinding {
  return { version: NARRATIVE_BINDING_VERSION, supported: [], interpretation: [], omitted: [], limitations: [], ...parts };
}

const answer = (view: string) => ["## Hamilton's View", view, "## What This Means", "You charge more than most peers."].join("\n");

describe("savedAnswerTitle (#1077 defect 8)", () => {
  it("never files a reading sentence as the title", () => {
    const bound = binding({ supported: [{ text: SUPPORTED, factIds: ["fee:1"] }], interpretation: [READING] });
    expect(savedAnswerTitle(`${READING} ${SUPPORTED}`, bound, QUESTION)).toBe(SUPPORTED);
  });

  it("uses the question when the view holds only reading", () => {
    expect(savedAnswerTitle(READING, binding({ interpretation: [READING] }), QUESTION)).toBe(QUESTION);
  });

  it("keeps a supported lead with its figure", () => {
    const bound = binding({ supported: [{ text: SUPPORTED, factIds: ["fee:1"] }], interpretation: [READING] });
    expect(savedAnswerTitle(`${SUPPORTED} ${READING}`, bound, QUESTION)).toBe(SUPPORTED);
  });

  it("never files a left-out sentence as the title", () => {
    const bound = binding({ supported: [{ text: SUPPORTED, factIds: ["fee:1"] }], omitted: [{ text: OMITTED, reason: "wrong_institution" }] });
    expect(savedAnswerTitle(`${OMITTED} ${SUPPORTED}`, bound, QUESTION)).toBe(SUPPORTED);
  });

  it("keeps a figure-free lead with no binding, as today", () => {
    const lead = "Your overdraft fee is above most peers.";
    expect(savedAnswerTitle(`${lead} It is $35.`, null, QUESTION)).toBe(lead);
  });

  it("uses the question for a lead with a figure and no binding to support it", () => {
    expect(savedAnswerTitle("Your overdraft fee is $35. That is high.", null, QUESTION)).toBe(QUESTION);
  });

  it("cuts a long question at 60 characters", () => {
    const long = "How does my overdraft fee compare with the peers in my state and asset tier this year?";
    expect(questionTitle(long)).toBe(`${long.slice(0, 60).trim()}…`);
  });
});

describe("writtenAnswerResponse title", () => {
  it("files the supported sentence, not the reading lead", () => {
    const bound = binding({ supported: [{ text: SUPPORTED, factIds: ["fee:1"] }], interpretation: [READING] });
    const response = writtenAnswerResponse(answer(`${READING} ${SUPPORTED}`), [], undefined, bound, null, QUESTION);
    expect(response.title).toBe(SUPPORTED);
    // The reading sentence stays in the saved view; only the title changes.
    expect(response.hamiltonView).toContain(READING);
  });

  it("files the question when every lead sentence is reading", () => {
    const response = writtenAnswerResponse(answer(READING), [], undefined, binding({ interpretation: [READING] }), null, QUESTION);
    expect(response.title).toBe(QUESTION);
  });
});

describe("fallbackSaveTitle", () => {
  it("keeps a figure-free browser title", () => {
    expect(fallbackSaveTitle([undefined, "Your overdraft fee is above most peers."], QUESTION)).toBe("Your overdraft fee is above most peers.");
  });

  it("uses the prompt when the browser title states a figure", () => {
    expect(fallbackSaveTitle(["", READING], QUESTION)).toBe(QUESTION);
    expect(fallbackSaveTitle(["Overdraft at $35", undefined], QUESTION)).toBe(QUESTION);
  });
});
