// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { PeerListResponse, PeerListRow } from "@/lib/hamilton/peer-list";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import type { AskResponse } from "@/lib/hamilton/workspace/types";
import { buildFeeAnswer } from "@/lib/hamilton/workspace/answer";
import { overdraftResearch } from "@/lib/hamilton/workspace/test-fixtures";
import { parseConversationState, type HamiltonConversationState } from "@/lib/hamilton/conversation-state";

// #979 H04: one composer and one coherent conversation on the Analyze screen. The chat transport
// is mocked (no provider call); the free engine route is a stubbed fetch; the conversation store
// is a pair of fake server actions. Synthetic institutions and invented figures only.

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
vi.mock("@/app/pro/(hamilton)/settings/actions", () => ({ createPeerSet: vi.fn() }));
import { AnalyzeWorkspace } from "./AnalyzeWorkspace";

const cu = { id: 101, name: "Synthetic CU" } as HamiltonSelectedInstitutionContext;
const otherBank = { id: 303, name: "Synthetic Bank" } as HamiltonSelectedInstitutionContext;

const peer = (id: number, name: string, state = "FL"): PeerListRow => ({
  institutionId: id, name, charterType: "credit_union", city: "Orlando", stateCode: state, totalAssetsUsd: 1_000_000_000,
  reportDate: "2026-06-30", source: "ncua", sourceUrl: null, recordId: id, feeCoverage: "not_found", inclusionReason: "Matches the stated criteria.",
});
const list = (rows: PeerListRow[], shortAnswer: string): PeerListResponse => ({
  kind: "peer_list", shortAnswer,
  peerList: { version: 1, status: "ready", subject: peer(101, "Synthetic CU"), criteria: null, rows, totalMatches: rows.length, queriedAt: "2026-10-10T00:00:00Z", notes: ["Synthetic test data."] },
});
const ALL = [peer(202, "Alpha CU"), peer(203, "Beta CU"), peer(204, "Gamma CU", "GA")];
const FLORIDA = ALL.slice(0, 2);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noStoryline = () => json({ kind: "research", shortAnswer: "", pageChange: { screen: "none" } });
const clarifying = (fieldKey: string, inputKind: string, prompt: string): AskResponse => ({
  kind: "clarifying_question" as AskResponse["kind"], shortAnswer: prompt, pageChange: { screen: "none" },
  question: { prompt, inputKind, fieldKey } as AskResponse["question"],
});
const storyline: AskResponse = {
  kind: "research", shortAnswer: "x", pageChange: { screen: "research", feeCategory: "overdraft" },
  answer: buildFeeAnswer(overdraftResearch()), decisionId: "d1", savedAnalysisId: "11111111-1111-4111-8111-111111111111",
};

type Body = Record<string, unknown> & { question?: string; answer?: { fieldKey: string; value: string }; previousPeerList?: { selectedIds: number[]; originQuestion: string } | null };
let requests: Array<{ url: string; body: Body; signal?: AbortSignal | null }>;
let engine: (body: Body, url: string) => Response | Promise<Response>;

beforeEach(() => {
  chat.options.length = 0;
  chat.send.mockReset(); chat.setMessages.mockReset(); chat.clearError.mockReset(); chat.stop.mockReset();
  chat.save.mockReset().mockResolvedValue({ id: "saved" });
  requests = [];
  engine = () => noStoryline();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Body;
    requests.push({ url, body, signal: init.signal });
    if (url.endsWith("/memo")) return json({ status: "withheld", reason: "Synthetic memo held." });
    return engine(body, url);
  }));
  window.history.replaceState(null, "", "/pro/analyze");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Every enabled free-text field on the page: the H04-T03 invariant is exactly one. */
function freeTextFields(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input")].filter(
    (el) => !el.disabled && !["hidden", "checkbox", "radio", "button", "submit"].includes((el as HTMLInputElement).type),
  );
}
function expectOneComposer(label?: RegExp) {
  expect(freeTextFields()).toHaveLength(1);
  if (label) expect(screen.getByRole("textbox", { name: label })).toBe(freeTextFields()[0]);
}
const composer = () => screen.getByRole("textbox") as HTMLTextAreaElement;
async function type(question: string) {
  fireEvent.change(composer(), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /^(Ask( Hamilton)?|Answer)$/ }));
  await act(async () => {});
}
const engineAsks = () => requests.filter((r) => r.url === "/api/hamilton/ask");

