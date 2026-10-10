import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { InstitutionWorkspaceMembership } from "@/lib/hamilton/institution-membership";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  resolve: vi.fn(),
  membership: vi.fn(),
  memberships: vi.fn(),
  update: vi.fn(),
  claim: vi.fn(),
  replace: vi.fn(),
  peerWorkspace: vi.fn(),
  peerSets: vi.fn(),
  peerCounts: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); }, useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("./actions", () => ({
  updateWorkspaceInstitution: mocks.update,
  requestInstitutionClaim: mocks.claim,
  getWorkspaceInstitutionClaimState: async () => null,
  getIntelligenceSnapshot: async () => ({ savedAnalyses: 0, savedScenarios: 0, tier: "Admin", lastActivity: null }),
  createPeerSet: vi.fn(), editPeerSet: vi.fn(), removePeerSet: vi.fn(), setPeerSetForAllCharts: vi.fn(),
}));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: mocks.membership,
  getUserInstitutionMemberships: mocks.memberships,
  getInstitutionWorkspaceMembers: async () => [],
  getPendingInstitutionWorkspaceInvitations: async () => [],
}));
vi.mock("@/lib/data-store/saved-peers", () => ({
  getPeerSetWorkspace: mocks.peerWorkspace,
  getSavedPeerSets: mocks.peerSets,
  getPeerInstitutionNames: async () => new Map(),
}));
vi.mock("@/lib/data-store/fee-index", () => ({ getPeerGroupCounts: mocks.peerCounts }));
vi.mock("@/lib/hamilton/peer-index", () => ({
  buildInstitutionPeerFilterCandidates: () => [],
  describePeerFilters: () => "the national index",
  parseSavedPeerSetFilters: () => ({}),
}));
vi.mock("@/lib/hamilton/workspace-invite-link", () => ({
  inviteLinksConfigured: () => false,
  buildWorkspaceInvitePath: () => null,
}));
vi.mock("@/lib/hamilton/report-cap", () => ({ isCappedConsultant: async () => false }));
vi.mock("./WorkspaceAccessManager", () => ({ WorkspaceAccessManager: () => null }));
vi.mock("@/components/hamilton/settings/FeeFiguresUpload", () => ({ FeeFiguresUpload: () => null }));
vi.mock("@/components/hamilton/settings/ManageBillingButton", () => ({ ManageBillingButton: () => null }));

import SettingsPage from "./page";
import { WorkspaceInstitutionAccessRequest, WorkspaceInstitutionForm } from "./WorkspaceInstitutionForm";

