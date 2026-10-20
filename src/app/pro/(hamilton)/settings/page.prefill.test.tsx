import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  resolve: vi.fn(),
  peerSets: vi.fn(),
  peerNames: vi.fn(),
  createPeerSet: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); }, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("./actions", () => ({
  updateWorkspaceInstitution: vi.fn(),
  getIntelligenceSnapshot: async () => ({ savedAnalyses: 0, savedScenarios: 0, tier: "Professional", lastActivity: null }),
  createPeerSet: mocks.createPeerSet, editPeerSet: vi.fn(), removePeerSet: vi.fn(), setPeerSetForAllCharts: vi.fn(),
}));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: async () => null,
  getUserInstitutionMemberships: async () => [],
  getInstitutionWorkspaceMembers: async () => [],
  getPendingInstitutionWorkspaceInvitations: async () => [],
}));
vi.mock("@/lib/data-store/saved-peers", () => ({
  getPeerSetWorkspace: async () => null,
  getSavedPeerSets: mocks.peerSets,
  getPeerInstitutionNames: mocks.peerNames,
}));
vi.mock("@/lib/data-store/fee-index", () => ({ getPeerGroupCounts: async () => [] }));
vi.mock("@/lib/hamilton/peer-index", () => ({
  buildInstitutionPeerFilterCandidates: () => [],
  describePeerFilters: () => "the national index",
  parseSavedPeerSetFilters: () => ({}),
}));
vi.mock("@/lib/hamilton/workspace-invite-link", () => ({ inviteLinksConfigured: () => false, buildWorkspaceInvitePath: () => null }));
vi.mock("@/lib/pro-institution-link", () => ({ getPendingInstitutionLink: async () => null }));
vi.mock("@/lib/data-store/connection", () => ({ sql: {} }));
vi.mock("@/lib/hamilton/report-cap", () => ({ isCappedConsultant: async () => false }));
vi.mock("./WorkspaceAccessManager", () => ({ WorkspaceAccessManager: () => null }));
vi.mock("@/components/hamilton/settings/FeeFiguresUpload", () => ({ FeeFiguresUpload: () => null }));
vi.mock("@/components/hamilton/settings/ManageBillingButton", () => ({ ManageBillingButton: () => null }));
vi.mock("@/components/hamilton/InstitutionPicker", () => ({ InstitutionPicker: () => null }));

import SettingsPage from "./page";

const institution: HamiltonSelectedInstitutionContext = {
  id: 323, name: "Capital City Bank", city: "Tallahassee", stateCode: "FL", charterType: "bank",
  assetSize: null, assetSizeLabel: null, assetTier: null, assetTierLabel: null, fedDistrict: null,
  districtName: null, feePublicationStatus: "verified", feePublicationLabel: "Verified fees",
  insightReadiness: "ready", confidenceSummary: "Verified", sourceNeededReason: "not_applicable",
  publishedFeeCount: 10, provisionalFeeCount: 0, qualityLabel: null, latestSourceStatus: null,
  latestSourceCollectedAt: null,
};

/** institution_sources as the name lookup sees it: 10 and 11 exist, nothing else does. */
const KNOWN: Record<number, string> = { 10: "First Bank", 11: "Second Credit Union" };

beforeEach(() => {
  vi.resetAllMocks();
  // postgres.js hands back a bigint user id as a string.
  mocks.user.mockResolvedValue({ id: "25", role: "premium", display_name: "Researcher", email: "r@example.com", subscription_status: "active" });
  mocks.resolve.mockResolvedValue({ institution, source: "url" });
  mocks.peerSets.mockResolvedValue([]);
  mocks.peerNames.mockImplementation(async (ids: number[]) => new Map(ids.filter((id) => KNOWN[id]).map((id) => [id, KNOWN[id]])));
});
afterEach(cleanup);

/** Lookups made for the link's peers (the page also looks up saved sets' members, here none). */
function prefillLookups() {
  return mocks.peerNames.mock.calls.map(([ids]) => ids as number[]).filter((ids) => ids.length > 0);
}

function peerSection() {
  return screen.getByRole("heading", { name: "Peer groups" }).closest("section")!;
}

