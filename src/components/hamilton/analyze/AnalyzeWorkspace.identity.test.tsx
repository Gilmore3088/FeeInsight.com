// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { ReportBasketItem } from "@/lib/hamilton/report-basket";
import { sanitizeBasketItems } from "@/lib/hamilton/report-basket";

type Finished = { message: { parts: Array<{ type: string; text: string }> }; isError: boolean; isAbort: boolean };
const chat = vi.hoisted(() => ({
  options: [] as Array<{ onFinish?: (event: Finished) => Promise<void> }>,
  send: vi.fn(), setMessages: vi.fn(), clearError: vi.fn(), stop: vi.fn(), save: vi.fn(), addItem: vi.fn(),
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { onFinish?: (event: Finished) => Promise<void> }) => {
    chat.options.push(options);
    return { messages: [], status: "ready", sendMessage: chat.send, setMessages: chat.setMessages, clearError: chat.clearError, stop: chat.stop, error: undefined };
  },
}));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ saveAnalysis: chat.save }));
vi.mock("./StructuredAsk", async (importOriginal) => ({
  ...await importOriginal<typeof import("./StructuredAsk")>(),
  DownloadAnswerPdf: () => <button>Download PDF</button>,
}));
vi.mock("@/components/hamilton/basket/AddToReportButton", () => ({ AddToReportButton: ({ item }: { item: Omit<ReportBasketItem, "addedAt"> }) => <button onClick={() => chat.addItem(item)}>Add to report</button> }));
import { AnalyzeWorkspace, answerAuditTrail } from "./AnalyzeWorkspace";

function answer(text: string): AnalyzeResponse {
  return { title: text, confidence: { level: "medium", basis: ["Synthetic fixture"] }, hamiltonView: text, whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] };
}
const bankA = { id: 2945, name: "Synthetic Bank A" } as HamiltonSelectedInstitutionContext;
const bankB = { id: 8109, name: "Synthetic Bank B" } as HamiltonSelectedInstitutionContext;
const finished: Finished = { message: { parts: [{ type: "text", text: "## Hamilton's View\nLate old answer." }] }, isError: false, isAbort: false };

