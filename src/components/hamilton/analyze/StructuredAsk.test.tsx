import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFeeAnswer } from "@/lib/hamilton/workspace/answer";
import { overdraftResearch } from "@/lib/hamilton/workspace/test-fixtures";
import type { AskResponse } from "@/lib/hamilton/workspace/types";
import { StructuredAsk } from "./StructuredAsk";

// Invented figures from the engine's test fixture; no figure here is live data.
const withStoryline: AskResponse = {
  kind: "research",
  shortAnswer: "x",
  pageChange: { screen: "research", feeCategory: "overdraft" },
  answer: buildFeeAnswer(overdraftResearch()),
  decisionId: "d1",
  savedAnalysisId: "sa1",
};

function mockFetch(ask: AskResponse, memo: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(url.endsWith("/memo") ? memo : ask), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StructuredAsk", () => {
  it("asks for Hamilton's memo over a storyline answer, with the same question, and shows it", async () => {
    const memo = {
      status: "written",
      memo: { summary: "Memo summary line.", board: "b", market: "m", questions: [], model: "t", generatedAt: "", figureCheck: { checked: 2, unmatched: [] } },
    };
    const calls = mockFetch(withStoryline, memo);
    const onNoStoryline = vi.fn();
    render(<StructuredAsk question="how does my overdraft fee compare?" institutionId="8109" modelHrefFor={() => "/"} onNoStoryline={onNoStoryline} />);
    await screen.findByText("Memo summary line.");
    expect(calls.map((c) => c.url)).toEqual(["/api/hamilton/ask", "/api/hamilton/ask/memo"]);
    expect(calls[1].body).toMatchObject({ institutionId: "8109", question: "how does my overdraft fee compare?", decisionId: "d1", savedAnalysisId: "sa1" });
    expect(onNoStoryline).not.toHaveBeenCalled();
  });

  it("keeps the storyline and says why when the memo is withheld", async () => {
    mockFetch(withStoryline, { status: "withheld", reason: "A figure could not be traced, so the memo is held back." });
    render(<StructuredAsk question="q" institutionId="8109" modelHrefFor={() => "/"} />);
    await screen.findByText("A figure could not be traced, so the memo is held back.");
    expect(screen.getByText("The answer")).toBeTruthy();
  });

  it("hands a question with no storyline back to the page, and asks for no memo", async () => {
    const calls = mockFetch({ kind: "research", shortAnswer: "x", pageChange: { screen: "research", feeCategory: "overdraft" } }, {});
    const onNoStoryline = vi.fn();
    render(<StructuredAsk question="what is a call report?" institutionId="8109" modelHrefFor={() => "/"} onNoStoryline={onNoStoryline} />);
    await waitFor(() => expect(onNoStoryline).toHaveBeenCalledWith("what is a call report?"));
    expect(calls.map((c) => c.url)).toEqual(["/api/hamilton/ask"]);
  });

  it("answers a question that names no fee in writing at once, and keeps fee charts optional", async () => {
    const which: AskResponse = {
      kind: "clarifying_question" as AskResponse["kind"],
      shortAnswer: "Which fee do you want to look at?",
      pageChange: { screen: "none" },
      question: { prompt: "Which fee do you want to look at?", inputKind: "text", fieldKey: "ask.fee_category" },
    };
    mockFetch(which, {});
    const onNoStoryline = vi.fn();
    render(<StructuredAsk question="how does this compare nationally?" institutionId="8109" modelHrefFor={() => "/"} onNoStoryline={onNoStoryline} />);
    await waitFor(() => expect(onNoStoryline).toHaveBeenCalledWith("how does this compare nationally?"));
    // No question card, no text box: the reader is never asked again before getting an answer.
    expect(screen.queryByText("Hamilton has one question")).toBeNull();
    expect(screen.queryByText("Which fee do you want to look at?")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("See the charts for one fee:")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Overdraft" }));
    await screen.findByText(/no charts for .Overdraft. yet/);
  });

});
