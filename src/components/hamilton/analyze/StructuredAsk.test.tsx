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
  it("asks again when the same question is sent again (Try again), and hides a failed engine call behind the written answer", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response("{}", { status: 500 });
      }),
    );
    const onNoStoryline = vi.fn();
    const { rerender } = render(<StructuredAsk question="what is a call report?" nonce={1} institutionId="8109" modelHrefFor={() => "/"} onNoStoryline={onNoStoryline} />);
    await waitFor(() => expect(onNoStoryline).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/could not answer/i)).toBeNull();
    rerender(<StructuredAsk question="what is a call report?" nonce={1} institutionId="8109" modelHrefFor={() => "/"} onNoStoryline={onNoStoryline} />);
    rerender(<StructuredAsk question="what is a call report?" nonce={2} institutionId="8109" modelHrefFor={() => "/"} onNoStoryline={onNoStoryline} />);
    await waitFor(() => expect(onNoStoryline).toHaveBeenCalledTimes(2));
    expect(calls).toHaveLength(2);
  });

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

  it("keeps the storyline and shows the paused line when the provider's usage limit is reached", async () => {
    const { HAMILTON_PAUSED_MESSAGE } = await import("@/lib/hamilton/provider-paused");
    mockFetch(withStoryline, { status: "unavailable", reason: HAMILTON_PAUSED_MESSAGE });
    render(<StructuredAsk question="q" institutionId="8109" modelHrefFor={() => "/"} />);
    await screen.findByText(HAMILTON_PAUSED_MESSAGE);
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


  // Test figures only; not any institution's real fees.
  it("draws every fee against its peer median and keeps the engine's answer without a written one", async () => {
    const calls = mockFetch(
      {
        kind: "research",
        shortAnswer: "Two of three fees sit above their peer medians.",
        pageChange: { screen: "none" },
        facts: [{ text: "Overdraft $35 against a $29 median.", source: { label: "Bank Fee Index" } }],
        positions: [
          { feeCategory: "overdraft", displayName: "Overdraft", current: 35, peerMedian: 29, peerCount: 40, peerLabel: "Banks $10B and up", direction: "higher", band: { p25: 25, p75: 32 } },
          { feeCategory: "nsf", displayName: "NSF / returned item", current: 20, peerMedian: 25, peerCount: 38, peerLabel: "Banks $10B and up", direction: "lower" },
          { feeCategory: "stop_payment", displayName: "Stop payment", current: 30, peerMedian: 30, peerCount: 30, peerLabel: "Banks $10B and up", direction: "at" },
        ],
      },
      {},
    );
    const onNoStoryline = vi.fn();
    render(<StructuredAsk question="Where do we stand on every fee?" institutionId="8109" modelHrefFor={() => "/"} researchHrefFor={(f) => `/pro/research?fee=${f}`} onNoStoryline={onNoStoryline} />);
    await screen.findByText("Every fee against its peers");
    expect(screen.getByText("1 lower · 1 at median · 1 higher")).toBeTruthy();
    // Drawn on its peer range: the middle half when the engine sends it, the median alone otherwise.
    expect(screen.getByRole("img", { name: "$35 against a peer middle half of $25 to $32, median $29" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "$20 against a peer median of $25" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Overdraft" }).getAttribute("href")).toBe("/pro/research?fee=overdraft");
    // The table carries the figures, so the same lines are not listed again.
    expect(screen.queryByText("Overdraft $35 against a $29 median.")).toBeNull();
    expect(onNoStoryline).not.toHaveBeenCalled();
    expect(calls.map((c) => c.url)).toEqual(["/api/hamilton/ask"]);
  });

  it("lists sourced findings for a why question instead of handing it to a written answer", async () => {
    mockFetch(
      {
        kind: "research",
        shortAnswer: "Price explains about a third of the gap.",
        pageChange: { screen: "none" },
        facts: [{ text: "Service charges of $4.10 per $1,000 of deposits against a $5.00 median.", source: { label: "Call reports", asOf: "2026-06-30" }, sampleSize: 25 }],
      },
      {},
    );
    const onNoStoryline = vi.fn();
    render(<StructuredAsk question="Why is our fee income lower than peers?" institutionId="8109" modelHrefFor={() => "/"} onNoStoryline={onNoStoryline} />);
    await screen.findByText(/per \$1,000 of deposits/);
    expect(screen.getByText("Call reports, 2026-06-30 · 25 institutions")).toBeTruthy();
    expect(onNoStoryline).not.toHaveBeenCalled();
  });

  it("leads an every-fee answer with its takeaways, then the table, then the top fee's storyline", async () => {
    const answer = buildFeeAnswer(overdraftResearch());
    mockFetch(
      {
        kind: "research",
        shortAnswer: "Test figures: two of three fees sit above their peer medians; overdraft is furthest.",
        pageChange: { screen: "none" },
        answer,
        positions: [
          { feeCategory: "overdraft", displayName: "Overdraft", current: 35, peerMedian: 29, peerCount: 40, peerLabel: "Banks $10B and up", direction: "higher" },
        ],
      },
      { status: "withheld", reason: "held" },
    );
    render(<StructuredAsk question="Where do we stand on every fee?" institutionId="8109" modelHrefFor={() => "/"} />);
    const lead = await screen.findByText(/two of three fees sit above/);
    const table = screen.getByText("Every fee against its peers");
    expect(lead.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("answers a competitors-and-locations question with the market, never a written answer", async () => {
    const market = {
      institutionId: 1,
      institutionName: "Test Credit Union",
      charterType: "credit_union",
      market: { label: "Testville, FL area", basis: "hq_city", sodYear: 2026, countyCount: 1 },
      you: { branches: 3, branchesInMarket: 3, depositsInMarket: null, cities: [], fees: {} },
      marketDeposits: null,
      marketBranches: null,
      competitors: [{ institutionId: 2, name: "Test Bank A", charterType: "bank", branches: 4, deposits: null, fees: {} }],
      categories: ["overdraft"],
      sources: [],
      map: null,
      colours: {},
      network: null,
      unmapped: 0,
    };
    const calls = mockFetch(market as never, {});
    const onNoStoryline = vi.fn();
    render(<StructuredAsk question="who are my local competitors and locations" institutionId="8109" modelHrefFor={() => "/"} onNoStoryline={onNoStoryline} />);
    await screen.findByText("1 institution competes with Test Credit Union in the Testville, FL area");
    expect(calls.map((c) => c.url)).toEqual(["/api/hamilton/ask/market"]);
    expect(onNoStoryline).not.toHaveBeenCalled();
  });
});
