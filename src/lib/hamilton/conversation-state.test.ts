import { describe, expect, it } from "vitest";
import {
  clarificationInputError, composerMode, conversationReducer, currentTurn, decisionForQuestion, earlierTurns, emptyConversation,
  isCurrentTurn, MAX_STORED_TURNS, parseConversationState, resetConversation, serializeConversationState, stateAtSavedAnswer,
  switchSubject, type ActivePeerSet, type ConversationAction, type HamiltonConversationState,
} from "./conversation-state";

// #979 H04-T02: the one conversation state and its transitions. Synthetic data only.

const subject = { institutionId: "101", institutionName: "Synthetic CU" };
const peers: ActivePeerSet = {
  snapshot: {
    originQuestion: "List ten similar credit unions",
    originInstitutionId: "101",
    originSubjectId: 101,
    originRows: [
      { institutionId: 202, recordId: 202, reportDate: "2026-06-30", source: "ncua" },
      { institutionId: 203, recordId: null, reportDate: null, source: null },
    ],
    selectedIds: [202, 203],
  },
  answeredNonce: 1,
  answeredQuestion: "List ten similar credit unions",
};

function run(state: HamiltonConversationState, ...actions: ConversationAction[]): HamiltonConversationState {
  return actions.reduce(conversationReducer, state);
}
const turnId = (s: HamiltonConversationState) => currentTurn(s)!.id;

describe("conversation turns", () => {
  it("adds a pending turn per question and settles the previous one with its lead", () => {
    let s = run(emptyConversation(subject), { type: "ask", question: "What is the overdraft fee?" });
    expect(s.nonce).toBe(1);
    expect(currentTurn(s)).toMatchObject({ id: "t1", status: "pending", lead: null });
    s = run(s, { type: "answered", turnId: "t1", route: "written", savedAnalysisId: "sa1" });
    s = run(s, { type: "ask", question: "And the NSF fee?", previousLead: "The overdraft fee is $30." });
    expect(s.turns.map((t) => [t.id, t.question, t.lead, t.status])).toEqual([
      ["t1", "What is the overdraft fee?", "The overdraft fee is $30.", "answered"],
      ["t2", "And the NSF fee?", null, "pending"],
    ]);
    expect(earlierTurns(s)).toEqual([{ question: "What is the overdraft fee?", lead: "The overdraft fee is $30." }]);
  });

  it("retries the same question in place with a new nonce", () => {
    const s = run(emptyConversation(subject), { type: "ask", question: "Q?" }, { type: "failed", turnId: "t1" }, { type: "ask", question: "Q?" });
    expect(s.turns).toHaveLength(1);
    expect(currentTurn(s)).toMatchObject({ id: "t2", status: "pending" });
    expect(s.nonce).toBe(2);
  });

  it("drops late work for a turn that is no longer current", () => {
    const s = run(emptyConversation(subject), { type: "ask", question: "First?" }, { type: "ask", question: "Second?" });
    expect(isCurrentTurn(s, "t1")).toBe(false);
    const late = run(s, { type: "answered", turnId: "t1", lead: "Late lead", savedAnalysisId: "old" });
    expect(late).toBe(s);
    expect(run(s, { type: "clarify", turnId: "t1", question: { fieldKey: "fee.overdraft.annual_items", prompt: "How many?", inputKind: "number" } })).toBe(s);
  });

  it("bumps the revision on every change and keeps at most the stored turn limit", () => {
    let s = emptyConversation(subject);
    for (let i = 0; i < MAX_STORED_TURNS + 5; i += 1) s = run(s, { type: "ask", question: `Q${i}?` });
    expect(s.turns).toHaveLength(MAX_STORED_TURNS);
    expect(s.turns[0].question).toBe("Q5?");
    expect(s.revision).toBe(MAX_STORED_TURNS + 5);
  });
});

describe("clarifications in the one composer (H04-T04)", () => {
  const ask = run(emptyConversation(subject), { type: "ask", question: "What if we charged $25?" });
  const clarify: ConversationAction = { type: "clarify", turnId: "t1", question: { fieldKey: "fee.overdraft.annual_items", prompt: "How many overdraft items a year?", inputKind: "number" } };

  it("switches the composer to a labeled answer mode and back", () => {
    expect(composerMode(ask, true)).toEqual({ kind: "question", label: "Ask a follow-up" });
    const s = run(ask, clarify);
    expect(composerMode(s, true)).toMatchObject({
      kind: "clarification",
      label: "Answer Hamilton's question: How many overdraft items a year?",
      inputMode: "numeric",
      fieldKey: "fee.overdraft.annual_items",
    });
    expect(composerMode(run(s, { type: "cancelClarification" }), true).kind).toBe("question");
    expect(run(s, { type: "ask", question: "Something else?" }).clarification).toBeNull();
    expect(run(s, { type: "clarify", turnId: "t1", question: null }).clarification).toBeNull();
  });

  it("carries the reply Hamilton could not read", () => {
    const s = run(ask, { ...clarify, invalidValue: "lots" } as ConversationAction);
    expect(composerMode(s, true)).toMatchObject({ invalidValue: "lots" });
  });

  it("ignores choice and file questions, which are not typed in the composer", () => {
    expect(run(ask, { type: "clarify", turnId: "t1", question: { fieldKey: "x.upload", prompt: "Upload?", inputKind: "file" } }).clarification).toBeNull();
  });

  it("validates a reply with the server's reading rules", () => {
    expect(clarificationInputError("number", "")).toBe("Type an answer, or choose Ask something else instead.");
    expect(clarificationInputError("number", "lots")).toBe("Enter a number, for example 12,000.");
    expect(clarificationInputError("number", "-3")).toBe("Enter a number, for example 12,000.");
    expect(clarificationInputError("number", "12,000")).toBeNull();
    expect(clarificationInputError("number", "$30")).toBeNull();
    expect(clarificationInputError("percent", "8%")).toBeNull();
    expect(clarificationInputError("percent", "0.08")).toBeNull();
    expect(clarificationInputError("percent", "140%")).toBe("A percentage can be at most 100%.");
    expect(clarificationInputError("text", "$25 and $30")).toBeNull();
    expect(clarificationInputError("text", "x".repeat(201))).toBe("Keep the answer to 200 characters or fewer.");
  });
});