beforeEach(() => {
  chat.options.length = 0;
  chat.send.mockReset(); chat.setMessages.mockReset(); chat.clearError.mockReset(); chat.stop.mockReset();
  chat.save.mockReset().mockResolvedValue({ id: "new-answer" });
  chat.addItem.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AnalyzeWorkspace identity boundaries", () => {
  it("drops a saved answer when navigating to a different research institution", () => {
    const view = render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} initialAnalysisId="saved-a" initialAnalysis={answer("Original A answer.")} />);
    expect(document.body.textContent).toContain("Original A answer.");
    view.rerender(<AnalyzeWorkspace userId={7} institutionId="8109" selectedInstitution={bankB} />);
    expect(document.body.textContent).not.toContain("Original A answer.");
    expect(document.body.textContent).toContain("Synthetic Bank B");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("loads a different saved answer even when both concern the same institution", () => {
    const view = render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} initialAnalysisId="saved-a" initialAnalysis={answer("First saved answer.")} />);
    view.rerender(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} initialAnalysisId="saved-b" initialAnalysis={answer("Second saved answer.")} />);
    expect(document.body.textContent).toContain("Second saved answer.");
    expect(document.body.textContent).not.toContain("First saved answer.");
  });

  it("does not retain another signed-in user's local answer state", () => {
    const view = render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} initialAnalysis={answer("Previous user answer.")} />);
    view.rerender(<AnalyzeWorkspace userId={8} institutionId="2945" selectedInstitution={bankA} />);
    expect(document.body.textContent).not.toContain("Previous user answer.");
  });

  it("preserves a draft across ordinary rerenders of the same context", () => {
    const view = render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep this draft" } });
    view.rerender(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={{ ...bankA }} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep this draft");
  });

  it("keeps legacy content readable without enabling mis-scoped questions or exports", async () => {
    render(<AnalyzeWorkspace userId={7} institutionId={null} initialAnalysisId="legacy" initialAnalysis={answer("Unscoped historical answer.")} readOnlyReason="No institution was recorded." />);
    expect(document.body.textContent).toContain("Unscoped historical answer.");
    expect(document.body.textContent).toContain("No institution was recorded.");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to report" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Try a price" })).toBeNull();
    expect(screen.getByRole("link", { name: "Start a new question" }).getAttribute("href")).toBe("/pro/analyze");
    await act(async () => { await chat.options.at(-1)?.onFinish?.(finished); });
    expect(chat.save).not.toHaveBeenCalled();
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("ignores a late completion belonging to the unmounted prior subject", async () => {
    const view = render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} />);
    const old = chat.options.at(-1);
    view.rerender(<AnalyzeWorkspace userId={7} institutionId="8109" selectedInstitution={bankB} />);
    await act(async () => { await old?.onFinish?.(finished); });
    expect(chat.save).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Late old answer.");
    expect(document.body.textContent).toContain("Synthetic Bank B");
    expect(chat.stop).toHaveBeenCalled();
  });

  it("exports the newly opened saved answer ID rather than the previous one", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetcher);
    const view = render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} initialAnalysisId="saved-a" initialAnalysis={answer("First saved answer.")} />);
    view.rerender(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} initialAnalysisId="saved-b" initialAnalysis={answer("Second saved answer.")} />);
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0][0]).toBe("/api/pro/report-pdf");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ type: "analysis", analysisId: "saved-b" });
  });

  it("reopens saved A with its original account and cohort after a visit to B, then sends A to reports", () => {
    const identityContext = { version: 1 as const, researchInstitutionId: 2945, accountInstitutionId: 101, accountStatus: "identified" as const, researchInstitutionName: "Original Research A", accountInstitutionName: "Original Account CU", peerSetId: 42, peerBaselineLabel: "Original A cohort" };
    const savedId = "11111111-2222-3333-4444-555555555555";
    const savedAnswer = { ...answer("Original A answer."), identityContext };
    const view = render(<AnalyzeWorkspace userId={7} institutionId="8109" selectedInstitution={bankB} />);
    expect(document.body.textContent).toContain("Synthetic Bank B");
    view.rerender(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={{ ...bankA, name: "Today's A name" }} initialAnalysisId={savedId} initialAnalysis={savedAnswer} />);
    const context = screen.getByLabelText("Saved answer institution context");
    expect(context.textContent).toContain("Research institution: Original Research A");
    expect(context.textContent).toContain("Account institution: Original Account CU");
    expect(context.textContent).toContain("Peer baseline: Original A cohort");
    expect(context.textContent).not.toContain("Synthetic Bank B");
    expect(context.textContent).not.toContain("Today's A name");
    fireEvent.click(screen.getByRole("button", { name: "Add to report" }));
    const item = chat.addItem.mock.calls[0][0];
    expect(item.savedAnalysisId).toBe(savedId);
    expect(item.identityContext).toEqual(identityContext);
    expect(sanitizeBasketItems([item])[0].institutionId).toBe("2945");
    expect(sanitizeBasketItems([item])[0].identityContext).toEqual(identityContext);
    view.rerender(<AnalyzeWorkspace userId={7} institutionId="8109" selectedInstitution={bankB} />);
    expect(screen.queryByLabelText("Saved answer institution context")).toBeNull();
    expect(document.body.textContent).not.toContain("Original Account CU");
    expect(document.body.textContent).not.toContain("Original A cohort");
    expect(screen.queryByRole("button", { name: "Add to report" })).toBeNull();
  });

  it("uses subject-neutral starter prompts instead of claiming every institution is ours", () => {
    render(<AnalyzeWorkspace userId={7} institutionId="8109" selectedInstitution={bankB} />);
    expect(document.body.textContent).not.toContain("our overdraft");
    expect(document.body.textContent).toContain("this institution's overdraft");
  });

  it("starts a fresh ask after New question abandons an unresolved engine request", async () => {
    const pending: Array<{ question: string; finish: (response: Response) => void }> = [];
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((finish) => {
      pending.push({ question: JSON.parse(String(init.body)).question, finish });
    })));
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Compare overdraft" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(pending).toHaveLength(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "New question" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Compare NSF" } });
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(pending.map(request => request.question)).toEqual(["Compare overdraft", "Compare NSF"]));

    const response = (text: string) => new Response(JSON.stringify({
      kind: "research", shortAnswer: `${text} lead`, pageChange: { screen: "none" },
      facts: [{ text, source: { label: "Synthetic acceptance fixture" } }],
    }));
    await act(async () => { pending[0].finish(response("Discarded old evidence")); });
    expect(document.body.textContent).not.toContain("Discarded old evidence");
    expect(chat.send).not.toHaveBeenCalled();
    await act(async () => { pending[1].finish(response("New question evidence")); });
    await screen.findByText("New question evidence");
    expect(document.body.textContent).not.toContain("Discarded old evidence");
    expect(chat.save).not.toHaveBeenCalled();
  });
});

