import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeResponse, ReportSummaryResponse } from "@/lib/hamilton/types";

const mocks = vi.hoisted(() => ({
  save: vi.fn<(input: unknown) => Promise<{ success: true; reportId: string } | { success: false; error: string }>>(),
  preview: vi.fn(async () => []), replace: vi.fn(),
}));
vi.mock("@/app/pro/(hamilton)/reports/board-actions", () => ({ saveBoardBrief: mocks.save, previewBoardBriefFindings: mocks.preview }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock("@/components/hamilton/basket/AddToReportButton", () => ({ useReportBasket: () => [] }));
vi.mock("./ReportOutput", () => ({ ReportOutput: ({ report }: { report: ReportSummaryResponse }) => <div data-testid="report-preview">{report.title}</div> }));
import { BoardBriefEditor } from "./BoardBriefEditor";

const A = "00000000-0000-4000-8000-000009701411";
const B = "00000000-0000-4000-8000-000009701412";
const ANALYSIS = "00000000-0000-4000-8000-000009701311";
const TITLE = "Lakeshore board brief A: reviewed";
const NOTE = "Reviewed for the synthetic November committee.";
const report: ReportSummaryResponse = {
  title: "Lakeshore board brief A", executiveSummary: ["Synthetic saved wire fee $35; peer value $30; difference $5."],
  snapshot: [{ label: "Saved wire fee", current: "$35", proposed: "$30" }], strategicRationale: "Frozen synthetic source evidence.",
  tradeoffs: [], recommendation: "Stored fixture; no current live-source claim.", implementationNotes: ["Frozen reporting date Jun 30, 2026."],
  exportControls: { pdfEnabled: true, shareEnabled: false },
  boardBrief: { sourceAnalysisId: ANALYSIS, teamNote: "Original synthetic committee note.", includeEvidence: true },
};
const otherReport: ReportSummaryResponse = { ...report, title: "Indian River board brief B", boardBrief: { ...report.boardBrief!, teamNote: "Unchanged B note." } };
const route = (id = A) => `/pro/reports?report_id=${id}`;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async (run: () => void) => { await act(async () => { run(); }); };
const mount = () => render(<BoardBriefEditor key={A} initialReport={report} reportId={A} />);
function edit() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: TITLE } });
  fireEvent.change(screen.getByLabelText(/^Team note/), { target: { value: NOTE } });
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save brief" }));
const download = () => fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
let createUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;
let click: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState(null, "", route());
  mocks.save.mockReset().mockResolvedValue({ success: true, reportId: A });
  mocks.replace.mockReset(); mocks.preview.mockClear();
  createUrl = vi.fn(() => "blob:synthetic-board-brief"); revokeUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revokeUrl });
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(() => {
  if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor); else Reflect.deleteProperty(URL, "createObjectURL");
  if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor); else Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("BoardBriefEditor save lifetime, prospective BBE-01–11", () => {
  it("opens an unchanged existing report without saving or downloading", () => {
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Saved. The PDF uses this version.");
    expect(screen.getByRole("button", { name: "Save brief" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
    expect(mocks.save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("publishes the exact existing report only after its affirmative acknowledgement", async () => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    mount(); edit(); save();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ reportId: A, edits: { title: TITLE, teamNote: NOTE, includeEvidence: true } });
    expect(screen.getByLabelText("Title")).toBeDisabled(); expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes."); expect(mocks.replace).not.toHaveBeenCalled();
    await settle(() => pending.resolve({ success: true, reportId: A }));
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(route());
    expect(screen.getByRole("status")).toHaveTextContent("Saved. The PDF uses this version.");
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  });
  it("retains edits and dirty state on a refused update without advertising success", async () => {
    mocks.save.mockResolvedValue({ success: false, error: "Synthetic update refused." });
    mount(); edit(); await settle(save);
    expect(screen.getByRole("alert")).toHaveTextContent("Synthetic update refused.");
    expect(screen.getByLabelText("Title")).toHaveValue(TITLE); expect(screen.getByLabelText(/^Team note/)).toHaveValue(NOTE);
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled(); expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("retries a rejected update with the same report ID and retained edits", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Synthetic rejection")); mount(); edit(); await settle(save);
    expect(screen.getByRole("alert")).toHaveTextContent("The brief could not be saved. Your edits remain here; retry.");
    await settle(save);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0]).toEqual({ reportId: A, edits: { title: TITLE, teamNote: NOTE, includeEvidence: true } });
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(route());
  });
  it("does not send two saves while one update is pending", async () => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    mount(); edit(); const button = screen.getByRole("button", { name: "Save brief" });
    act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(mocks.save).toHaveBeenCalledTimes(1); await settle(() => pending.resolve({ success: true, reportId: A }));
  });
  it("does not navigate after the saving editor truly unmounts", async () => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    const view = mount(); edit(); save(); view.unmount();
    await settle(() => pending.resolve({ success: true, reportId: A })); expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("keeps keyed report B when old report A finishes saving", async () => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    const view = mount(); edit(); save();
    window.history.replaceState(null, "", route(B));
    view.rerender(<BoardBriefEditor key={B} initialReport={otherReport} reportId={B} />);
    await settle(() => pending.resolve({ success: true, reportId: A }));
    expect(mocks.replace).not.toHaveBeenCalled(); expect(screen.getByLabelText("Title")).toHaveValue(otherReport.title);
    expect(screen.getByLabelText(/^Team note/)).toHaveValue("Unchanged B note.");
  });
  it.each([route(B), "/pro/analyze?instId=9701002"])("does not overwrite a committed live URL handoff to %s", async target => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    mount(); edit(); save(); window.history.replaceState(null, "", target);
    await settle(() => pending.resolve({ success: true, reportId: A }));
    expect(window.location.pathname + window.location.search).toBe(target); expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes.");
  });
  it("allows a same-report hash-only movement while acknowledgement is pending", async () => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    mount(); edit(); save(); window.history.replaceState(null, "", route() + "#evidence");
    await settle(() => pending.resolve({ success: true, reportId: A })); expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(route());
  });
  it("settles its controls when its own acknowledged save canonicalizes the current URL", async () => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    mocks.replace.mockImplementation((href: string) => window.history.replaceState(null, "", href));
    window.history.replaceState(null, "", route() + "&instId=9701001");
    mount(); edit(); save(); await settle(() => pending.resolve({ success: true, reportId: A }));
    expect(window.location.pathname + window.location.search).toBe(route());
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(route());
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saved. The PDF uses this version.");
  });
  it.each(["refused", "rejected"] as const)("does not publish a late %s error into keyed B", async outcome => {
    const pending = deferred<{ success: false; error: string }>(); mocks.save.mockReturnValue(pending.promise);
    const view = mount(); edit(); save(); window.history.replaceState(null, "", route(B));
    view.rerender(<BoardBriefEditor key={B} initialReport={otherReport} reportId={B} />);
    await settle(() => outcome === "refused" ? pending.resolve({ success: false, error: "Old A refusal" }) : pending.reject(new Error("Old A rejection")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(screen.getByLabelText("Title")).toHaveValue(otherReport.title);
  });
  it("preserves the new-from-analysis creation branch as an affirmative-ACK compatibility control", async () => {
    const analysis: AnalyzeResponse = { title: "Synthetic saved answer", confidence: { level: "medium", basis: ["Synthetic fixture."] }, hamiltonView: "Frozen source answer.", whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] };
    window.history.replaceState(null, "", `/pro/reports?from_analysis=${ANALYSIS}`);
    render(<BoardBriefEditor analysis={analysis} analysisId={ANALYSIS} />); await settle(save);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ analysisId: ANALYSIS, addedFindings: [], edits: { title: analysis.title, teamNote: "", includeEvidence: true } });
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(route());
  });
});

