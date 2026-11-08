// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonConversationState } from "@/lib/hamilton/conversation-state";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { PeerListResponse, PeerListRow } from "@/lib/hamilton/peer-list";

// Independent #975 / H04-T06 expectations, frozen before the process fix. These fake action
// results are component evidence only; they do not establish that native history was stored.
const chat = vi.hoisted(() => ({
  send: vi.fn(), setMessages: vi.fn(), clearError: vi.fn(), stop: vi.fn(), save: vi.fn(),
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [], status: "ready", sendMessage: chat.send, setMessages: chat.setMessages,
    clearError: chat.clearError, stop: chat.stop, error: undefined,
  }),
}));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ saveAnalysis: chat.save }));
vi.mock("@/app/pro/(hamilton)/settings/actions", () => ({ createPeerSet: vi.fn() }));
import { AnalyzeWorkspace } from "./AnalyzeWorkspace";

const CONVERSATION_ID = "8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1";
const QUESTION = "List ten peers";
const SUBJECT = { id: 101, name: "Synthetic CU" } as HamiltonSelectedInstitutionContext;
const peer = (id: number, name: string, state: string): PeerListRow => ({
  institutionId: id, name, charterType: "credit_union", city: "Orlando", stateCode: state,
  totalAssetsUsd: 1_000_000_000, reportDate: "2026-06-30", source: "ncua", sourceUrl: null,
  recordId: id, feeCoverage: "not_found", inclusionReason: "Matches the stated criteria.",
});
const ANSWER: PeerListResponse = {
  kind: "peer_list", shortAnswer: "3 matching credit unions for Synthetic CU.",
  peerList: {
    version: 1, status: "ready", subject: peer(101, "Synthetic CU", "FL"), criteria: null,
    rows: [peer(202, "Alpha CU", "FL"), peer(203, "Beta CU", "FL"), peer(204, "Gamma CU", "GA")],
    totalMatches: 3, queriedAt: "2026-10-10T00:00:00Z", notes: ["Synthetic test data."],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let asks: Array<{ url: string; body: { question?: string } }>;
beforeEach(() => {
  chat.send.mockReset(); chat.setMessages.mockReset(); chat.clearError.mockReset();
  chat.stop.mockReset(); chat.save.mockReset();
  asks = [];
  window.history.replaceState(null, "", "/pro/analyze");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url !== "/api/hamilton/ask") throw new Error("Unexpected synthetic request");
    asks.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(ANSWER), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(record: (id: string, state: unknown) => Promise<{ ok: boolean }>) {
  const start = vi.fn(async () => ({ id: CONVERSATION_ID }));
  render(<AnalyzeWorkspace userId={7} institutionId="101" selectedInstitution={SUBJECT}
    startConversationAction={start} recordConversationAction={record} />);
  return start;
}

async function answerQuestion() {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: QUESTION } });
  fireEvent.click(screen.getByRole("button", { name: /^(Ask( Hamilton)?|Answer)$/ }));
  await waitFor(() => expect(document.body.textContent).toContain("Alpha CU"));
}

function expectAnswerRetained() {
  expect(document.body.textContent).toContain("Alpha CU");
  expect(document.body.textContent).toContain("Beta CU");
  expect(document.body.textContent).toContain("Gamma CU");
  expect(asks).toHaveLength(1);
  expect(asks[0].body.question).toBe("List ten peers");
  expect(chat.send).not.toHaveBeenCalled();
  expect(chat.save).not.toHaveBeenCalled();
}