function store() {
  const recorded: HamiltonConversationState[] = [];
  let n = 0;
  const startConversationAction = vi.fn(async () => ({ id: `8f14e45f-ceea-467f-a0f6-37f8b3a3e2f${++n}` }));
  const recordConversationAction = vi.fn(async (_id: string, state: unknown) => {
    recorded.push(state as HamiltonConversationState);
    return { ok: true };
  });
  return { recorded, startConversationAction, recordConversationAction };
}

describe("one active composer (H04-T03)", () => {
  it("shows exactly one enabled free-text field on the start screen, after an answer and during a clarification", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    expectOneComposer(/Your question/);
    engine = () => json(clarifying("fee.overdraft.annual_items", "number", "How many overdraft items a year?"));
    await type("What if we charged $25 for overdraft?");
    await screen.findByText("How many overdraft items a year?");
    expectOneComposer(/Answer Hamilton's question: How many overdraft items a year\?/);
    fireEvent.click(screen.getByRole("button", { name: "Ask something else instead" }));
    expectOneComposer(/Ask a follow-up/);
  });

  it("shows one field for a reopened saved answer and for a resumed conversation", () => {
    const saved: AnalyzeResponse = { title: "t", confidence: { level: "medium", basis: [] }, hamiltonView: "The overdraft fee is $30.", whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] };
    const view = render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} initialAnalysisId="sa-1" initialAnalysis={saved} initialAnalysisPrompt="What is the overdraft fee?" />);
    expectOneComposer(/Ask a follow-up/);
    view.unmount();
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} initialConversation={resumable()} />);
    expect(screen.getByText("Pick up where you left off")).toBeTruthy();
    expectOneComposer(/Ask a follow-up/);
  });

  it("lets a resumed conversation show its unsaved peer list again, and open a saved answer", () => {
    const state = resumable();
    const withSaved = { ...state, turns: [{ ...state.turns[0], id: "t0", question: "What is the overdraft fee?", route: "written" as const, savedAnalysisId: "sa-9" }, ...state.turns] };
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} initialConversation={withSaved} />);
    expect(screen.getByText("Your last peer list wasn't saved. Show it again, or ask a follow-up below.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open this answer" }).getAttribute("href")).toContain("analysis=sa-9");
    expect(screen.getByRole("button", { name: "Show this list again" })).toBeTruthy();
  });
});

