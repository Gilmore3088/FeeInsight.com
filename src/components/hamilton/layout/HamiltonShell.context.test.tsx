import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeLandingResearch } from "@/lib/hamilton/landing-research-handoff";

const route = vi.hoisted(() => ({ pathname: "/pro/research", search: "instId=8109", resolve: vi.fn() }));
vi.mock("@/lib/hamilton/navigation-institution-action", () => ({ loadHamiltonNavigationInstitution: route.resolve }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams(route.search) }));
vi.mock("@/app/pro/(hamilton)/view-as-actions", () => ({ setViewAsCustomer: vi.fn() }));
vi.mock("@/components/use-session-chrome", () => ({
  SessionChromeProvider: ({ children }: { children: React.ReactNode }) => children,
  useSessionChrome: () => ({ signedIn: true, isPro: true, isStaff: false }),
}));
vi.mock("@/components/public/search-modal", () => ({ SearchModal: () => null }));
vi.mock("./HamiltonAskDock", () => ({ HamiltonAskDock: () => null }));

import { HamiltonShell } from "./HamiltonShell";

const homeName = "Space Coast Federal Credit Union";
const seed = {
  isAdmin: false,
  session: { signedIn: true, isPro: true },
  initialRequestPath: "/pro/research?instId=8109",
  selectedInstitutionId: "8109",
  institutionContext: { name: homeName, type: "credit_union", assetTier: null, fedDistrict: 6 },
  accountContext: { status: "identified" as const, institution: { id: 8109, name: homeName } },
};

beforeEach(() => {
  route.pathname = "/pro/research"; route.search = "instId=8109";
  route.resolve.mockReset().mockImplementation(async (id: string) => ({ id, name: id === "1535" ? "Addition Financial Credit Union" : homeName }));
});