describe("conversation pointer follows acknowledged history (H04-T06)", () => {
  it("CP-01: keeps a first conversation pointer unpublished while the actual record call is pending", async () => {
    const pending = deferred<{ ok: boolean }>();
    const record = vi.fn<RecordConversation>(() => pending.promise);
    const start = mount(record);
    await answerQuestion();
    await waitFor(() => expect(record).toHaveBeenCalled());
    expect(start).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toBe(CONVERSATION_ID);
    expectAnswerRetained();
    expect(new URL(window.location.href).searchParams.get("conversation")).toBeNull();
  });

  it.each(["false", "rejected"] as const)("CP-02: retains the answer without publishing a first pointer after a %s record", async (failure) => {
    let returned = false;
    const record = vi.fn(async () => {
      returned = true;
      if (failure === "rejected") throw new Error("Synthetic snapshot storage refusal");
      return { ok: false };
    });
    const start = mount(record);
    await answerQuestion();
    await waitFor(() => expect(record).toHaveBeenCalled());
    await act(async () => {});
    expect(returned).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expectAnswerRetained();
    expect(new URL(window.location.href).searchParams.get("conversation")).toBeNull();
  });

  it("CP-03 control: publishes the exact acknowledged ID with the intended subject, question and peer membership", async () => {
    const acknowledgement = deferred<{ ok: boolean }>();
    const recorded: Array<{ id: string; state: HamiltonConversationState }> = [];
    const record = vi.fn((id: string, state: unknown) => {
      recorded.push({ id, state: JSON.parse(JSON.stringify(state)) });
      return acknowledgement.promise;
    });
    const start = mount(record);
    await answerQuestion();
    await waitFor(() => expect(record).toHaveBeenCalled());
    await act(async () => { acknowledgement.resolve({ ok: true }); });
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("conversation")).toBe(CONVERSATION_ID));
    expect(start).toHaveBeenCalledTimes(1);
    expect(recorded[0].id).toBe("8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1");
    expect(recorded[0].state.subject).toEqual({ institutionId: "101", institutionName: "Synthetic CU" });
    expect(recorded[0].state.turns.map((turn) => [turn.question, turn.route, turn.status])).toEqual([
      ["List ten peers", "peer_list", "answered"],
    ]);
    expect(recorded[0].state.peerSet?.snapshot.selectedIds).toEqual([202, 203, 204]);
    expect(recorded[0].state.peerSet?.snapshot.originInstitutionId).toBe("101");
    expect(recorded[0].state.peerSet?.snapshot.originRows.map((row) => [row.institutionId, row.recordId, row.source, row.reportDate])).toEqual([
      [202, 202, "ncua", "2026-06-30"], [203, 203, "ncua", "2026-06-30"], [204, 204, "ncua", "2026-06-30"],
    ]);
    expectAnswerRetained();
  });
});

// Supplemental prospective CP-04–08 cases. Keep the original four-case prefix above intact;
// a successful fake action here establishes client ordering only, never native persistence.
const FAILURE = "We couldn’t finish saving this conversation. Your answers are still here.";
const SAVING = "Saving conversation…";
const OTHER_SUBJECT = { id: 303, name: "Synthetic Bank" } as HamiltonSelectedInstitutionContext;
const BRIEF_QUESTION = "Tell me about Ohio";

function savedConversation(revision = 10): HamiltonConversationState {
  return {
    version: 1, conversationId: CONVERSATION_ID, revision, nonce: 1,
    subject: { institutionId: "101", institutionName: "Synthetic CU" },
    turns: [{ id: "t1", question: "List ten peers", lead: "3 matching credit unions for Synthetic CU.", route: "peer_list", status: "answered", savedAnalysisId: null }],
    peerSet: {
      snapshot: {
        originQuestion: "List ten peers", originInstitutionId: "101", originSubjectId: 101,
        originRows: [
          { institutionId: 202, recordId: 202, source: "ncua", reportDate: "2026-06-30" },
          { institutionId: 203, recordId: 203, source: "ncua", reportDate: "2026-06-30" },
          { institutionId: 204, recordId: 204, source: "ncua", reportDate: "2026-06-30" },
        ],
        selectedIds: [202, 203, 204],
      },
      answeredNonce: 1, answeredQuestion: "List ten peers",
    },
    decision: null, clarification: null, previousSubject: null,
  };
}

function raceMount(options: {
  start?: () => Promise<{ id: string } | { error: string }>;
  record: (id: string, state: unknown) => Promise<{ ok: boolean }>;
  initialConversation?: HamiltonConversationState;
}) {
  const start = vi.fn(options.start ?? (async () => ({ id: CONVERSATION_ID })));
  const props = {
    userId: 7, institutionId: "101", selectedInstitution: SUBJECT,
    startConversationAction: start, recordConversationAction: options.record,
    initialConversation: options.initialConversation,
  };
  const view = render(<AnalyzeWorkspace {...props} />);
  return { start, view, props };
}

type RecordConversation = (id: string, state: unknown) => Promise<{ ok: boolean }>;