describe("clarifications in the same composer (H04-T04, AC3)", () => {
  it("validates in the composer, sends one reply, says when Hamilton could not read it, and returns to questions", async () => {
    let replies = 0;
    engine = (body) => {
      if (!body.answer) return json(clarifying("fee.overdraft.annual_items", "number", "How many overdraft items a year?"));
      replies += 1;
      return replies === 1
        ? json(clarifying("fee.overdraft.annual_items", "number", "How many overdraft items a year?"))
        : json({ kind: "saved_fact", shortAnswer: "Saved: about 12,000 overdraft items a year.", pageChange: { screen: "none" } });
    };
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    await type("What if we charged $25 for overdraft?");
    await screen.findByText("How many overdraft items a year?");

    await type("lots");
    expect(screen.getByRole("alert").textContent).toBe("Enter a number, for example 12,000.");
    expect(composer().value).toBe("lots");
    expect(engineAsks().filter((r) => r.body.answer)).toHaveLength(0);

    await type("12,000");
    await waitFor(() => expect(engineAsks().filter((r) => r.body.answer)).toHaveLength(1));
    expect(engineAsks().at(-1)?.body.answer).toEqual({ fieldKey: "fee.overdraft.annual_items", value: "12,000" });
    await screen.findByText("Hamilton couldn't read “12,000” as a number. Enter a number, for example 12,000.");
    expectOneComposer(/Answer Hamilton's question/);

    await type("12000");
    await screen.findByText("Saved: about 12,000 overdraft items a year.");
    await waitFor(() => expectOneComposer(/Ask a follow-up/));
    expect(engineAsks().filter((r) => r.body.answer)).toHaveLength(2);
  });

  it("cancel returns the composer to questions; a new conversation inherits no clarification, decision or earlier turn", async () => {
    engine = (body) => body.question?.includes("$25") ? json(clarifying("fee.overdraft.annual_items", "number", "How many overdraft items a year?")) : json(storyline);
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    await type("how does my overdraft fee compare?");
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/memo"))).toBe(true));
    await type("What if we charged $25 for overdraft?");
    await screen.findByText("How many overdraft items a year?");
    expect(engineAsks().at(-1)?.body.decisionId).toBe("d1");

    fireEvent.click(screen.getByRole("button", { name: "Ask something else instead" }));
    expectOneComposer(/Ask a follow-up/);
    // The question stays on offer beside the answer; a tap hands it back to the composer.
    fireEvent.click(screen.getByRole("button", { name: "Answer this question" }));
    expectOneComposer(/Answer Hamilton's question: How many overdraft items a year\?/);
    fireEvent.click(screen.getByRole("button", { name: "Ask something else instead" }));

    engine = () => json(clarifying("fee.overdraft.annual_items", "number", "How many overdraft items a year?"));
    await type("What if we charged $26 for overdraft?");
    await screen.findByText("How many overdraft items a year?");
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.queryByText("How many overdraft items a year?")).toBeNull();
    expect(screen.queryByText("Earlier in this conversation")).toBeNull();
    expectOneComposer(/Your question/);
    engine = () => noStoryline();
    await type("What is the wire fee?");
    await waitFor(() => expect(chat.send).toHaveBeenCalled());
    expect(engineAsks().at(-1)?.body.decisionId).toBeUndefined();
    expect((chat.send.mock.calls.at(-1)?.[0] as { text: string }).text).toBe("What is the wire fee?");
  });

  it("keeps a reply that could not be sent in the composer (H04-T08)", async () => {
    engine = (body) => body.answer ? json({ error: "down" }, 500) : json(clarifying("fee.overdraft.annual_items", "number", "How many overdraft items a year?"));
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    await type("What if we charged $25 for overdraft?");
    await screen.findByText("How many overdraft items a year?");
    await type("12000");
    await screen.findByText("Hamilton couldn't send your reply just now. It's back in the question box. Send it again.");
    expect(composer().value).toBe("12000");
  });

  it("never sends on Enter while an input method is composing (H04-T08)", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    fireEvent.change(composer(), { target: { value: "What is the overdraft fee?" } });
    fireEvent.keyDown(composer(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(composer(), { key: "Enter", keyCode: 229 });
    await act(async () => {});
    expect(engineAsks()).toHaveLength(0);
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(engineAsks()).toHaveLength(1));
  });
});

describe("multi-turn context through the structured and peer routes (H04-T05, AC2)", () => {
  it("lists peers, refines to Florida, compares their NSF fees and compares with us on the same peer IDs", async () => {
    engine = (body) => {
      if (body.question === "List ten peers") return json(list(ALL, "3 matching credit unions for Synthetic CU."));
      return json(list(FLORIDA, `Answer to ${body.question}`));
    };
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    await type("List ten peers");
    await screen.findByText("Alpha CU");
    await type("Only Florida");
    await waitFor(() => expect(engineAsks()).toHaveLength(2));
    await screen.findByText("Answer to Only Florida", { exact: false }).catch(() => null);
    await type("Compare their NSF fees");
    await waitFor(() => expect(engineAsks()).toHaveLength(3));
    await act(async () => {});
    await type("How does this compare with us?");
    await waitFor(() => expect(engineAsks()).toHaveLength(4));

    const [first, florida, nsf, withUs] = engineAsks().map((r) => r.body);
    expect(first.previousPeerList).toBeUndefined();
    expect(florida.previousPeerList?.selectedIds).toEqual([202, 203, 204]);
    expect(nsf.previousPeerList?.selectedIds).toEqual([202, 203]);
    expect(withUs.previousPeerList?.selectedIds).toEqual([202, 203]);
    for (const b of [florida, nsf, withUs]) {
      expect(b.institutionId).toBe("101");
      expect(b.previousPeerList?.originQuestion).toBe("List ten peers");
    }
    // The conversation stays visible and no written (paid) answer was asked for.
    const earlier = screen.getByRole("region", { name: "Earlier in this conversation" }).textContent ?? "";
    expect(earlier).toContain("List ten peers");
    expect(earlier).toContain("Compare their NSF fees");
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("continues the engine decision for the same fee or no fee, never for another fee", async () => {
    engine = (body) => (body.question?.includes("overdraft") ? json(storyline) : noStoryline());
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    await type("how does my overdraft fee compare?");
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/memo"))).toBe(true));
    await type("how does that compare nationally?");
    await waitFor(() => expect(engineAsks()).toHaveLength(2));
    expect(engineAsks()[1].body.decisionId).toBe("d1");
    await type("how does our NSF fee compare?");
    await waitFor(() => expect(engineAsks()).toHaveLength(3));
    expect(engineAsks()[2].body.decisionId).toBeUndefined();
  });

  it("a reopened saved answer is the earlier turn of its first follow-up", async () => {
    const saved: AnalyzeResponse = { title: "t", confidence: { level: "medium", basis: [] }, hamiltonView: "The overdraft fee is $30.", whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] };
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} initialAnalysisId="sa-1" initialAnalysis={saved} initialAnalysisPrompt="What is the overdraft fee?" />);
    await type("And the NSF fee?");
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1));
    const sent = (chat.send.mock.calls[0][0] as { text: string }).text;
    expect(sent).toContain('1. I asked: "What is the overdraft fee?" Hamilton answered: "The overdraft fee is $30."');
  });
});