describe("H01 retained Hamilton shell navigation", () => {
  it("carries the canonical research subject on desktop links without adding it to reference pages", () => {
    render(<HamiltonShell {...seed}>Research body</HamiltonShell>);
    const nav = within(screen.getByRole("navigation", { name: "Hamilton workspace" }));
    expect(nav.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/pro/reports?instId=8109");
    expect(nav.getByRole("link", { name: "Research" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Saved analyses" })).toHaveAttribute("href", "/pro/saved?instId=8109");
  });

  it("carries the same research subject through mobile tabs and account links", async () => {
    render(<HamiltonShell {...seed}>Research body</HamiltonShell>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const nav = within(await screen.findByRole("navigation", { name: "Hamilton workspace" }));
    expect(nav.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/pro/reports?instId=8109");
    expect(screen.getByRole("link", { name: "Settings & account" })).toHaveAttribute("href", "/pro/settings?instId=8109");
    expect(nav.getByRole("link", { name: "Ask Hamilton" })).toHaveAttribute("href", "/pro/analyze?instId=8109");
  });

  it("keeps encoded state research scope, categories and charter when switching into Reports", () => {
    const selection = { version: 1, task: "compare", scope: { kind: "state", stateCode: "FL" }, categories: ["money_order"], charter: "credit_union" };
    route.pathname = "/pro/analyze";
    route.search = new URLSearchParams({ research: encodeLandingResearch(selection) }).toString();
    render(<HamiltonShell {...seed}>State research</HamiltonShell>);
    const nav = within(screen.getByRole("navigation", { name: "Hamilton workspace" }));
    const href = nav.getByRole("link", { name: "Reports" }).getAttribute("href")!;
    const query = new URL(href, "https://example.test").searchParams;
    expect(JSON.parse(query.get("research")!)).toEqual({ ...selection, task: "board_report" });
    expect(query.has("instId")).toBe(false);
  });

  it("drops an old retained subject label and links when the live URL selects Addition", async () => {
    const view = render(<HamiltonShell {...seed}>Space Coast body</HamiltonShell>);
    route.pathname = "/pro/reports";
    route.search = "instId=1535";
    view.rerender(<HamiltonShell {...seed}>Addition body</HamiltonShell>);
    expect(screen.getByLabelText("Institution context").textContent).not.toContain(`Researching: ${homeName}`);
    const nav = within(screen.getByRole("navigation", { name: "Hamilton workspace" }));
    await waitFor(() => expect(nav.getByRole("link", { name: "Research" })).toHaveAttribute("href", "/pro/intelligence?instId=1535"));
    expect(screen.getByLabelText("Institution context").textContent).toContain(`Your institution: ${homeName}`);
  });

  it("ignores a late canonical response for A after the live URL changes to B", async () => {
    let resolveA!: (value: { id: string; name: string }) => void;
    let resolveB!: (value: { id: string; name: string }) => void;
    route.resolve.mockImplementation((id: string) => new Promise((resolve) => {
      if (id === "2945") resolveA = resolve;
      else resolveB = resolve;
    }));
    const view = render(<HamiltonShell {...seed}>Initial</HamiltonShell>);
    route.pathname = "/pro/reports"; route.search = "instId=2945";
    view.rerender(<HamiltonShell {...seed}>A</HamiltonShell>);
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("href", "/pro/intelligence?instId=2945");
    route.search = "instId=1535";
    view.rerender(<HamiltonShell {...seed}>B</HamiltonShell>);
    await act(async () => resolveB({ id: "1535", name: "Addition Financial Credit Union" }));
    await act(async () => resolveA({ id: "2945", name: "Delayed old A" }));
    expect(screen.getByLabelText("Institution context").textContent).toContain("Researching: Addition Financial Credit Union");
    expect(screen.getByLabelText("Institution context").textContent).not.toContain("Delayed old A");
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("href", "/pro/intelligence?instId=1535");
  });

  it("freshly resolves a blank URL's saved preference and never reuses an old default seed on return", async () => {
    route.pathname = "/pro/research"; route.search = "";
    const initial = { ...seed, initialRequestPath: "/pro/research" };
    const view = render(<HamiltonShell {...initial}>Initial default A</HamiltonShell>);
    route.resolve.mockResolvedValue({ id: "1535", name: "Addition Financial Credit Union" });
    route.pathname = "/pro/reports";
    view.rerender(<HamiltonShell {...initial}>Saved preference B</HamiltonShell>);
    await waitFor(() => expect(route.resolve).toHaveBeenCalledWith(null));
    await waitFor(() => expect(screen.getByLabelText("Institution context").textContent).toContain("Researching: Addition Financial Credit Union"));
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("href", "/pro/intelligence?instId=1535");
    route.pathname = "/pro/research";
    view.rerender(<HamiltonShell {...initial}>Returned fresh default B</HamiltonShell>);
    await waitFor(() => expect(route.resolve).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Institution context").textContent).toContain("Researching: Addition Financial Credit Union"));
    expect(screen.getByLabelText("Institution context").textContent).not.toContain(`Researching: ${homeName}`);
  });

  it("does not reuse a cached default when returning before another lookup finishes", async () => {
    route.resolve.mockResolvedValueOnce({ id: "8109", name: homeName })
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ id: "1535", name: "Addition Financial Credit Union" });
    const view = render(<HamiltonShell {...seed}>Initial</HamiltonShell>);
    route.pathname = "/pro/reports"; route.search = "";
    view.rerender(<HamiltonShell {...seed}>Default A</HamiltonShell>);
    await waitFor(() => expect(screen.getByLabelText("Institution context").textContent).toContain(`Researching: ${homeName}`));
    route.pathname = "/pro/simulate";
    view.rerender(<HamiltonShell {...seed}>Pending</HamiltonShell>);
    route.pathname = "/pro/reports";
    view.rerender(<HamiltonShell {...seed}>Returned</HamiltonShell>);
    expect(screen.getByLabelText("Institution context").textContent).not.toContain(`Researching: ${homeName}`);
    await waitFor(() => expect(screen.getByLabelText("Institution context").textContent).toContain("Researching: Addition Financial Credit Union"));
  });

  it("keeps explicit B intent when Reports is clicked before canonical resolution completes", () => {
    route.resolve.mockImplementation(() => new Promise(() => {}));
    const view = render(<HamiltonShell {...seed}>Initial A</HamiltonShell>);
    route.pathname = "/pro/research"; route.search = "instId=1535";
    view.rerender(<HamiltonShell {...seed}>Pending B</HamiltonShell>);
    const reports = screen.getByRole("link", { name: "Reports" });
    expect(reports).toHaveAttribute("href", "/pro/reports?instId=1535");
    let clickedDestination: string | null = null;
    reports.addEventListener("click", (event) => {
      event.preventDefault();
      clickedDestination = reports.getAttribute("href");
    }, { once: true });
    fireEvent.click(reports);
    expect(clickedDestination).toBe("/pro/reports?instId=1535");
    expect(screen.getByLabelText("Institution context").textContent).toContain("Research subject is being resolved");
  });

  it.each(["instId=999999", "research=invalid", "report_id=private-missing&instId=1535"])("never borrows a retained seed for unavailable or frozen selection %s", async (search) => {
    route.resolve.mockResolvedValue(null);
    const view = render(<HamiltonShell {...seed}>Initial</HamiltonShell>);
    route.pathname = "/pro/reports"; route.search = search;
    view.rerender(<HamiltonShell {...seed}>Unavailable</HamiltonShell>);
    if (search.startsWith("instId")) await waitFor(() => expect(screen.getByLabelText("Institution context").textContent).toContain("Research subject unavailable"));
    else expect(route.resolve).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Institution context").textContent).not.toContain(`Researching: ${homeName}`);
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("href", search.startsWith("instId") ? "/pro/intelligence?instId=999999" : "/pro/intelligence");
  });

  it("uses authorized saved report A as the shell subject despite a conflicting URL B", () => {
    route.pathname = "/pro/reports"; route.search = "report_id=saved-a&instId=1535";
    render(<HamiltonShell {...seed} initialRequestPath={`/pro/reports?${route.search}`}>Saved A</HamiltonShell>);
    expect(screen.getByLabelText("Institution context").textContent).toContain(`Researching: ${homeName}`);
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("href", "/pro/intelligence?instId=8109");
    expect(route.resolve).not.toHaveBeenCalled();
  });

  it("keeps a legacy or unavailable saved report unscoped despite retained profile/default metadata", () => {
    route.pathname = "/pro/reports"; route.search = "report_id=unscoped&instId=1535";
    render(<HamiltonShell {...seed} initialRequestPath={`/pro/reports?${route.search}`} selectedInstitutionId={null}
      institutionContext={{ ...seed.institutionContext, name: "Saved artifact · research subject unavailable" }}>Unscoped</HamiltonShell>);
    expect(screen.getByLabelText("Institution context").textContent).toContain("Researching: Saved artifact · research subject unavailable");
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("href", "/pro/intelligence");
    expect(route.resolve).not.toHaveBeenCalled();
  });
});
