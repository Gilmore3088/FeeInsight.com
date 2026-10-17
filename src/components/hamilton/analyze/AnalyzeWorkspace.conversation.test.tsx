// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import { questionOnly } from "@/lib/hamilton/answer-save";

// #979 H04-T05: a written follow-up carries the conversation's earlier turns (question and
// one-line answer), bounded, and a new conversation carries none. The chat transport is mocked,
// so no provider call is made; the free engine call is a stubbed fetch.

type Finished = { message: { parts: Array<{ type: string; text: string }>; metadata?: unknown }; isError: boolean; isAbort: boolean };
const chat = vi.hoisted(() => ({
  options: [] as Array<{ onFinish?: (event: Finished) => Promise<void> }>,
  send: vi.fn(), setMessages: vi.fn(), clearError: vi.fn(), stop: vi.fn(), save: vi.fn(),
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { onFinish?: (event: Finished) => Promise<void> }) => {
    chat.options.push(options);
    return { messages: [], status: "ready", sendMessage: chat.send, setMessages: chat.setMessages, clearError: chat.clearError, stop: chat.stop, error: undefined };
  },
}));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ saveAnalysis: chat.save }));
import { AnalyzeWorkspace } from "./AnalyzeWorkspace";

const bank = { id: 2945, name: "Synthetic Bank A" } as HamiltonSelectedInstitutionContext;
// The engine has no storyline for these questions, so each one is handed to the written answer.
const noStoryline = () => new Response(JSON.stringify({ kind: "research", shortAnswer: "", pageChange: { screen: "none" } }));

let engineCalls = 0;
beforeEach(() => {
  chat.options.length = 0;
  chat.send.mockReset(); chat.setMessages.mockReset(); chat.clearError.mockReset(); chat.stop.mockReset();
  chat.save.mockReset().mockResolvedValue({ id: "saved" });
  engineCalls = 0;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async () => { engineCalls += 1; return noStoryline(); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Asks one question through the page's one composer and finishes its written answer with `lead`. */
async function askTurn(question: string, lead: string): Promise<string> {
  const before = chat.send.mock.calls.length;
  fireEvent.change(screen.getByRole("textbox"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /^Ask( Hamilton)?$/ }));
  await waitFor(() => expect(chat.send.mock.calls.length).toBe(before + 1));
  const sent = (chat.send.mock.calls.at(-1)?.[0] as { text: string }).text;
  await act(async () => {
    await chat.options.at(-1)?.onFinish?.({
      message: { parts: [{ type: "text", text: `## Hamilton's View\n${lead}` }], metadata: { savedAnalysisId: `row-${before}` } },
      isError: false,
      isAbort: false,
    });
  });
  await waitFor(() => expect(document.body.textContent).toContain(lead));
  return sent;
}

describe("AnalyzeWorkspace multi-turn context for written answers (#979)", () => {
  it("sends a first question as typed, with no invented context", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bank} />);
    const sent = await askTurn("What is the overdraft fee?", "The overdraft fee is $30.");
    expect(sent).toBe("What is the overdraft fee?");
  });

  it("carries every earlier question and its answer through three follow-ups, oldest first", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bank} />);
    await askTurn("What is the overdraft fee?", "The overdraft fee is $30.");
    await askTurn("And the NSF fee?", "The NSF fee is $25.");
    const third = await askTurn("Which of those fees is furthest from the peer median?", "Overdraft sits $4 above the peer median.");
    expect(third).toContain('1. I asked: "What is the overdraft fee?" Hamilton answered: "The overdraft fee is $30."');
    expect(third).toContain('2. I asked: "And the NSF fee?" Hamilton answered: "The NSF fee is $25."');
    expect(third.startsWith("Which of those fees is furthest from the peer median?")).toBe(true);
    // The server files the answer under the words the reader typed.
    expect(questionOnly(third)).toBe("Which of those fees is furthest from the peer median?");

    const fourth = await askTurn("How does that compare nationally?", "It is near the national median.");
    expect(fourth).toContain("1. I asked: \"What is the overdraft fee?\"");
    expect(fourth).toContain("3. I asked: \"Which of those fees is furthest from the peer median?\" Hamilton answered: \"Overdraft sits $4 above the peer median.\"");
    // One engine call per question; context never adds a call.
    expect(engineCalls).toBe(4);
    expect(chat.send).toHaveBeenCalledTimes(4);
  });

  it("keeps only the last three turns", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bank} />);
    await askTurn("Turn one?", "Lead one.");
    await askTurn("Turn two?", "Lead two.");
    await askTurn("Turn three?", "Lead three.");
    await askTurn("Turn four?", "Lead four.");
    const fifth = await askTurn("Turn five?", "Lead five.");
    expect(fifth).not.toContain("Turn one?");
    expect(fifth).toContain('1. I asked: "Turn two?"');
    expect(fifth).toContain('3. I asked: "Turn four?" Hamilton answered: "Lead four."');
  });

  it("carries nothing into a new conversation", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bank} />);
    await askTurn("What is the overdraft fee?", "The overdraft fee is $30.");
    await askTurn("And the NSF fee?", "The NSF fee is $25.");
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    const fresh = await askTurn("What is the wire fee?", "The wire fee is $20.");
    expect(fresh).toBe("What is the wire fee?");
    const followUp = await askTurn("And incoming?", "Incoming wires are $15.");
    expect(followUp).toContain('1. I asked: "What is the wire fee?"');
    expect(followUp).not.toContain("overdraft");
    expect(followUp).not.toContain("NSF");
  });
});

describe("AnalyzeWorkspace when the route holds a written answer back (#981)", () => {
  const HELD = "Synthetic held line.";

  it("shows the route's line as a notice, never as an answer, and never saves it", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bank} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "What is the overdraft fee?" } });
    fireEvent.click(screen.getByRole("button", { name: /^Ask( Hamilton)?$/ }));
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1));
    await act(async () => {
      await chat.options.at(-1)?.onFinish?.({
        message: { parts: [{ type: "text", text: HELD }], metadata: { answerEvidence: { passed: false, held: true } } },
        isError: false,
        isAbort: false,
      });
    });
    await waitFor(() => expect(document.body.textContent).toContain(HELD));
    expect(chat.save).not.toHaveBeenCalled();
    // The question goes back in the composer, and "Ask again" asks it again.
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("What is the overdraft fee?");
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(2));
    expect((chat.send.mock.calls[1][0] as { text: string }).text).toBe("What is the overdraft fee?");
  });

  it("offers the one fee the held question named as a sourced comparison", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bank} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Tell me about our overdraft fee and what drives it" } });
    fireEvent.click(screen.getByRole("button", { name: /^Ask( Hamilton)?$/ }));
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1));
    await act(async () => {
      await chat.options.at(-1)?.onFinish?.({
        message: { parts: [{ type: "text", text: HELD }], metadata: { answerEvidence: { passed: false, held: true } } },
        isError: false,
        isAbort: false,
      });
    });
    const compare = await screen.findByRole("button", { name: "Compare the overdraft fee only" });
    const calls = engineCalls;
    fireEvent.click(compare);
    // The comparison goes to the fee engine first, which answers from the published fee data.
    await waitFor(() => expect(engineCalls).toBe(calls + 1));
    expect(screen.getByRole("heading", { level: 1, name: "How does this institution's overdraft fee compare with its peers?" })).toBeTruthy();
  });
});