function resumable(): HamiltonConversationState {
  return parseConversationState({
    version: 1, conversationId: "8f14e45f-ceea-467f-a0f6-37f8b3a3e2f9", revision: 5, nonce: 1,
    subject: { institutionId: "101", institutionName: "Synthetic CU" },
    turns: [{ id: "t1", question: "List ten peers", lead: "3 matching credit unions for Synthetic CU.", route: "peer_list", status: "answered", savedAnalysisId: null }],
    peerSet: {
      snapshot: {
        originQuestion: "List ten peers", originInstitutionId: "101", originSubjectId: 101,
        originRows: ALL.map((r) => ({ institutionId: r.institutionId, recordId: r.recordId, reportDate: r.reportDate, source: r.source })),
        selectedIds: [202, 203, 204],
      },
      answeredNonce: 1, answeredQuestion: "List ten peers",
    },
    decision: null, clarification: null, previousSubject: null,
  })!;
}

describe("reload, navigation and reset (H04-T06)", () => {
  it("stores the conversation once answered, puts its ID in the address, and starts a new one after reset", async () => {
    const s = store();
    engine = (body) => json(list(body.question === "List ten peers" ? ALL : FLORIDA, `Answer to ${body.question}`));
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} startConversationAction={s.startConversationAction} recordConversationAction={s.recordConversationAction} />);
    await type("List ten peers");
    await waitFor(() => expect(s.recordConversationAction).toHaveBeenCalled());
    expect(s.startConversationAction).toHaveBeenCalledTimes(1);
    expect(new URL(window.location.href).searchParams.get("conversation")).toBe("8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1");
    const stored = parseConversationState(JSON.parse(JSON.stringify(s.recorded.at(-1))));
    expect(stored?.turns.map((t) => [t.question, t.route, t.status])).toEqual([["List ten peers", "peer_list", "answered"]]);
    expect(stored?.peerSet?.snapshot.selectedIds).toEqual([202, 203, 204]);
    // Revisions only go up, so the store can refuse a late, older snapshot.
    const revisions = s.recorded.map((r) => r.revision);
    expect([...revisions].sort((a, b) => a - b)).toEqual(revisions);

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    engine = () => noStoryline();
    await type("What is the wire fee?");
    await act(async () => {
      await chat.options.at(-1)?.onFinish?.({ message: { parts: [{ type: "text", text: "## Hamilton's View\nThe wire fee is $20." }], metadata: { savedAnalysisId: "22222222-2222-4222-8222-222222222222" } }, isError: false, isAbort: false });
    });
    await waitFor(() => expect(s.startConversationAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(s.recorded.at(-1)?.conversationId).toBe("8f14e45f-ceea-467f-a0f6-37f8b3a3e2f2"));
    expect(s.recorded.at(-1)?.turns.map((t) => [t.question, t.savedAnalysisId])).toEqual([["What is the wire fee?", "22222222-2222-4222-8222-222222222222"]]);
  });

  it("a reloaded conversation keeps its peer list for the next follow-up, and opening it stores nothing", async () => {
    const s = store();
    engine = () => json(list(FLORIDA, "2 matching credit unions in Florida."));
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} initialConversation={resumable()} startConversationAction={s.startConversationAction} recordConversationAction={s.recordConversationAction} />);
    expect(screen.getByRole("region", { name: "Earlier in this conversation" }).textContent).toContain("List ten peers");
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(s.recordConversationAction).not.toHaveBeenCalled();
    await type("Only Florida");
    await waitFor(() => expect(engineAsks()).toHaveLength(1));
    expect(engineAsks()[0].body.previousPeerList?.selectedIds).toEqual([202, 203, 204]);
    await waitFor(() => expect(s.recordConversationAction).toHaveBeenCalled());
    // The same stored conversation continues; no second one is created.
    expect(s.startConversationAction).not.toHaveBeenCalled();
    expect(s.recordConversationAction.mock.calls.at(-1)?.[0]).toBe("8f14e45f-ceea-467f-a0f6-37f8b3a3e2f9");
  });

  it("names the earlier subject when a conversation starts fresh for another institution", () => {
    const fresh = { ...resumable(), turns: [], peerSet: null, conversationId: null, subject: { institutionId: "303", institutionName: "Synthetic Bank" }, previousSubject: { institutionId: "101", institutionName: "Synthetic CU" } };
    render(<AnalyzeWorkspace userId={7} institutionId="303" selectedInstitution={otherBank} initialConversation={fresh} />);
    expect(document.body.textContent).toContain("Now researching Synthetic Bank. Earlier answers about Synthetic CU are not carried into this conversation.");
  });
});

