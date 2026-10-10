import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), load: vi.fn(), recent: vi.fn(), resolve: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("./actions", () => ({ loadAnalysisRecord: mocks.load, listSavedAnalyses: mocks.recent }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/components/hamilton/analyze/AnalyzeWorkspace", () => ({ AnalyzeWorkspace: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); },
}));
import AnalyzePage from "./page";

const subject = { id: 2945, name: "Synthetic Research Bank" };
const stored = { id: "saved-a", institutionId: "2945", responseJson: { title: "Saved A" }, prompt: "Original question" };

describe("AnalyzePage saved subject", () => {
  beforeEach(() => {
    mocks.user.mockReset().mockResolvedValue({ id: 7 });
    mocks.load.mockReset().mockResolvedValue(stored);
    mocks.recent.mockReset().mockResolvedValue([]);
    mocks.resolve.mockReset().mockResolvedValue({ institution: subject, error: null, workspaceInstitutionId: 8109 });
  });

  it("uses the saved subject despite a conflicting URL and disables auto-send on saved views", async () => {
    const page = await AnalyzePage({ searchParams: Promise.resolve({ analysis: "saved-a", instId: "8109", q: "new question", send: "1", intent: "risk" }) });
    expect(mocks.load).toHaveBeenCalledWith("saved-a");
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: 7, instId: "2945", intent: "analyze", persistUrlSelection: false, transientSource: "artifact" });
    expect(page.props.institutionId).toBe("2945");
    expect(page.props.initialAnalysis).toEqual(stored.responseJson);
    expect(page.props.initialQuestion).toBeNull();
    expect(page.props.initialIntent).toBeNull();
    expect(page.props.autoSend).toBe(false);
    expect(page.props.readOnlyReason).toBeNull();
  });

  it("does not resolve today's workspace for a saved answer with no institution", async () => {
    mocks.load.mockResolvedValue({ ...stored, institutionId: null });
    const page = await AnalyzePage({ searchParams: Promise.resolve({ analysis: "saved-a", instId: "8109" }) });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(page.props.institutionId).toBeNull();
    expect(page.props.selectedInstitution).toBeNull();
    expect(page.props.initialAnalysis).toEqual(stored.responseJson);
    expect(page.props.readOnlyReason).toContain("No institution was recorded");
  });

  it("does not treat a legacy name slug as a recorded canonical institution", async () => {
    mocks.load.mockResolvedValue({ ...stored, institutionId: "research-bank" });
    const page = await AnalyzePage({ searchParams: Promise.resolve({ analysis: "saved-a", instId: "8109" }) });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(page.props.institutionId).toBeNull();
    expect(page.props.readOnlyReason).toContain("No institution was recorded");
  });

  it("does not silently replace an inaccessible saved answer with a new query", async () => {
    mocks.load.mockResolvedValue(null);
    await expect(AnalyzePage({ searchParams: Promise.resolve({ analysis: "not-owned", instId: "8109", q: "peers", send: "1" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.recent).not.toHaveBeenCalled();
  });

  it("keeps an unavailable recorded subject read-only rather than falling back", async () => {
    mocks.resolve.mockResolvedValue({ institution: null, error: "Unavailable" });
    const page = await AnalyzePage({ searchParams: Promise.resolve({ analysis: "saved-a", instId: "8109" }) });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(page.props.institutionId).toBeNull();
    expect(page.props.initialAnalysis).toEqual(stored.responseJson);
    expect(page.props.readOnlyReason).toContain("could not be loaded");
  });

  it("retains explicit URL context and question handoff for new research", async () => {
    const page = await AnalyzePage({ searchParams: Promise.resolve({ instId: "2945", q: "peers", send: "1", intent: "peer" }) });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: 7, instId: "2945", intent: "peer", persistUrlSelection: false, transientSource: undefined });
    expect(page.props.initialQuestion).toBe("peers");
    expect(page.props.autoSend).toBe(true);
    expect(page.props.initialAnalysis).toBeNull();
  });

  it("requires sign-in before reading saved content or institution context", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(AnalyzePage({ searchParams: Promise.resolve({ analysis: "saved-a" }) })).rejects.toThrow("REDIRECT:/login?from=");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("does not substitute a different saved workspace preference for the recorded subject", async () => {
    const page = await AnalyzePage({ searchParams: Promise.resolve({ analysis: "saved-a" }) });
    expect(page.props.institutionId).toBe("2945");
    expect(page.props.selectedInstitution).toEqual(subject);
  });

  it("treats a whitespace-only analysis parameter as a new workspace visit", async () => {
    await AnalyzePage({ searchParams: Promise.resolve({ analysis: " ", instId: "2945" }) });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.recent).toHaveBeenCalledWith(6);
  });

  it("blocks a failed explicit subject lookup rather than allowing a default-scoped Ask", async () => {
    mocks.resolve.mockResolvedValue({ institution: null, error: "Invalid institution ID" });
    const page = await AnalyzePage({ searchParams: Promise.resolve({ instId: "wrong", q: "peers", send: "1" }) });
    expect(page.props.readOnlyReason).toBe("Invalid institution ID");
    expect(page.props.institutionId).toBeNull();
  });
});
