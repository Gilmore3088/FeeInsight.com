// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";

// #979 H04-T07: two sends that land before React has re-rendered the busy state must still
// make one request. Regression cover for the ask box: these already held before the ref guard
// (React batches the two asks into one render, and the box empties once it renders), and the
// guard keeps them holding. The chat transport is mocked, so no provider call is made; the free
// engine call is a stubbed fetch that stays open, so the first ask is still in flight.

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
const noStoryline = () => new Response(JSON.stringify({ kind: "research", shortAnswer: "", pageChange: { screen: "none" } }));

let engine: { url: string; release: () => void }[] = [];
beforeEach(() => {
  chat.options.length = 0;
  chat.send.mockReset(); chat.setMessages.mockReset(); chat.clearError.mockReset(); chat.stop.mockReset();
  chat.save.mockReset().mockResolvedValue({ id: "saved" });
  engine = [];
  vi.stubGlobal("scrollTo", vi.fn());
  // Each engine call stays open until the test releases it.
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise<Response>((resolve) => {
    engine.push({ url, release: () => resolve(noStoryline()) });
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const enter = () => fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
const clickAsk = () => fireEvent.click(screen.getByRole("button", { name: "Ask" }));

/** Releases the open engine calls and waits for the written answer's request. */
async function finishEngine() {
  await act(async () => { engine.forEach((e) => e.release()); });
}

describe("AnalyzeWorkspace double-submit guard (#979 H04-T07)", () => {
  it("sends one request for two Enter presses before the page re-renders", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bank} initialQuestion="What is the overdraft fee?" />);
    act(() => { enter(); enter(); });
    await waitFor(() => expect(engine.length).toBeGreaterThan(0));
    await finishEngine();
    await waitFor(() => expect(chat.send).toHaveBeenCalled());
    expect(engine).toHaveLength(1);
    expect(chat.send).toHaveBeenCalledTimes(1);
  });

  it("sends one request for an Enter press and an Ask click before the page re-renders", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bank} initialQuestion="What is the overdraft fee?" />);
    act(() => { enter(); clickAsk(); });
    await waitFor(() => expect(engine.length).toBeGreaterThan(0));
    await finishEngine();
    await waitFor(() => expect(chat.send).toHaveBeenCalled());
    expect(engine).toHaveLength(1);
    expect(chat.send).toHaveBeenCalledTimes(1);
  });
});
