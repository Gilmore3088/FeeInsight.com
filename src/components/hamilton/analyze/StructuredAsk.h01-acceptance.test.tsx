import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFeeAnswer } from "@/lib/hamilton/workspace/answer";
import { overdraftResearch } from "@/lib/hamilton/workspace/test-fixtures";
import type { AskResponse } from "@/lib/hamilton/workspace/types";
import { StructuredAsk } from "./StructuredAsk";

// H01-AC4: invented subjects and controlled HTTP completions, never a live account/provider.
type Pending = { url: string; body: Record<string, unknown>; finish: (response: Response) => void };

function controlledFetch() {
  const pending: Pending[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => new Promise<Response>((finish) => {
    pending.push({ url, body: JSON.parse(String(init.body)), finish });
  }));
  vi.stubGlobal("fetch", fetch);
  return { pending, fetch };
}

async function finish(request: Pending, body: unknown, status = 200) {
  await act(async () => {
    request.finish(new Response(JSON.stringify(body), { status }));
  });
}

function answer(subject: string): AskResponse {
  return {
    kind: "research",
    shortAnswer: `${subject} answer`,
    pageChange: { screen: "none" },
    facts: [{ text: `${subject} evidence`, source: { label: "Synthetic acceptance fixture" } }],
  };
}

function storyline(): AskResponse {
  return {
    kind: "research",
    shortAnswer: "Synthetic A answer",
    pageChange: { screen: "research", feeCategory: "overdraft" },
    answer: buildFeeAnswer(overdraftResearch()),
    decisionId: "synthetic-decision-a",
    savedAnalysisId: "synthetic-answer-a",
  };
}

const modelHrefFor = () => "/pro/simulate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("H01-AC4 Structured Ask delayed context isolation", () => {
  it("does not deliver a completed old request or start its memo after navigation unmounts it", async () => {
    const { pending, fetch } = controlledFetch();
    const onLead = vi.fn();
    const onStoryline = vi.fn();
    const onNoStoryline = vi.fn();
    const { unmount } = render(<StructuredAsk question="Compare overdraft" institutionId="101" modelHrefFor={modelHrefFor} onLead={onLead} onStoryline={onStoryline} onNoStoryline={onNoStoryline} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    unmount();
    await finish(pending[0], storyline());
    expect(onLead).not.toHaveBeenCalled();
    expect(onStoryline).not.toHaveBeenCalled();
    expect(onNoStoryline).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("runs the same question for a newly selected subject and discards the prior subject's completion", async () => {
    const { pending } = controlledFetch();
    const onLead = vi.fn();
    const { rerender } = render(<StructuredAsk question="How does this compare?" nonce={1} institutionId="101" modelHrefFor={modelHrefFor} onLead={onLead} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender(<StructuredAsk question="How does this compare?" nonce={1} institutionId="202" modelHrefFor={modelHrefFor} onLead={onLead} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending.map((request) => request.body.institutionId)).toEqual(["101", "202"]);
    await finish(pending[1], answer("Subject B"));
    await screen.findByText("Subject B evidence");
    await finish(pending[0], answer("Subject A"));
    expect(screen.queryByText("Subject A evidence")).toBeNull();
    expect(screen.getByText("Subject B evidence")).toBeTruthy();
    expect(onLead.mock.calls).toEqual([["Subject B answer"]]);
  });

  it("discards an earlier completion when the identical question is retried", async () => {
    const { pending } = controlledFetch();
    const onLead = vi.fn();
    const { rerender } = render(<StructuredAsk question="Compare this" nonce={1} institutionId="101" modelHrefFor={modelHrefFor} onLead={onLead} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender(<StructuredAsk question="Compare this" nonce={2} institutionId="101" modelHrefFor={modelHrefFor} onLead={onLead} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    await finish(pending[1], answer("New request"));
    await screen.findByText("New request evidence");
    await finish(pending[0], answer("Old request"));
    expect(screen.queryByText("Old request evidence")).toBeNull();
    expect(onLead.mock.calls).toEqual([["New request answer"]]);
  });

  it("does not put a delayed memo from the preceding same-question request into the current answer", async () => {
    const { pending } = controlledFetch();
    const { rerender } = render(<StructuredAsk question="Compare overdraft" nonce={1} institutionId="101" modelHrefFor={modelHrefFor} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await finish(pending[0], storyline());
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].url).toBe("/api/hamilton/ask/memo");
    rerender(<StructuredAsk question="Compare overdraft" nonce={2} institutionId="101" modelHrefFor={modelHrefFor} />);
    await waitFor(() => expect(pending).toHaveLength(3));
    await finish(pending[2], storyline());
    await waitFor(() => expect(pending).toHaveLength(4));
    const memo = (summary: string) => ({ status: "written", memo: { summary, board: "Synthetic board note", market: "Synthetic market note", questions: [], model: "fixture", generatedAt: "2026-10-10", figureCheck: { checked: 0, unmatched: [] } } });
    await finish(pending[3], memo("Current memo"));
    await screen.findByText("Current memo");
    await finish(pending[1], memo("Stale memo"));
    expect(screen.queryByText("Stale memo")).toBeNull();
    expect(screen.getByText("Current memo")).toBeTruthy();
  });
});
