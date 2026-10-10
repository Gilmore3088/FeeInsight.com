import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { InstitutionWorkspaceMembership } from "@/lib/hamilton/institution-membership";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  resolve: vi.fn(),
  membership: vi.fn(),
  update: vi.fn(),
  claim: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("./actions", () => ({
  updateWorkspaceInstitution: mocks.update,
  requestInstitutionClaim: mocks.claim,
  getWorkspaceInstitutionClaimState: async () => null,
  getIntelligenceSnapshot: async () => ({ savedAnalyses: 0, savedScenarios: 0, tier: "Admin", lastActivity: null }),
}));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: mocks.membership,
  getInstitutionWorkspaceMembers: async () => [],
  getPendingInstitutionWorkspaceInvitations: async () => [],
}));
vi.mock("@/lib/data-store/saved-peers", () => ({
  getPeerSetWorkspace: async () => null,
  getSavedPeerSets: async () => [],
  getPeerInstitutionNames: async () => new Map(),
}));
vi.mock("@/lib/data-store/fee-index", () => ({ getPeerGroupCounts: async () => [] }));
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
vi.mock("./PeerSetManager", () => ({ PeerSetManager: () => null }));
vi.mock("./WorkspaceAccessManager", () => ({ WorkspaceAccessManager: () => null }));
vi.mock("@/components/hamilton/settings/FeeFiguresUpload", () => ({ FeeFiguresUpload: () => null }));
vi.mock("@/components/hamilton/settings/ManageBillingButton", () => ({ ManageBillingButton: () => null }));

import SettingsPage from "./page";
import { WorkspaceInstitutionForm } from "./WorkspaceInstitutionForm";

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
});
afterEach(cleanup);

describe("Settings research identity", () => {
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
    render(<WorkspaceInstitutionForm selectedInstitution={institution} selectedSource="manual" selectedClaim={null} selectedMembership={null} />);

    expect(screen.getByRole("searchbox", { name: "Find an institution to research" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use for research" })).toBeEnabled();
    expect(screen.getByText("Saving sets your default research institution. It does not grant workspace access.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask us to confirm" })).toBeEnabled();
    expect(screen.queryByText(/Your team's workspace/)).not.toBeInTheDocument();
    expect(document.querySelector('#workspace-institution-context-form input[name="institution_id"]')).toHaveValue("2945");
  });

  it("saves a research preference without presenting it as confirmed workspace membership", async () => {
    mocks.update.mockResolvedValue({ success: true, institutionId: 2945, institutionName: institution.name });
    render(<WorkspaceInstitutionForm selectedInstitution={institution} selectedSource="manual" selectedClaim={null} selectedMembership={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Use for research" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved. Hamilton now opens on this research institution.");
    const submitted = mocks.update.mock.calls[0][1] as FormData;
    expect(submitted.get("institution_id")).toBe("2945");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.queryByText(/Your team's workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed since/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask us to confirm" })).toBeEnabled();
  });

  it("shows confirmed workspace membership only when it is supplied for the selected institution", () => {
    const membership: InstitutionWorkspaceMembership = {
      id: 1, institutionId: 2945, institutionName: institution.name,
      city: null, stateCode: null, userId: 7, userDisplayName: "Admin", userEmail: null,
      role: "owner", status: "active", source: "claim", claimId: 2,
      grantedByUserId: null, grantedAt: "2026-10-01T00:00:00Z", notes: null,
    };
    render(<WorkspaceInstitutionForm selectedInstitution={institution} selectedSource="manual" selectedClaim={null} selectedMembership={membership} />);
    expect(screen.getByText("Your team's workspace (owner)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Already confirmed" })).toBeDisabled();
  });

  it("does not carry another institution's membership into the research selection", () => {
    const membership: InstitutionWorkspaceMembership = {
      id: 1, institutionId: 101, institutionName: "Account institution A",
      city: null, stateCode: null, userId: 7, userDisplayName: "Admin", userEmail: null,
      role: "owner", status: "active", source: "claim", claimId: 2,
      grantedByUserId: null, grantedAt: "2026-10-01T00:00:00Z", notes: null,
    };
    render(<WorkspaceInstitutionForm selectedInstitution={institution} selectedSource="manual" selectedClaim={null} selectedMembership={membership} />);
    expect(screen.queryByText(/Your team's workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed since/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask us to confirm" })).toBeEnabled();
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
