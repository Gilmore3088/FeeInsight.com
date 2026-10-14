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
  it("sends a typed answer once for two submits before the page re-renders", async () => {
    const answers = stubEngine(asking("scenario.tested_price", "number", "What price are you testing?"));
    render(<StructuredAsk question="what if we charged less?" institutionId="8109" modelHrefFor={() => "/"} />);
    const box = await screen.findByRole("textbox", { name: "What price are you testing?" });
    fireEvent.change(box, { target: { value: "25" } });
    const answer = screen.getByRole("button", { name: "Answer" });
    act(() => {
      fireEvent.click(answer);
      fireEvent.click(answer);
    });
    await act(async () => {});
    expect(answers).toEqual([{ fieldKey: "scenario.tested_price", value: "25" }]);
  });

  it("sends a typed answer once when the second submit lands after a re-render", async () => {
    const answers = stubEngine(asking("scenario.tested_price", "number", "What price are you testing?"));
    render(<StructuredAsk question="what if we charged less?" institutionId="8109" modelHrefFor={() => "/"} />);
    const box = await screen.findByRole("textbox", { name: "What price are you testing?" });
    fireEvent.change(box, { target: { value: "25" } });
    fireEvent.submit(box.closest("form")!);
    fireEvent.submit(box.closest("form")!);
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