describe("Ask audit identity", () => {
  it("identifies a research subject without claiming account ownership", () => {
    const trail = answerAuditTrail({ lookups: [], figureCheck: null, institutionName: "Synthetic Bank B", preparedAt: "2026-10-10T00:00:00Z" });
    expect(trail.sources.some(s => s.label === "Your institution")).toBe(false);
    expect(trail.sources.find(s => s.label === "Research subject")?.detail).toContain("Synthetic Bank B");
  });
  it("does not invent an institution when its identity is unknown", () => {
    const trail = answerAuditTrail({ lookups: [], figureCheck: null, institutionName: null, preparedAt: "2026-10-10T00:00:00Z" });
    expect(trail.sources.some(s => s.label === "Research subject" || s.label === "Your institution")).toBe(false);
  });
});

vi.mock("@/components/hamilton/storyline/StorylineView", () => ({
  StorylineView: ({ identityContext, memo, nextSteps }: { identityContext?: unknown; memo?: unknown; nextSteps?: import("react").ReactNode }) => <section data-testid="reopened-story"><p>{identityContext ? "Has original identity" : "Saved story persists without original identity"}</p>{memo ? <p data-testid="saved-memo">Original saved memo</p> : null}{nextSteps}</section>,
}));

describe("AnalyzeWorkspace saved-answer reset", () => {
  it("removes the saved storyline, memo, exports and historical notice when starting a new question", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    const identityContext = { version: 1 as const, researchInstitutionId: 2945, accountInstitutionId: 101, accountStatus: "identified" as const, researchInstitutionName: "Original Research A", accountInstitutionName: "Original Account CU", peerSetId: 42, peerBaselineLabel: "Original A cohort" };
    const savedAnswer = { ...answer("Saved storyline answer."), identityContext, storyline: {} as NonNullable<AnalyzeResponse["storyline"]>, memo: {} as NonNullable<AnalyzeResponse["memo"]> };
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} initialAnalysisId="saved-a" initialAnalysis={savedAnswer} />);
    expect(screen.getByTestId("reopened-story").textContent).toContain("Has original identity");
    expect(screen.getByTestId("saved-memo")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Download PDF" }).length).toBeGreaterThan(0);
    const initialContext = screen.getByLabelText("Saved answer institution context");
    expect(initialContext.textContent).toContain("Research institution: Original Research A");
    expect(initialContext.textContent).toContain("Account institution: Original Account CU");
    expect(initialContext.textContent).toContain("Peer baseline: Original A cohort");
    fireEvent.click(screen.getByRole("button", { name: "New question" }));
    expect(screen.queryByTestId("reopened-story")).toBeNull();
    expect(screen.queryByTestId("saved-memo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(screen.queryByLabelText("Saved answer institution context")).toBeNull();
    expect(screen.queryByText("Historical account and peer context was not recorded with this answer.")).toBeNull();
  });
  it("removes the historical context notice when discarding a legacy saved answer", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} initialAnalysisId="saved-legacy" initialAnalysis={answer("Historical saved answer.")} />);
    expect(screen.getByText("Historical account and peer context was not recorded with this answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New question" }));
    expect(screen.queryByText("Historical account and peer context was not recorded with this answer.")).toBeNull();
    expect(document.body.textContent).not.toContain("Historical saved answer.");
  });
});

describe("AnalyzeWorkspace delayed fallback save", () => {
  it.each([
    { outcome: "success", oldResult: { id: "old-answer-id" } },
    { outcome: "failure", oldResult: { error: "Old save failure" } },
  ])("ignores old save $outcome after a new conversation has its own saved answer", async ({ oldResult }) => {
    let finishOldSave!: (result: { id: string } | { error: string }) => void;
    chat.save.mockImplementationOnce(() => new Promise<{ id: string } | { error: string }>((finish) => { finishOldSave = finish; }));
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("scrollTo", vi.fn());
    render(<AnalyzeWorkspace userId={7} institutionId="2945" selectedInstitution={bankA} />);
    let oldCompletion!: Promise<void>;
    await act(async () => { oldCompletion = chat.options.at(-1)!.onFinish!(finished); });
    expect(chat.save).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Late old answer.");
    fireEvent.click(screen.getByRole("button", { name: "New question" }));
    const current = {
      message: { parts: [{ type: "text", text: "## Hamilton's View\nCurrent new answer." }], metadata: { savedAnalysisId: "current-answer-id" } },
      isError: false, isAbort: false,
    };
    await act(async () => { await chat.options.at(-1)!.onFinish!(current); });
    expect(document.body.textContent).toContain("Current new answer.");
    await act(async () => { finishOldSave(oldResult); await oldCompletion; });
    expect(document.body.textContent).not.toContain("This answer couldn't be saved to your history.");
    expect(document.body.textContent).not.toContain("Late old answer.");
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ type: "analysis", analysisId: "current-answer-id" });
  });
});