describe("BoardBriefEditor download lifetime, prospective BBE-12–17", () => {
  it("does not download dirty edits", () => { mount(); edit(); download(); expect(fetch).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled(); });
  it("downloads the exact saved ID normally and revokes its object URL", async () => {
    vi.useFakeTimers(); const response = new Response("%PDF-synthetic-handler-control", { status: 200 });
    vi.mocked(fetch).mockResolvedValue(response); mount(); await settle(download);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/pro/report-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "report", reportId: A }) });
    expect(createUrl).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1000); }); expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:synthetic-board-brief");
  });
  it("retains a current-view download failure and permits a real handler retry", async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockResolvedValueOnce(new Response("refused", { status: 500 })).mockResolvedValueOnce(new Response("%PDF-retry", { status: 200 }));
    mount(); await settle(download); expect(screen.getByRole("alert")).toHaveTextContent("The PDF could not be prepared. Retry the download.");
    expect(createUrl).not.toHaveBeenCalled(); await settle(download); expect(fetch).toHaveBeenCalledTimes(2); expect(click).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1000); });
  });
});

describe("BoardBriefEditor pre-invocation route ownership, prospective controls", () => {
  it.each([route(B), "/pro/analyze?instId=9701002"])("does not adopt a different live URL committed before Save: %s", async target => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    mount(); edit(); window.history.replaceState(null, "", target); save();
    // A server update may finish; only publication into the replacement view is forbidden.
    await settle(() => pending.resolve({ success: true, reportId: A }));
    expect(window.location.pathname + window.location.search).toBe(target);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes.");
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  });

  it("accepts the page's report alias and settles after its own canonical publication", async () => {
    window.history.replaceState(null, "", `/pro/reports?report=${A}`);
    mocks.replace.mockImplementation((href: string) => window.history.replaceState(null, "", href));
    mount(); edit(); await settle(save);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ reportId: A, edits: { title: TITLE, teamNote: NOTE, includeEvidence: true } });
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(route());
    expect(window.location.pathname + window.location.search).toBe(route());
    expect(screen.getByRole("status")).toHaveTextContent("Saved. The PDF uses this version.");
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  });

  it("allows a second same-ID update after its own canonical save", async () => {
    mocks.replace.mockImplementation((href: string) => window.history.replaceState(null, "", href));
    mount(); edit(); await settle(save);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Lakeshore board brief A: reviewed again" } });
    fireEvent.change(screen.getByLabelText(/^Team note/), { target: { value: "Second synthetic committee note." } });
    await settle(save);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][0]).toEqual({ reportId: A, edits: { title: "Lakeshore board brief A: reviewed again", teamNote: "Second synthetic committee note.", includeEvidence: true } });
    expect(mocks.replace.mock.calls).toEqual([[route()], [route()]]);
    expect(window.location.pathname + window.location.search).toBe(route());
    expect(screen.getByRole("status")).toHaveTextContent("Saved. The PDF uses this version.");
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  });

  it("keeps acknowledged creation editable before and after its own canonical URL commits", async () => {
    const analysis: AnalyzeResponse = { title: "Synthetic saved answer", confidence: { level: "medium", basis: ["Synthetic fixture."] }, hamiltonView: "Frozen source answer.", whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] };
    const fromAnalysis = `/pro/reports?from_analysis=${ANALYSIS}`;
    window.history.replaceState(null, "", fromAnalysis);
    render(<BoardBriefEditor analysis={analysis} analysisId={ANALYSIS} />); await settle(save);
    expect(mocks.save.mock.calls[0][0]).toEqual({ analysisId: ANALYSIS, addedFindings: [], edits: { title: analysis.title, teamNote: "", includeEvidence: true } });
    expect(window.location.pathname + window.location.search).toBe(fromAnalysis);
    fireEvent.change(screen.getByLabelText(/^Team note/), { target: { value: "Acknowledged creation, before canonical URL." } });
    await settle(save);
    expect(mocks.save.mock.calls[1][0]).toEqual({ reportId: A, edits: { title: analysis.title, teamNote: "Acknowledged creation, before canonical URL.", includeEvidence: true } });
    window.history.replaceState(null, "", route());
    fireEvent.change(screen.getByLabelText(/^Team note/), { target: { value: "Acknowledged creation, after canonical URL." } });
    await settle(save);
    expect(mocks.save).toHaveBeenCalledTimes(3);
    expect(mocks.save.mock.calls[2][0]).toEqual({ reportId: A, edits: { title: analysis.title, teamNote: "Acknowledged creation, after canonical URL.", includeEvidence: true } });
    expect(mocks.replace.mock.calls).toEqual([[route()], [route()], [route()]]);
    expect(screen.getByRole("status")).toHaveTextContent("Saved. The PDF uses this version.");
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  });
});

describe("BoardBriefEditor page-selector precedence, prospective controls", () => {
  it.each([route() + "&research=", route() + "&board_error=1"])("does not adopt an earlier page branch committed before Save: %s", async target => {
    const pending = deferred<{ success: true; reportId: string }>(); mocks.save.mockReturnValue(pending.promise);
    mount(); edit(); window.history.replaceState(null, "", target); save();
    await settle(() => pending.resolve({ success: true, reportId: A }));
    expect(window.location.pathname + window.location.search).toBe(target);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes.");
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  });

  it("accepts an empty board_error value because the page does not select its error branch", async () => {
    window.history.replaceState(null, "", route() + "&board_error=");
    mocks.replace.mockImplementation((href: string) => window.history.replaceState(null, "", href));
    mount(); edit(); await settle(save);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ reportId: A, edits: { title: TITLE, teamNote: NOTE, includeEvidence: true } });
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(route());
    expect(window.location.pathname + window.location.search).toBe(route());
    expect(screen.getByRole("status")).toHaveTextContent("Saved. The PDF uses this version.");
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  });
});