function repliesForFollowUps() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url !== "/api/hamilton/ask") throw new Error("Unexpected synthetic request");
    const body = JSON.parse(String(init.body)) as { question?: string };
    asks.push({ url, body });
    let answer = ANSWER;
    if (body.question === "Only Florida") answer = {
      ...ANSWER, shortAnswer: "2 Florida matches.",
      peerList: { ...ANSWER.peerList, rows: [peer(202, "Alpha CU", "FL"), peer(203, "Beta CU", "FL")], totalMatches: 2 },
    };
    if (body.question === "Only Georgia") answer = {
      ...ANSWER, shortAnswer: "1 Georgia match.",
      peerList: { ...ANSWER.peerList, rows: [peer(204, "Gamma CU", "GA")], totalMatches: 1 },
    };
    return new Response(JSON.stringify(answer), { status: 200 });
  }));
}

async function submitQuestion(question: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /^(Ask( Hamilton)?|Answer)$/ }));
  await act(async () => {});
}

async function beyondSaveDebounce() {
  await act(async () => { await new Promise((done) => setTimeout(done, 350)); });
}

async function expectFailure() {
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(FAILURE);
  expect(screen.getByRole("button", { name: "Retry saving conversation" })).toBeEnabled();
}

describe("conversation retry and lifecycle (H04-T06/T07/T08)", () => {
  it("CP-04: retries the same private allocation without another Ask or provider request", async () => {
    const recorded: Array<{ id: string; state: HamiltonConversationState }> = [];
    const record = vi.fn(async (id: string, raw: unknown) => {
      recorded.push({ id, state: JSON.parse(JSON.stringify(raw)) });
      return { ok: recorded.length > 1 };
    });
    const { start } = raceMount({ record });
    await answerQuestion();
    await expectFailure();
    expect(new URL(window.location.href).searchParams.get("conversation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry saving conversation" }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("conversation")).toBe(CONVERSATION_ID));
    await beyondSaveDebounce();
    expect(start).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(2);
    expect(recorded.map((entry) => entry.id)).toEqual([CONVERSATION_ID, CONVERSATION_ID]);
    expect(recorded[1].state.turns).toEqual(recorded[0].state.turns);
    expect(screen.queryByText(SAVING)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expectAnswerRetained();
  });

  it("CP-04 ambiguity: advances wire revision when the first snapshot committed but its acknowledgement was refused", async () => {
    let committedRevision = -1;
    const writes: HamiltonConversationState[] = [];
    const record = vi.fn(async (_id: string, raw: unknown) => {
      const state = JSON.parse(JSON.stringify(raw)) as HamiltonConversationState;
      writes.push(state);
      if (state.revision <= committedRevision) return { ok: false };
      committedRevision = state.revision;
      return { ok: writes.length > 1 };
    });
    const { start } = raceMount({ record });
    await answerQuestion();
    await expectFailure();
    const firstCommittedContent = JSON.parse(JSON.stringify(writes[0].turns));
    fireEvent.click(screen.getByRole("button", { name: "Retry saving conversation" }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("conversation")).toBe(CONVERSATION_ID));
    await beyondSaveDebounce();
    expect(start).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(2);
    expect(writes[1].revision).toBeGreaterThan(writes[0].revision);
    expect(writes[1].revision).toBeLessThanOrEqual(1_000_000);
    expect(writes[1].turns).toEqual(firstCommittedContent);
    expect(screen.queryByRole("alert")).toBeNull();
    expectAnswerRetained();
  });

  it("CP-05: discards a pending allocation after New conversation without recording its answer", async () => {
    const allocation = deferred<{ id: string }>();
    const record = vi.fn(async () => ({ ok: true }));
    const { start } = raceMount({ start: () => allocation.promise, record });
    await answerQuestion();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(screen.getByText(SAVING)).toHaveAttribute("role", "status");
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    await act(async () => { allocation.resolve({ id: CONVERSATION_ID }); });
    await beyondSaveDebounce();
    expect(record).not.toHaveBeenCalled();
    expect(new URL(window.location.href).searchParams.get("conversation")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(document.body.textContent).not.toContain("Alpha CU");
    expect(screen.queryByText(SAVING)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["reset", "unmount", "subject"] as const)("CP-05: a pending record cannot publish into a later %s view", async (transition) => {
    const oldRecord = deferred<{ ok: boolean }>();
    const record = vi.fn<RecordConversation>(() => oldRecord.promise);
    const { start, view, props } = raceMount({ record });
    await answerQuestion();
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    if (transition === "reset") fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    if (transition === "unmount") view.unmount();
    if (transition === "subject") view.rerender(<AnalyzeWorkspace {...props} institutionId="303" selectedInstitution={OTHER_SUBJECT} />);
    window.history.replaceState(null, "", "/pro/analyze?instId=303");
    await act(async () => { oldRecord.resolve({ ok: true }); });
    await beyondSaveDebounce();
    expect(window.location.pathname + window.location.search).toBe("/pro/analyze?instId=303");
    expect(record).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SAVING)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    if (transition !== "unmount") {
      expect(screen.getByRole("textbox")).toHaveValue("");
      expect(document.body.textContent).not.toContain("Alpha CU");
    }
    if (transition === "subject") expect(document.body.textContent).toContain("Researching Synthetic Bank");
  });

  it("CP-06: preserves an existing durable pointer when its later turn cannot be saved", async () => {
    repliesForFollowUps();
    const initial = savedConversation();
    const before = JSON.parse(JSON.stringify(initial));
    window.history.replaceState(null, "", `/pro/analyze?conversation=${CONVERSATION_ID}`);
    const record = vi.fn(async () => ({ ok: false }));
    const { start } = raceMount({ record, initialConversation: initial });
    await beyondSaveDebounce();
    expect(record).not.toHaveBeenCalled();
    await submitQuestion("Only Florida");
    await expectFailure();
    expect(new URL(window.location.href).searchParams.get("conversation")).toBe(CONVERSATION_ID);
    expect(document.body.textContent).toContain("2 Florida matches.");
    expect(start).not.toHaveBeenCalled();
    expect(initial).toEqual(before);
    expect(asks).toHaveLength(1);
    expect(chat.send).not.toHaveBeenCalled();
  });

  it.each([true, false])("CP-07: coalesces newer content behind an older record returning %s without falsely marking it saved", async (oldOk) => {
    repliesForFollowUps();
    const first = deferred<{ ok: boolean }>();
    const latest = deferred<{ ok: boolean }>();
    const recorded: HamiltonConversationState[] = [];
    const record = vi.fn((_id: string, raw: unknown) => {
      recorded.push(JSON.parse(JSON.stringify(raw)));
      return recorded.length === 1 ? first.promise : latest.promise;
    });
    const { start } = raceMount({ record });
    await answerQuestion();
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await submitQuestion("Only Florida");
    await waitFor(() => expect(document.body.textContent).toContain("2 Florida matches."));
    await submitQuestion("Only Georgia");
    await waitFor(() => expect(document.body.textContent).toContain("1 Georgia match."));
    await beyondSaveDebounce();
    expect(record).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SAVING)).toHaveAttribute("role", "status");
    await act(async () => { first.resolve({ ok: oldOk }); });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(screen.getByText(SAVING)).toHaveAttribute("role", "status");
    expect(recorded[0].turns.map((turn) => turn.question)).toEqual(["List ten peers"]);
    expect(recorded[1].turns.map((turn) => turn.question)).toEqual(["List ten peers", "Only Florida", "Only Georgia"]);
    expect(recorded[1].peerSet?.snapshot.selectedIds).toEqual([204]);
    expect(recorded[1].revision).toBeGreaterThan(recorded[0].revision);
    await act(async () => { latest.resolve({ ok: true }); });
    await waitFor(() => expect(screen.queryByText(SAVING)).toBeNull());
    await beyondSaveDebounce();
    expect(record).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(new URL(window.location.href).searchParams.get("conversation")).toBe(CONVERSATION_ID);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).toContain("1 Georgia match.");
    expect(asks.map((ask) => ask.body.question)).toEqual(["List ten peers", "Only Florida", "Only Georgia"]);
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("CP-07 cap: refuses an update past the stored revision parser's 1,000,000 boundary", async () => {
    repliesForFollowUps();
    window.history.replaceState(null, "", `/pro/analyze?conversation=${CONVERSATION_ID}`);
    const record = vi.fn(async () => ({ ok: true }));
    const { start } = raceMount({ record, initialConversation: savedConversation(1_000_000) });
    await submitQuestion("Only Florida");
    await expectFailure();
    expect(record).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(new URL(window.location.href).searchParams.get("conversation")).toBe(CONVERSATION_ID);
    expect(document.body.textContent).toContain("2 Florida matches.");
  });
});

// JSDOM does not perform full navigation. Its existing navigation diagnostic lets the actual
// handler's attempted assign be observed, with a normal-ack positive control. This is not a
// browser navigation/effect receipt and never replaces native CP-08 acceptance.
function observeNavigationAttempt() {
  const virtualConsole = (globalThis as typeof globalThis & { jsdom?: { virtualConsole: {
    on: (event: "jsdomError", listener: (error: Error) => void) => void;
    removeListener: (event: "jsdomError", listener: (error: Error) => void) => void;
  } } }).jsdom?.virtualConsole;
  if (!virtualConsole) throw new Error("Existing JSDOM virtual console is unavailable");
  const attempts: string[] = [];
  const observe = (error: Error) => {
    if (error.message.includes("Not implemented: navigation")) attempts.push(error.message);
  };
  virtualConsole.on("jsdomError", observe);
  return {
    attempts: () => [...attempts],
    restore: () => virtualConsole.removeListener("jsdomError", observe),
  };
}

describe("market brief waits for acknowledged current conversation (CP-08)", () => {
  it("keeps a failed brief save in Analyze and a retry only saves, without reviving navigation", async () => {
    const navigation = observeNavigationAttempt();
    let calls = 0;
    const record = vi.fn(async () => ({ ok: ++calls > 1 }));
    try {
      raceMount({ record });
      await submitQuestion(BRIEF_QUESTION);
      await expectFailure();
      expect(screen.getByRole("textbox")).toHaveValue("Tell me about Ohio");
      expect(new URL(window.location.href).searchParams.get("brief")).toBeNull();
      expect(navigation.attempts()).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Retry saving conversation" }));
      await waitFor(() => expect(new URL(window.location.href).searchParams.get("conversation")).toBe(CONVERSATION_ID));
      await beyondSaveDebounce();
      expect(record).toHaveBeenCalledTimes(2);
      expect(navigation.attempts()).toHaveLength(0);
      expect(asks).toHaveLength(0);
      expect(chat.send).not.toHaveBeenCalled();
    } finally { navigation.restore(); }
  });

  it("positive control observes the normal acknowledged brief handler's navigation attempt", async () => {
    const navigation = observeNavigationAttempt();
    const acknowledged = deferred<{ ok: boolean }>();
    const record = vi.fn<RecordConversation>(() => acknowledged.promise);
    try {
      raceMount({ record });
      await submitQuestion(BRIEF_QUESTION);
      await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
      expect(navigation.attempts()).toHaveLength(0);
      await act(async () => { acknowledged.resolve({ ok: true }); });
      await waitFor(() => expect(navigation.attempts()).toHaveLength(1));
      expect(new URL(window.location.href).searchParams.get("conversation")).toBe(CONVERSATION_ID);
      expect(asks).toHaveLength(0);
      expect(chat.send).not.toHaveBeenCalled();
    } finally { navigation.restore(); }
  });

  it.each(["reset", "new-turn"] as const)("does not navigate after an old brief acknowledgement has been superseded by %s", async (transition) => {
    repliesForFollowUps();
    const navigation = observeNavigationAttempt();
    const acknowledged = deferred<{ ok: boolean }>();
    let calls = 0;
    const record = vi.fn<RecordConversation>(() => ++calls === 1 ? acknowledged.promise : Promise.resolve({ ok: true }));
    try {
      raceMount({ record });
      await submitQuestion(BRIEF_QUESTION);
      await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
      if (transition === "reset") fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
      else {
        await submitQuestion("List ten peers");
        await waitFor(() => expect(document.body.textContent).toContain("Alpha CU"));
      }
      await act(async () => { acknowledged.resolve({ ok: true }); });
      await beyondSaveDebounce();
      expect(navigation.attempts()).toHaveLength(0);
      if (transition === "reset") {
        expect(new URL(window.location.href).searchParams.get("conversation")).toBeNull();
        expect(screen.getByRole("textbox")).toHaveValue("");
      } else expect(document.body.textContent).toContain("Alpha CU");
    } finally { navigation.restore(); }
  });
});

describe("conversation acknowledgement during a URL handoff (CP-05)", () => {
  it("does not append conversation A when the browser URL has already selected B before the old view remounts", async () => {
    const pending = deferred<{ ok: boolean }>();
    const record = vi.fn<RecordConversation>(() => pending.promise);
    const { start } = raceMount({ record });
    await answerQuestion();
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    window.history.replaceState(null, "", "/pro/analyze?instId=303");
    await act(async () => { pending.resolve({ ok: true }); });
    await beyondSaveDebounce();
    expect(window.location.pathname + window.location.search).toBe("/pro/analyze?instId=303");
    expect(record).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(asks).toHaveLength(1);
    expect(chat.send).not.toHaveBeenCalled();
  });
});
