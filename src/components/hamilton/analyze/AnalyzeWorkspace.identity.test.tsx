// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";

type Finished = { message: { parts: Array<{ type: string; text: string }> }; isError: boolean; isAbort: boolean };
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
vi.mock("./StructuredAsk", () => ({ StructuredAsk: () => null, DownloadAnswerPdf: () => <button>Download PDF</button> }));
vi.mock("@/components/hamilton/basket/AddToReportButton", () => ({ AddToReportButton: () => <button>Add to report</button> }));
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

  it("uses subject-neutral starter prompts instead of claiming every institution is ours", () => {
    render(<AnalyzeWorkspace userId={7} institutionId="8109" selectedInstitution={bankB} />);
    expect(document.body.textContent).not.toContain("our overdraft");
    expect(document.body.textContent).toContain("this institution's overdraft");
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
