// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskResponse } from "@/lib/hamilton/workspace/types";
import { StructuredAsk } from "./StructuredAsk";

// #979 H04-T07: an answer to Hamilton's clarifying question is sent once, however fast the
// reader presses Enter, clicks Answer or picks a fee. The engine route is a stubbed fetch; the
// answer call stays open, so the first answer is still in flight when the second press lands.

const asking = (fieldKey: string, inputKind: string, prompt: string): AskResponse => ({
  kind: "clarifying_question" as AskResponse["kind"],
  shortAnswer: prompt,
  pageChange: { screen: "none" },
  question: { prompt, inputKind, fieldKey } as AskResponse["question"],
});

function stubEngine(first: AskResponse) {
  const answers: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { answer?: unknown };
      if (body.answer) {
        answers.push(body.answer);
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(new Response(JSON.stringify(first), { status: 200 }));
    }),
  );
  return answers;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StructuredAsk clarification double-submit guard (#979 H04-T07)", () => {
  // The typed answer comes from the page's one composer (#979 H04-T03/T04): StructuredAsk has no
  // text field of its own and sends each reply seq at most once while one is in flight.
  it("sends a typed answer once for two replies before the page re-renders", async () => {
    const answers = stubEngine(asking("scenario.tested_price", "number", "What price are you testing?"));
    const onClarification = vi.fn();
    const props = { question: "what if we charged less?", institutionId: "8109", modelHrefFor: () => "/", onClarification };
    const view = render(<StructuredAsk {...props} />);
    await screen.findByText("What price are you testing?");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onClarification).toHaveBeenLastCalledWith(expect.objectContaining({ fieldKey: "scenario.tested_price" }), null);
    act(() => {
      view.rerender(<StructuredAsk {...props} clarificationReply={{ value: "25", seq: 1 }} />);
      view.rerender(<StructuredAsk {...props} clarificationReply={{ value: "25", seq: 2 }} />);
    });
    await act(async () => {});
    expect(answers).toEqual([{ fieldKey: "scenario.tested_price", value: "25" }]);
  });

  it("never resends the same reply on a re-render", async () => {
    const answers = stubEngine(asking("scenario.tested_price", "number", "What price are you testing?"));
    const props = { question: "what if we charged less?", institutionId: "8109", modelHrefFor: () => "/", onClarification: vi.fn() };
    const view = render(<StructuredAsk {...props} />);
    await screen.findByText("What price are you testing?");
    view.rerender(<StructuredAsk {...props} clarificationReply={{ value: "25", seq: 1 }} />);
    await act(async () => {});
    view.rerender(<StructuredAsk {...props} clarificationReply={{ value: "25", seq: 1 }} />);
    await act(async () => {});
    expect(answers).toHaveLength(1);
  });

  it("sends an objective once for a double click", async () => {
    const answers = stubEngine(asking("decision.objective", "choice", "What matters most here?"));
    render(<StructuredAsk question="should we raise the overdraft fee?" institutionId="8109" modelHrefFor={() => "/"} />);
    await screen.findByText("What matters most here?");
    const [first] = screen.getAllByRole("button");
    act(() => {
      fireEvent.click(first);
      fireEvent.click(first);
    });
    await act(async () => {});
    expect(answers).toHaveLength(1);
  });
});
