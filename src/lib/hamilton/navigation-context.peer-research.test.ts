import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { encodeLandingResearch } from "./landing-research-handoff";
import { hamiltonNavigationSelection, hrefWithHamiltonNavigation, isHamiltonSubjectPath } from "./navigation-context";

const PATH = "/pro/peer-research/00000000-0000-4000-8000-000009701701";
const researchB = encodeLandingResearch({ version: 1, task: "compare", scope: { kind: "local", institutionId: 9701002 }, categories: ["nsf"], charter: "credit_union" });

const route = vi.hoisted(() => ({ pathname: "/pro/analyze", search: "instId=9701002", artifact: vi.fn(), institution: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/hamilton/navigation-institution-action", () => ({ loadHamiltonArtifactNavigationInstitution: route.artifact, loadHamiltonNavigationInstitution: route.institution }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams(route.search), useRouter: () => ({ push: route.push }) }));
vi.mock("@/app/pro/(hamilton)/view-as-actions", () => ({ setViewAsCustomer: vi.fn() }));
vi.mock("@/components/use-session-chrome", () => ({ SessionChromeProvider: ({ children }: { children: React.ReactNode }) => children, useSessionChrome: () => ({ signedIn: true, isPro: true, isStaff: false }) }));
vi.mock("@/components/public/search-modal", () => ({ SearchModal: () => null }));
vi.mock("@/components/hamilton/layout/HamiltonAskDock", () => ({ HamiltonAskDock: () => null }));
import { HamiltonShell } from "@/components/hamilton/layout/HamiltonShell";

const seed = { children: null, isAdmin: false, session: { signedIn: true, isPro: true }, initialRequestPath: "/pro/analyze?instId=9701002", selectedInstitutionId: "9701002", institutionContext: { name: "Selected B", type: "credit_union", assetTier: null, fedDistrict: 6 }, accountContext: { status: "identified" as const, institution: { id: 9701002, name: "Account B" } } };
const subject = () => screen.getByLabelText("Institution context").textContent;
beforeEach(() => {
  route.pathname = "/pro/analyze"; route.search = "instId=9701002";
  route.artifact.mockReset().mockResolvedValue({ id: "9701001", name: "Saved A" });
  route.institution.mockReset().mockResolvedValue({ id: "9701002", name: "Selected B" });
});

describe("saved peer research client navigation intent", () => {
  it("recognizes the actual saved page as Hamilton subject/artifact navigation", () => {
    expect(isHamiltonSubjectPath(PATH)).toBe(true);
    expect(hamiltonNavigationSelection(PATH, new URLSearchParams())).toMatchObject({ artifact: true, institutionId: null, research: null });
  });

  it.each([
    "instId=9701002",
    new URLSearchParams({ research: researchB, instId: "9701002" }).toString(),
    "research=invalid&instId=9701002",
    "analysis=00000000-0000-4000-8000-000009701702&instId=9701002",
  ])("never treats conflicting query B as the saved artifact's subject (%s)", (query) => {
    expect(hamiltonNavigationSelection(PATH, new URLSearchParams(query))).toMatchObject({ artifact: true, institutionId: null, research: null });
  });

  it.each(["/pro/peer-research", "/pro/peer-research/", "/pro/peer-research/not-a-uuid", `${PATH}/extra`])("retains saved intent for missing/malformed path so no live default fills it (%s)", (path) => {
    expect(hamiltonNavigationSelection(path, new URLSearchParams("instId=9701002"))).toMatchObject({ artifact: true, institutionId: null, research: null });
  });

  it("preserves exact saved destination links instead of appending current B", () => {
    const selectedB = hamiltonNavigationSelection("/pro/analyze", new URLSearchParams("instId=9701002"));
    expect(hrefWithHamiltonNavigation(PATH, selectedB)).toBe(PATH);
    expect(hrefWithHamiltonNavigation(`${PATH}?instId=9701002`, selectedB)).toBe(`${PATH}?instId=9701002`);
  });

  it("does not project a saved path's unresolved subject onto other workspace links", () => {
    const selection = hamiltonNavigationSelection(PATH, new URLSearchParams("instId=9701002"));
    expect(hrefWithHamiltonNavigation("/pro/reports", selection)).toBe("/pro/reports");
    expect(hrefWithHamiltonNavigation("/pro/analyze", selection)).toBe("/pro/analyze");
  });

  it("keeps artifact identity intent after forward/back route changes", () => {
    const paths = ["/pro/analyze", PATH, "/pro/analyze", PATH];
    const values = paths.map((path) => hamiltonNavigationSelection(path, new URLSearchParams("instId=9701002")));
    expect(values.map((value) => [value.artifact, value.institutionId])).toEqual([
      [false, "9701002"], [true, null], [false, "9701002"], [true, null],
    ]);
  });

  it("does not classify a merely similar route as a saved artifact", () => {
    expect(isHamiltonSubjectPath(PATH.replace("peer-research", "peer-researcher"))).toBe(false);
    expect(hamiltonNavigationSelection(PATH.replace("peer-research", "peer-researcher"), new URLSearchParams("instId=9701002")).artifact).toBe(false);
  });
});

describe("retained client shell resolves the exact saved peer artifact", () => {
  it("clears B during an SPA saved-A lookup and names A only after the authorized result", async () => {
    let complete!: (value: { id: string; name: string }) => void;
    route.artifact.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const view = render(createElement(HamiltonShell, seed, "B body"));
    route.pathname = PATH; route.search = "instId=9701002";
    view.rerender(createElement(HamiltonShell, seed, "Saved A body"));
    expect(subject()).not.toContain("Researching: Selected B");
    expect(subject()).not.toContain("Researching: Saved A");
    await waitFor(() => expect(route.artifact).toHaveBeenCalledWith(PATH, "instId=9701002"));
    await act(async () => complete({ id: "9701001", name: "Saved A" }));
    expect(subject()).toContain("Researching: Saved A");
    expect(route.institution).not.toHaveBeenCalled();
  });

  it("ignores a late saved-A response after a different saved artifact C resolves", async () => {
    let completeA!: (value: { id: string; name: string }) => void;
    let completeC!: (value: { id: string; name: string }) => void;
    const otherPath = PATH.replace("1701", "1702");
    route.artifact.mockImplementation((path) => new Promise(resolve => { if (path === PATH) completeA = resolve; else completeC = resolve; }));
    const view = render(createElement(HamiltonShell, seed, "B body"));
    route.pathname = PATH; view.rerender(createElement(HamiltonShell, seed, "A body"));
    await waitFor(() => expect(route.artifact).toHaveBeenCalledTimes(1));
    route.pathname = otherPath; view.rerender(createElement(HamiltonShell, seed, "C body"));
    await waitFor(() => expect(route.artifact).toHaveBeenCalledTimes(2));
    await act(async () => completeC({ id: "9701003", name: "Saved C" }));
    await act(async () => completeA({ id: "9701001", name: "Late saved A" }));
    expect(subject()).toContain("Researching: Saved C"); expect(subject()).not.toContain("Late saved A");
  });

  it("reauthorizes the artifact after back-forward return instead of reusing initial seed B", async () => {
    const view = render(createElement(HamiltonShell, seed, "B body"));
    route.pathname = PATH; view.rerender(createElement(HamiltonShell, seed, "Saved A"));
    await waitFor(() => expect(subject()).toContain("Researching: Saved A"));
    route.pathname = "/pro/analyze"; view.rerender(createElement(HamiltonShell, seed, "B again"));
    await waitFor(() => expect(subject()).toContain("Researching: Selected B"));
    route.artifact.mockResolvedValue(null);
    route.pathname = PATH; view.rerender(createElement(HamiltonShell, seed, "Now-unavailable saved A"));
    await waitFor(() => expect(route.artifact).toHaveBeenCalledTimes(2));
    expect(subject()).not.toContain("Researching: Selected B"); expect(subject()).not.toContain("Researching: Saved A");
  });

  it("uses fresh document server artifact A even when the URL still contains B", () => {
    route.pathname = PATH; route.search = "instId=9701002";
    render(createElement(HamiltonShell, { ...seed, initialRequestPath: `${PATH}?instId=9701002`, selectedInstitutionId: "9701001", institutionContext: { ...seed.institutionContext, name: "Saved A" } }, "Saved A body"));
    expect(subject()).toContain("Researching: Saved A");
    expect(route.institution).not.toHaveBeenCalled(); expect(route.artifact).not.toHaveBeenCalled();
  });
});