describe("carried context (H04-T05)", () => {
  it("continues a decision only for a question about the same fee or no fee", () => {
    const s = run(emptyConversation(subject), { type: "decision", value: { decisionId: "d1", feeCategory: "overdraft" } });
    expect(decisionForQuestion(s, null)).toBe("d1");
    expect(decisionForQuestion(s, "overdraft")).toBe("d1");
    expect(decisionForQuestion(s, "nsf")).toBeNull();
    expect(decisionForQuestion(emptyConversation(subject), null)).toBeNull();
  });
});

describe("reset and subject change (H04-T06)", () => {
  const busy = run(
    emptyConversation(subject),
    { type: "ask", question: "List ten similar credit unions" },
    { type: "peerSet", value: peers },
    { type: "decision", value: { decisionId: "d1", feeCategory: "overdraft" } },
    { type: "stored", conversationId: "8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1" },
  );

  it("a new conversation carries no turns, peers, decision, clarification or stored ID", () => {
    const fresh = resetConversation(run(busy, { type: "clarify", turnId: "t1", question: { fieldKey: "f.x.annual_items", prompt: "How many?", inputKind: "number" } }));
    expect(fresh).toMatchObject({ conversationId: null, turns: [], peerSet: null, decision: null, clarification: null, nonce: 0, subject });
  });

  it("a different institution starts a fresh conversation that names the earlier subject", () => {
    const other = switchSubject(busy, { institutionId: "303", institutionName: "Synthetic Bank" });
    expect(other).toMatchObject({ turns: [], peerSet: null, decision: null, conversationId: null, previousSubject: subject });
    expect(switchSubject(busy, subject)).toBe(busy);
  });
});

describe("stored snapshots", () => {
  const stored = run(
    emptyConversation(subject),
    { type: "ask", question: "List ten similar credit unions" },
    { type: "peerSet", value: peers },
    { type: "answered", turnId: "t1", route: "peer_list", lead: "10 of 10 matching institutions." },
    { type: "ask", question: "Only Florida", previousLead: "10 of 10 matching institutions." },
    { type: "answered", turnId: "t2", route: "peer_list" },
    { type: "ask", question: "How does our overdraft fee compare?" },
    { type: "decision", value: { decisionId: "d1", feeCategory: "overdraft" } },
    { type: "answered", turnId: "t3", route: "structured", savedAnalysisId: "11111111-1111-1111-1111-111111111111" },
  );

  it("round-trips through JSON, without a pending clarification", () => {
    const withQuestion = run(stored, { type: "clarify", turnId: turnId(stored), question: { fieldKey: "f.x.annual_items", prompt: "How many?", inputKind: "number" } });
    const back = parseConversationState(JSON.parse(JSON.stringify(serializeConversationState(withQuestion))));
    expect(back).toEqual({ ...withQuestion, clarification: null });
  });

  it("rejects malformed snapshots rather than guessing", () => {
    const good = JSON.parse(JSON.stringify(stored));
    expect(parseConversationState(null)).toBeNull();
    expect(parseConversationState({ ...good, version: 2 })).toBeNull();
    expect(parseConversationState({ ...good, subject: { institutionId: "DROP TABLE", institutionName: null } })).toBeNull();
    expect(parseConversationState({ ...good, turns: [{ ...good.turns[0], status: "hacked" }] })).toBeNull();
    expect(parseConversationState({ ...good, turns: Array.from({ length: MAX_STORED_TURNS + 1 }, () => good.turns[0]) })).toBeNull();
    expect(parseConversationState({ ...good, peerSet: { ...good.peerSet, snapshot: { ...good.peerSet.snapshot, selectedIds: [999] } } })).toBeNull();
  });

  it("never carries a peer list from another institution", () => {
    const foreign = JSON.parse(JSON.stringify(stored));
    foreign.peerSet.snapshot.originInstitutionId = "999";
    expect(parseConversationState(foreign)?.peerSet).toBeNull();
  });

  it("returns the state as it stood when a saved answer was filed, as a new conversation", () => {
    const later = run(stored, { type: "stored", conversationId: "8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1" }, { type: "ask", question: "And NSF?" });
    const at = stateAtSavedAnswer(later, "11111111-1111-1111-1111-111111111111")!;
    expect(at.conversationId).toBeNull();
    expect(at.turns.map((t) => t.question)).toEqual(["List ten similar credit unions", "Only Florida", "How does our overdraft fee compare?"]);
    expect(at.nonce).toBe(3);
    expect(at.peerSet).toEqual(peers);
    expect(stateAtSavedAnswer(later, "missing")).toBeNull();
  });
});
