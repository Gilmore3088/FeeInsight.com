import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationReducer, emptyConversation, type HamiltonConversationState } from "@/lib/hamilton/conversation-state";

// #979 H04-T06/T09: ?conversation= reopens only the signed-in user's stored conversation, under
// its own institution; a switch named in the address starts a fresh, visibly separate one.
const mocks = vi.hoisted(() => ({
  user: vi.fn(), load: vi.fn(), recent: vi.fn(), resolve: vi.fn(), state: vi.fn(), forSaved: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("./actions", () => ({ loadAnalysisRecord: mocks.load, listSavedAnalyses: mocks.recent }));
vi.mock("./conversation-actions", () => ({ startAnalyzeConversationAction: vi.fn(), recordAnalyzeConversationAction: vi.fn() }));
vi.mock("@/lib/hamilton/chat-memory", () => ({ loadConversationState: mocks.state, loadConversationStateForSavedAnswer: mocks.forSaved }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/components/hamilton/analyze/AnalyzeWorkspace", () => ({ AnalyzeWorkspace: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); },
}));
import AnalyzePage from "./page";

const ID = "8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1";
const SAVED = "11111111-1111-4111-8111-111111111111";
const institutions: Record<string, { id: number; name: string }> = { "101": { id: 101, name: "Synthetic CU" }, "303": { id: 303, name: "Synthetic Bank" } };

function conversation(savedAnalysisId: string | null = null): HamiltonConversationState {
  const asked = conversationReducer(emptyConversation({ institutionId: "101", institutionName: "Synthetic CU" }), { type: "ask", question: "List ten peers" });
  return { ...conversationReducer(asked, { type: "answered", turnId: "t1", route: "peer_list", savedAnalysisId }), conversationId: ID };
}

beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: 7 });
  mocks.load.mockReset().mockResolvedValue(null);
  mocks.recent.mockReset().mockResolvedValue([]);
  mocks.state.mockReset().mockResolvedValue(conversation());
  mocks.forSaved.mockReset().mockResolvedValue(null);
  // With no instId the workspace preference is Synthetic CU unless a test says otherwise.
  mocks.resolve.mockReset().mockImplementation(async ({ instId }: { instId?: string }) => ({ institution: institutions[instId ?? "101"] ?? null, error: null }));
});

describe("AnalyzePage ?conversation=", () => {
  it("reopens the user's conversation under its own subject", async () => {
    const page = await AnalyzePage({ searchParams: Promise.resolve({ conversation: ID }) });
    expect(mocks.state).toHaveBeenCalledWith(ID, 7);
    expect(page.props.institutionId).toBe("101");
    expect(page.props.initialConversation.conversationId).toBe(ID);
    expect(page.props.initialConversation.turns[0].question).toBe("List ten peers");
    expect(page.props.subjectNotice).toBeNull();
    expect(page.props.startConversationAction).toBeTypeOf("function");
  });

  it("loads nothing for a conversation that is not the user's", async () => {
    mocks.state.mockResolvedValue(null);
    const page = await AnalyzePage({ searchParams: Promise.resolve({ conversation: ID }) });
    expect(page.props.initialConversation).toBeNull();
  });

  it("ignores a malformed conversation ID without a lookup", async () => {
    const page = await AnalyzePage({ searchParams: Promise.resolve({ conversation: "x' OR 1=1" }) });
    expect(mocks.state).not.toHaveBeenCalled();
    expect(page.props.initialConversation).toBeNull();
  });

  it("shows the last saved answer of a reloaded conversation", async () => {
    mocks.state.mockResolvedValue(conversation(SAVED));
    mocks.load.mockResolvedValue({ id: SAVED, institutionId: "101", responseJson: { title: "Saved" }, prompt: "List ten peers" });
    const page = await AnalyzePage({ searchParams: Promise.resolve({ conversation: ID }) });
    expect(mocks.load).toHaveBeenCalledWith(SAVED);
    expect(page.props.initialAnalysisId).toBe(SAVED);
    expect(page.props.initialConversation.conversationId).toBe(ID);
  });

  it("says so when today's workspace institution differs; follow-ups stay about the conversation's subject", async () => {
    mocks.resolve.mockImplementation(async ({ instId }: { instId?: string }) => ({ institution: institutions[instId ?? "303"], error: null }));
    const page = await AnalyzePage({ searchParams: Promise.resolve({ conversation: ID }) });
    expect(page.props.institutionId).toBe("101");
    expect(page.props.subjectNotice.text).toBe("This conversation is about Synthetic CU. Your workspace is now set to Synthetic Bank; follow-ups here stay about Synthetic CU.");
    expect(page.props.subjectNotice.href).toBe("/pro/analyze?instId=303");
  });

  it("starts a fresh, visibly separate conversation when the address names another institution", async () => {
    const page = await AnalyzePage({ searchParams: Promise.resolve({ conversation: ID, instId: "303", q: "What is the wire fee?", send: "1" }) });
    expect(page.props.institutionId).toBe("303");
    expect(page.props.initialConversation).toMatchObject({ conversationId: null, turns: [], peerSet: null, previousSubject: { institutionId: "101" } });
    expect(page.props.subjectNotice.text).toContain("The earlier conversation was about Synthetic CU.");
    expect(page.props.subjectNotice.href).toBe(`/pro/analyze?conversation=${ID}`);
    expect(page.props.initialQuestion).toBe("What is the wire fee?");
  });

  it("drops a stored conversation whose institution is no longer available", async () => {
    mocks.resolve.mockResolvedValue({ institution: null, error: "Unavailable" });
    const page = await AnalyzePage({ searchParams: Promise.resolve({ conversation: ID }) });
    expect(page.props.initialConversation).toBeNull();
    expect(page.props.subjectNotice.text).toContain("could not be loaded");
  });

  it("seeds a follow-up from a market brief with the brief's question as its earlier turn", async () => {
    mocks.state.mockResolvedValue(null);
    const page = await AnalyzePage({ searchParams: Promise.resolve({ instId: "101", q: "And credit unions only?", send: "1", from_brief: "Florida: fee pricing" }) });
    expect(page.props.initialConversation.turns).toEqual([expect.objectContaining({ question: "Florida: fee pricing", route: "market_brief", status: "answered" })]);
    expect(page.props.autoSend).toBe(true);
  });

  it("reopens a saved answer with the conversation state it was filed with", async () => {
    mocks.load.mockResolvedValue({ id: SAVED, institutionId: "101", responseJson: { title: "Saved" }, prompt: "List ten peers" });
    mocks.forSaved.mockResolvedValue({ ...conversation(SAVED), conversationId: null });
    const page = await AnalyzePage({ searchParams: Promise.resolve({ analysis: SAVED }) });
    expect(mocks.forSaved).toHaveBeenCalledWith(SAVED, 7);
    expect(page.props.initialConversation.turns[0].savedAnalysisId).toBe(SAVED);
    expect(page.props.initialConversation.conversationId).toBeNull();
  });
});