describe("no stale requests (H04-T07, AC4)", () => {
  it("aborts the engine request and drops its late answer when the subject changes", async () => {
    let release: (r: Response) => void = () => {};
    engine = () => new Promise<Response>((resolve) => { release = resolve; });
    const view = render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    await type("how does my overdraft fee compare?");
    await waitFor(() => expect(engineAsks()).toHaveLength(1));
    const signal = engineAsks()[0].signal;
    view.rerender(<AnalyzeWorkspace userId={7} institutionId="303" selectedInstitution={otherBank} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { release(json(storyline)); });
    expect(document.body.textContent).toContain("Researching Synthetic Bank");
    expect(document.body.textContent).not.toContain("how does my overdraft fee compare?");
    expect(requests.some((r) => r.url.endsWith("/memo"))).toBe(false);
    expect(chat.send).not.toHaveBeenCalled();
    expectOneComposer(/Your question/);
  });

  it("drops a slow answer after New conversation, so it cannot fill the fresh conversation", async () => {
    let release: (r: Response) => void = () => {};
    engine = () => new Promise<Response>((resolve) => { release = resolve; });
    render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} />);
    await type("What if we charged $25 for overdraft?");
    await waitFor(() => expect(engineAsks()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(engineAsks()[0].signal?.aborted).toBe(true);
    await act(async () => { release(json(clarifying("fee.overdraft.annual_items", "number", "How many overdraft items a year?"))); });
    expect(screen.queryByText("How many overdraft items a year?")).toBeNull();
    expectOneComposer(/Your question/);
  });
});

describe("progress after an engine failure under Strict Mode (H04-T07/T08)", () => {
  it("clears the reading strip once the engine fails and hands one question to the written answer", async () => {
    engine = () => json({ error: "down" }, 500);
    render(<StrictMode><AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={cu} /></StrictMode>);
    await type("what is a call report?");
    await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByText("Hamilton is reading the selected institution and market data.")).toBeNull();
    expect(chat.send).toHaveBeenCalledTimes(1);
  });
});