describe("Settings pre-fills a peer group from a public page's link (#1981)", () => {
  it("opens the form with the known peers, the name, the fee and the as-of date, and saves nothing", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({
      instId: "323", peers: "10,99999,11", name: "Home metro", fee: "overdraft", asof: "2026-10-17",
    }) }));
    expect(mocks.peerNames).toHaveBeenCalledWith([10, 99999, 11]);
    const section = within(peerSection());
    expect(section.getByText("First Bank")).toBeInTheDocument();
    expect(section.getByText("Second Credit Union")).toBeInTheDocument();
    expect(section.queryByText(/Institution 99999/)).not.toBeInTheDocument();
    expect(section.getByText("2 of 50 chosen.")).toBeInTheDocument();
    expect(section.getByText("Fee: Overdraft. Data as of October 17, 2026.")).toBeInTheDocument();
    expect(peerSection().querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("Home metro");
    expect(peerSection().querySelector<HTMLInputElement>('input[name="research_institution_id"]')!.value).toBe("323");
    expect(section.getByRole("button", { name: "Save this set" })).toBeEnabled();
    expect(mocks.createPeerSet).not.toHaveBeenCalled();
  });

  it("keeps good parameters and drops bad ones on their own", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({
      instId: "323", peers: "10,abc,2147483648", name: "<script>alert(1)</script>", fee: "not_a_fee", asof: "2026-02-30",
    }) }));
    expect(mocks.peerNames).toHaveBeenCalledWith([10]);
    const section = within(peerSection());
    expect(section.getByText("First Bank")).toBeInTheDocument();
    expect(peerSection().querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("");
    expect(section.queryByText(/^Fee:/)).not.toBeInTheDocument();
    expect(section.queryByText(/Data as of/)).not.toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("opens nothing when no peer is known, or the link has no peers", async () => {
    const view = render(await SettingsPage({ searchParams: Promise.resolve({ instId: "323", peers: "98,99", name: "Home metro", fee: "overdraft" }) }));
    expect(within(peerSection()).queryByRole("button", { name: "Save this set" })).not.toBeInTheDocument();
    expect(within(peerSection()).getByRole("button", { name: "Add a peer group" })).toBeInTheDocument();
    view.rerender(await SettingsPage({ searchParams: Promise.resolve({ instId: "323" }) }));
    expect(within(peerSection()).queryByRole("button", { name: "Save this set" })).not.toBeInTheDocument();
    expect(prefillLookups()).toEqual([[98, 99]]);
  });

  it("says a set too large to copy is too large, with no lookup (#1997)", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "323", name: "Banks in Florida", fee: "wire_intl_outgoing", large: "1" }) }));
    const section = within(peerSection());
    expect(section.getByText(/^Banks in Florida is too large to copy as a peer group/)).toBeInTheDocument();
    expect(section.getByText("Fee: International wire.")).toBeInTheDocument();
    expect(section.getByRole("button", { name: "Save peer group" })).toBeEnabled();
    expect(prefillLookups()).toEqual([]);
    expect(mocks.createPeerSet).not.toHaveBeenCalled();
  });

  it("keeps a too-large set's flag through sign-in (#1997)", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(SettingsPage({ searchParams: Promise.resolve({ instId: "323", name: "Banks in Florida", large: "1" }) })).rejects.toThrow(
      `REDIRECT:/login?from=${encodeURIComponent("/pro/settings?instId=323&name=Banks+in+Florida&large=1#peer-sets")}`,
    );
  });

  it("caps an oversized peers list at the most a group holds before looking anything up", async () => {
    const ids = Array.from({ length: 70 }, (_, i) => i + 1);
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "323", peers: ids.join(",") }) }));
    expect(mocks.peerNames).toHaveBeenCalledWith(ids.slice(0, 50));
  });

  it("ignores a huge peers value without a lookup", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "323", peers: "1,".repeat(50_000), name: "x".repeat(50_000) }) }));
    expect(prefillLookups()).toEqual([]);
    expect(within(peerSection()).queryByRole("button", { name: "Save this set" })).not.toBeInTheDocument();
  });

  it("still renders when the name lookup fails", async () => {
    mocks.peerNames.mockRejectedValue(new Error("db down"));
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "323", peers: "10" }) }));
    expect(within(peerSection()).getByRole("button", { name: "Add a peer group" })).toBeInTheDocument();
  });

  it("keeps the checked set through sign-in, in the link builder's format", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(SettingsPage({ searchParams: Promise.resolve({
      instId: "323", peers: "10,bad,11", name: "Home metro", fee: "overdraft", asof: "2026-10-17",
    }) })).rejects.toThrow(
      `REDIRECT:/login?from=${encodeURIComponent("/pro/settings?instId=323&peers=10%2C11&name=Home+metro&fee=overdraft&asof=2026-10-17#peer-sets")}`,
    );
  });

  it("drops bad parameters from the sign-in return path and keeps a plain link as before", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(SettingsPage({ searchParams: Promise.resolve({ instId: "323", name: "<b>x</b>", fee: "nope" }) })).rejects.toThrow(
      `REDIRECT:/login?from=${encodeURIComponent("/pro/settings?instId=323")}`,
    );
    await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      `REDIRECT:/login?from=${encodeURIComponent("/pro/settings")}`,
    );
  });
});
