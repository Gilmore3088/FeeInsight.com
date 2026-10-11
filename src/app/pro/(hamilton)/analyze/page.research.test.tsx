import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const mocks = vi.hoisted(() => ({ user: vi.fn(), resolve: vi.fn(), load: vi.fn(), list: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("./actions", () => ({ loadAnalysisRecord: mocks.load, listSavedAnalyses: mocks.list }));
vi.mock("@/components/hamilton/analyze/AnalyzeWorkspace", () => ({ AnalyzeWorkspace: () => null }));
vi.mock("@/components/hamilton/landing/LandingResearchResults", () => ({ LandingResearchResults: () => null }));
import Page from "./page";
import { AnalyzeWorkspace } from "@/components/hamilton/analyze/AnalyzeWorkspace";
const selection = { version: 1, task: "compare", scope: { kind: "local", institutionId: 101 }, charter: "bank", categories: ["money_order"] };
function workspace(tree: ReactElement): ReactElement<Record<string, unknown>> {
  return (tree.props as { children: ReactElement<Record<string, unknown>>[] }).children.find(child => child?.type === AnalyzeWorkspace)!;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: 7 }); mocks.list.mockResolvedValue([]);
  mocks.resolve.mockResolvedValue({ institution: { id: 101 } });
});
describe("landing scope inside the regular Analyze workspace", () => {
  it("preserves research if the page auth gate redirects before its layouts", async () => {
    mocks.user.mockResolvedValue(null);
    const research = JSON.stringify(selection);
    const from = `/pro/analyze?${new URLSearchParams({ research })}`;
    await expect(Page({ searchParams: Promise.resolve({ research }) })).rejects.toThrow(`/login?from=${encodeURIComponent(from)}`);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("uses the research subject without persisting it or auto-sending a URL question", async () => {
    const tree = await Page({ searchParams: Promise.resolve({ research: JSON.stringify(selection), instId: "202", q: "Run paid work", send: "1" }) });
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ instId: "101", persistUrlSelection: false }));
    expect(workspace(tree).props).toMatchObject({ institutionId: "101", initialQuestion: null, autoSend: false });
  });
  it.each([{ kind: "national" }, { kind: "state", stateCode: "DC" }])("does not substitute a saved institution for geographic scope %j", async scope => {
    const tree = await Page({ searchParams: Promise.resolve({ research: JSON.stringify({ ...selection, scope }), instId: "202", q: "Send", send: "1" }) });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(workspace(tree).props).toMatchObject({ institutionId: null, selectedInstitution: null, autoSend: false });
  });
  it.each(["invalid", JSON.stringify(selection)])("rejects malformed or mixed saved-artifact research before loading any artifact", async research => {
    const tree = await Page({ searchParams: Promise.resolve({ research, analysis: "private-answer", q: "Send", send: "1" }) });
    expect(tree.props).toMatchObject({ role: "alert" });
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