const institution: HamiltonSelectedInstitutionContext = {
  id: 2945,
  name: "Space Coast Credit Union",
  city: "Melbourne",
  stateCode: "FL",
  charterType: "credit_union",
  assetSize: null,
  assetSizeLabel: null,
  assetTier: null,
  assetTierLabel: null,
  fedDistrict: null,
  districtName: null,
  feePublicationStatus: "verified",
  feePublicationLabel: "Verified fees",
  insightReadiness: "ready",
  confidenceSummary: "Verified",
  sourceNeededReason: "not_applicable",
  publishedFeeCount: 10,
  provisionalFeeCount: 0,
  qualityLabel: null,
  latestSourceStatus: null,
  latestSourceCollectedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({
    id: 7, role: "admin", display_name: "Admin", email: "admin@example.com",
    institution_name: null, stripe_customer_id: null, subscription_status: "none",
  });
  mocks.resolve.mockResolvedValue({ institution, source: "manual" });
  mocks.membership.mockResolvedValue(null);
  mocks.memberships.mockResolvedValue([]);
  mocks.peerWorkspace.mockResolvedValue(null);
  mocks.peerSets.mockResolvedValue([]);
  mocks.peerCounts.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Settings research identity", () => {
  it("shows personal editable peers for subject B despite a Viewer membership and stored peer workspace A", async () => {
    mocks.user.mockResolvedValue({ id: 25, role: "premium", display_name: "Researcher", email: "researcher@example.com", subscription_status: "active" });
    mocks.memberships.mockResolvedValue([{ userId: 25, institutionId: 8109, institutionName: "Space Coast Credit Union", status: "active" }]);
    mocks.resolve.mockResolvedValue({ institution: { ...institution, id: 8629, name: "Research institution B" }, source: "url" });
    mocks.peerWorkspace.mockResolvedValue({ institutionId: 8109, role: "viewer" });
    const base = { tiers: null, districts: null, charter_type: null, created_at: "2026-10-10", institution_ids: null, states: null, is_default: false };
    mocks.peerSets.mockImplementation(async (_userId, workspaceId) => workspaceId === 8109
      ? [{ ...base, id: 1, name: "Account A shared cohort", created_by: "9", institution_id: 8109 }]
      : [{ ...base, id: 2, name: "My personal cohort", created_by: "25", institution_id: null }, { ...base, id: 3, name: "Authored A shared cohort", created_by: "25", institution_id: 8109 }]);

    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "8629" }) }));
    expect(mocks.membership).toHaveBeenCalledWith({ userId: 25, institutionId: 8629 });
    expect(mocks.peerSets).toHaveBeenCalledWith("25", null);
    expect(screen.getByText("My personal cohort")).toBeInTheDocument();
    expect(screen.queryByText("Account A shared cohort")).not.toBeInTheDocument();
    expect(screen.queryByText("Authored A shared cohort")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a peer group" })).toBeEnabled();
    expect(mocks.peerCounts).toHaveBeenCalledWith([{}], 8629);
    expect(mocks.peerWorkspace).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("keeps selected A's shared peers read-only for its Viewer and resets them when navigating to unrelated B", async () => {
    mocks.user.mockResolvedValue({ id: 25, role: "premium", display_name: "Researcher", email: "researcher@example.com", subscription_status: "active" });
    const membership = {
      id: 4, userId: 25, institutionId: 8109, institutionName: "Space Coast Credit Union", status: "active",
      role: "viewer", source: "manual_admin", claimId: null, grantedByUserId: null, grantedAt: "2026-10-10", notes: null,
    };
    mocks.memberships.mockResolvedValue([membership]);
    mocks.membership.mockResolvedValue(membership);
    mocks.resolve.mockResolvedValue({ institution: { ...institution, id: 8109 }, source: "url" });
    mocks.peerWorkspace.mockResolvedValue({ institutionId: 8629, role: "admin" });
    const base = { tiers: null, districts: null, charter_type: null, created_at: "2026-10-10", institution_ids: null, states: null, is_default: false };
    const personal = { ...base, id: 2, name: "My personal cohort", created_by: "25", institution_id: null };
    mocks.peerSets.mockImplementation(async (_userId, workspaceId) => workspaceId === 8109
      ? [{ ...base, id: 1, name: "Account A shared cohort", created_by: "9", institution_id: 8109, is_default: true }, personal]
      : [personal]);

    const view = render(await SettingsPage({ searchParams: Promise.resolve({ instId: "8109" }) }));
    expect(mocks.peerSets).toHaveBeenCalledWith("25", 8109);
    const sharedGroup = screen.getByText("Account A shared cohort").closest("li")!;
    expect(within(sharedGroup).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(sharedGroup).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a peer group" })).not.toBeInTheDocument();
    expect(screen.getByText(/Groups you add are shared with everyone on Space Coast Credit Union's team/)).toBeInTheDocument();

    mocks.membership.mockResolvedValue(null);
    mocks.resolve.mockResolvedValue({ institution: { ...institution, id: 8629, name: "Research institution B" }, source: "url" });
    view.rerender(await SettingsPage({ searchParams: Promise.resolve({ instId: "8629" }) }));
    expect(mocks.peerSets).toHaveBeenLastCalledWith("25", null);
    expect(screen.queryByText("Account A shared cohort")).not.toBeInTheDocument();
    expect(screen.getByText("My personal cohort")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a peer group" })).toBeEnabled();
    expect(screen.queryByText(/Groups you add are shared with everyone/)).not.toBeInTheDocument();
    const accountSection = screen.getByRole("heading", { name: "Account institution" }).closest("section")!;
    expect(within(accountSection).getByText("Space Coast Credit Union")).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("shows an unlinked account separately from Space Coast research and a self-reported profile name", async () => {
    mocks.user.mockResolvedValue({
      id: 7, role: "premium", display_name: "Researcher", email: "researcher@example.com",
      institution_name: institution.name, stripe_customer_id: null, subscription_status: "active",
    });
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    const accountSection = screen.getByRole("heading", { name: "Account institution" }).closest("section")!;
    expect(within(accountSection).getByText("No account institution linked.")).toBeInTheDocument();
    expect(within(accountSection).queryByText(institution.name)).not.toBeInTheDocument();
    expect(screen.getByText("Research institution: Space Coast Credit Union.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Do you work at this institution?" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Your role and team")).not.toBeInTheDocument();
    expect(mocks.memberships).toHaveBeenCalledWith(7);
  });

  it("keeps canonical account institution A visible while researching Space Coast B", async () => {
    mocks.memberships.mockResolvedValue([{
      userId: 7, institutionId: 101, institutionName: "Account institution A", status: "active",
    }]);
    const { rerender } = render(await SettingsPage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    const accountSection = screen.getByRole("heading", { name: "Account institution" }).closest("section")!;
    expect(within(accountSection).getByText("Account institution A")).toBeInTheDocument();
    expect(within(accountSection).getByText("Institution ID 101")).toBeInTheDocument();
    expect(within(accountSection).queryByText(institution.name)).not.toBeInTheDocument();
    const researchSection = screen.getByRole("heading", { name: "Research institution" }).closest("section")!;
    expect(within(researchSection).getByRole("button", { name: "Use for research" })).toBeEnabled();
    expect(within(researchSection).queryByRole("button", { name: "Request workspace access", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText("Research institution: Space Coast Credit Union.")).toBeInTheDocument();
    mocks.resolve.mockResolvedValue({ institution: { ...institution, id: 202, name: "Research institution C" }, source: "url" });
    rerender(await SettingsPage({ searchParams: Promise.resolve({ instId: "202" }) }));
    const updatedAccountSection = screen.getByRole("heading", { name: "Account institution" }).closest("section")!;
    expect(within(updatedAccountSection).getByText("Account institution A")).toBeInTheDocument();
    expect(within(updatedAccountSection).getByText("Institution ID 101")).toBeInTheDocument();
    expect(screen.getByText("Research institution: Research institution C.")).toBeInTheDocument();
  });

  it.each(["admin", "premium"])("renders a %s account's research subject without claiming institution membership", async (role) => {
    mocks.user.mockResolvedValue({
      id: 7, role, display_name: "Researcher", email: "researcher@example.com",
      institution_name: null, stripe_customer_id: role === "premium" ? "cus_active_pro" : null,
      subscription_status: role === "premium" ? "active" : "none",
    });
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "2945" }) }));

    expect(screen.getByRole("heading", { name: "Research institution" })).toBeInTheDocument();
    expect(screen.getByText("Research institution: Space Coast Credit Union.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your bank" })).not.toBeInTheDocument();
    expect(screen.queryByText("Every screen starts from this bank.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Your team's workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed since/)).not.toBeInTheDocument();
    expect(mocks.membership).toHaveBeenCalledWith({ userId: 7, institutionId: 2945 });
    expect(mocks.resolve).toHaveBeenCalledWith({ userId: 7, instId: "2945", intent: "settings" });
    if (role === "premium") {
      expect(screen.getByText("Professional")).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.queryByText("You have full access as an administrator. No billing applies.")).not.toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "Your own figures" })).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Ask Hamilton about this institution" })) {
      expect(link).toHaveAttribute("href", "/pro/analyze?instId=2945");
    }
  });

  it("makes the selection button a research preference and keeps the claim separate", () => {
    render(<WorkspaceInstitutionForm selectedInstitution={institution} selectedSource="manual" />);

    expect(screen.getByRole("searchbox", { name: "Find an institution to research" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use for research" })).toBeEnabled();
    expect(screen.getByText("Saving sets your default research institution. It does not grant workspace access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request workspace access" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Your connection to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your team's workspace/)).not.toBeInTheDocument();
    expect(document.querySelector('#workspace-institution-context-form input[name="institution_id"]')).toHaveValue("2945");
  });

  it("saves a research preference without presenting it as confirmed workspace membership", async () => {
    mocks.update.mockResolvedValue({ success: true, institutionId: 2945, institutionName: institution.name });
    render(<WorkspaceInstitutionForm selectedInstitution={institution} selectedSource="manual" />);
    fireEvent.click(screen.getByRole("button", { name: "Use for research" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved. Hamilton now opens on this research institution.");
    const submitted = mocks.update.mock.calls[0][1] as FormData;
    expect(submitted.get("institution_id")).toBe("2945");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.queryByText(/Your team's workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed since/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request workspace access" })).not.toBeInTheDocument();
  });

  it("submits institution B after saving A and navigating to B in the retained Settings page", async () => {
    const institutionA = { ...institution, id: 101, name: "Research institution A" };
    mocks.resolve.mockResolvedValue({ institution: institutionA, source: "url" });
    mocks.update.mockImplementation(async (_state, form: FormData) => ({
      success: true,
      institutionId: Number(form.get("institution_id")),
      institutionName: form.get("institution_id") === "101" ? institutionA.name : institution.name,
    }));
    const view = render(await SettingsPage({ searchParams: Promise.resolve({ instId: "101" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Use for research" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved. Hamilton now opens on this research institution.");
    expect((mocks.update.mock.calls[0][1] as FormData).get("institution_id")).toBe("101");

    mocks.resolve.mockResolvedValue({ institution, source: "url" });
    view.rerender(await SettingsPage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    const researchSection = screen.getByRole("heading", { name: "Research institution" }).closest("section")!;
    expect(within(researchSection).getByRole("searchbox", { name: "Find an institution to research" })).toHaveValue(institution.name);
    expect(researchSection.querySelector('input[name="institution_id"]')).toHaveValue("2945");
    expect(within(researchSection).queryByText("Research institution A")).not.toBeInTheDocument();
    expect(within(researchSection).queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.claim).not.toHaveBeenCalled();

    fireEvent.click(within(researchSection).getByRole("button", { name: "Use for research" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect((mocks.update.mock.calls[1][1] as FormData).get("institution_id")).toBe("2945");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.getByText("No account institution linked.")).toBeInTheDocument();
  });

  it("navigates to saved research institution A after an explicit selection while the URL still shows B", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{
      id: 101, institution_name: "Research institution A", city: "Melbourne", state_code: "FL",
      charter_type: "credit_union", asset_size_tier: "midsize", published_fee_count: 10,
      provisional_fee_count: 0, fee_publication_label: "Verified fees",
    }] }));
    mocks.update.mockResolvedValue({ success: true, institutionId: 101, institutionName: "Research institution A" });
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    expect(mocks.replace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find an institution to research" }), { target: { value: "Research institution A" } });
    fireEvent.mouseDown(await screen.findByRole("button", { name: /Research institution A.*verified fees/ }));
    expect(mocks.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use for research" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved. Hamilton now opens on this research institution.");
    expect((mocks.update.mock.calls[0][1] as FormData).get("institution_id")).toBe("101");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/pro/settings?instId=101"));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.getByText("No account institution linked.")).toBeInTheDocument();
  });

  it.each([
    ["failed save", { success: false, error: "The research preference could not be saved." }],
    ["missing saved ID", { success: true, institutionName: "Research institution A" }],
    ["invalid saved ID", { success: true, institutionId: 0, institutionName: "Research institution A" }],
  ])("does not navigate on %s", async (_label, response) => {
    mocks.update.mockResolvedValue(response);
    render(<WorkspaceInstitutionForm selectedInstitution={institution} selectedSource="url" />);
    fireEvent.click(screen.getByRole("button", { name: "Use for research" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    if (response.success) await screen.findByRole("status");
    else await screen.findByRole("alert");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("shows the same canonical account and research institution with access recorded separately", async () => {
    const membership: InstitutionWorkspaceMembership = {
      id: 1, institutionId: 2945, institutionName: institution.name,
      city: null, stateCode: null, userId: 7, userDisplayName: "Admin", userEmail: null,
      role: "owner", status: "active", source: "claim", claimId: 2,
      grantedByUserId: null, grantedAt: "2026-10-01T00:00:00Z", notes: null,
    };
    mocks.memberships.mockResolvedValue([membership]);
    mocks.membership.mockResolvedValue(membership);
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    const accountSection = screen.getByRole("heading", { name: "Account institution" }).closest("section")!;
    expect(within(accountSection).getByText(institution.name)).toBeInTheDocument();
    expect(within(accountSection).getByText("Institution ID 2945")).toBeInTheDocument();
    expect(screen.getByText("Active workspace access to Space Coast Credit Union (owner).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Access already active", hidden: true })).toBeDisabled();
    const researchSection = screen.getByRole("heading", { name: "Research institution" }).closest("section")!;
    expect(within(researchSection).queryByText(/Active workspace access/)).not.toBeInTheDocument();
  });

  it("does not carry another institution's membership into an access request", () => {
    const membership: InstitutionWorkspaceMembership = {
      id: 1, institutionId: 101, institutionName: "Account institution A",
      city: null, stateCode: null, userId: 7, userDisplayName: "Admin", userEmail: null,
      role: "owner", status: "active", source: "claim", claimId: 2,
      grantedByUserId: null, grantedAt: "2026-10-01T00:00:00Z", notes: null,
    };
    render(<WorkspaceInstitutionAccessRequest selectedInstitution={institution} selectedClaim={null} selectedMembership={membership} currentUserId={7} />);
    expect(screen.queryByText(/Your team's workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed since/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request workspace access", hidden: true })).toBeEnabled();
  });

  it("ignores another user's active membership for both account identity and selected workspace access", async () => {
    const membership: InstitutionWorkspaceMembership = {
      id: 1, institutionId: 2945, institutionName: institution.name,
      city: null, stateCode: null, userId: 99, userDisplayName: "Another user", userEmail: null,
      role: "owner", status: "active", source: "claim", claimId: 2,
      grantedByUserId: null, grantedAt: "2026-10-01T00:00:00Z", notes: null,
    };
    mocks.memberships.mockResolvedValue([membership]);
    mocks.membership.mockResolvedValue(membership);
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    expect(screen.getByText("No account institution linked.")).toBeInTheDocument();
    expect(screen.queryByText(/Active workspace access to/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request workspace access", hidden: true })).toBeEnabled();
  });

  it("submits an explicit named access request without changing the research preference", async () => {
    mocks.claim.mockResolvedValue({ success: true, message: "Request received." });
    render(<WorkspaceInstitutionAccessRequest selectedInstitution={institution} selectedClaim={null} selectedMembership={null} currentUserId={7} />);
    const disclosure = screen.getByText("Request workspace access to Space Coast Credit Union").closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Request workspace access to Space Coast Credit Union"));
    fireEvent.change(screen.getByLabelText("Your connection to Space Coast Credit Union"), { target: { value: "Authorized product team member" } });
    fireEvent.click(screen.getByRole("button", { name: "Request workspace access" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Request received.");
    const submitted = mocks.claim.mock.calls[0][1] as FormData;
    expect(submitted.get("institution_id")).toBe("2945");
    expect(submitted.get("claim_notes")).toBe("Authorized product team member");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.queryByText(/Active workspace access to/)).not.toBeInTheDocument();
  });

  it("asks for a research institution when none is selected", async () => {
    mocks.resolve.mockResolvedValue({ institution: null, source: "none" });
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("No research institution selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use for research" })).toBeDisabled();
    expect(screen.queryByText(/your bank/i)).not.toBeInTheDocument();
    expect(mocks.membership).not.toHaveBeenCalled();
  });
});
