/**
 * #1922: Settings reads a team's roster (names, emails, pending invites) only for that
 * institution's own active members or platform staff. The research subject comes from ?instId=,
 * so before this check a Pro user at one bank could open /pro/settings?instId=<another bank>
 * and see that bank's team and the emails it had invited.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { InstitutionWorkspaceInvitation, InstitutionWorkspaceMembership } from "@/lib/hamilton/institution-membership";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  resolve: vi.fn(),
  membership: vi.fn(),
  members: vi.fn(),
  invitations: vi.fn(),
  accessManager: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); }, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("./actions", () => ({
  updateWorkspaceInstitution: vi.fn(),
  getIntelligenceSnapshot: async () => ({ savedAnalyses: 0, savedScenarios: 0, tier: "Professional", lastActivity: null }),
  createPeerSet: vi.fn(), editPeerSet: vi.fn(), removePeerSet: vi.fn(), setPeerSetForAllCharts: vi.fn(),
}));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: mocks.membership,
  getUserInstitutionMemberships: async () => [],
  getInstitutionWorkspaceMembers: mocks.members,
  getPendingInstitutionWorkspaceInvitations: mocks.invitations,
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
vi.mock("@/lib/hamilton/workspace-invite-link", () => ({ inviteLinksConfigured: () => true, buildWorkspaceInvitePath: () => "/invite/x" }));
vi.mock("@/lib/pro-institution-link", () => ({ getPendingInstitutionLink: async () => null }));
vi.mock("@/lib/hamilton/account-context-store", () => ({ loadHamiltonAccountContext: async () => ({ memberships: [] }) }));
vi.mock("@/lib/data-store/connection", () => ({ sql: {} }));
vi.mock("@/lib/hamilton/report-cap", () => ({ isCappedConsultant: async () => false }));
vi.mock("./WorkspaceAccessManager", () => ({ WorkspaceAccessManager: mocks.accessManager }));
vi.mock("@/components/hamilton/settings/FeeFiguresUpload", () => ({ FeeFiguresUpload: () => null }));
vi.mock("@/components/hamilton/settings/ManageBillingButton", () => ({ ManageBillingButton: () => null }));

import SettingsPage from "./page";

const bankX = {
  id: 9922101, name: "Synthetic Bank X", city: "Testville", stateCode: "KS", charterType: "bank",
  assetSize: null, assetSizeLabel: null, assetTier: null, assetTierLabel: null, fedDistrict: null, districtName: null,
  feePublicationStatus: "verified", feePublicationLabel: "Verified fees", insightReadiness: "ready",
  confidenceSummary: "Verified", sourceNeededReason: "not_applicable", publishedFeeCount: 10, provisionalFeeCount: 0,
  qualityLabel: null, latestSourceStatus: null, latestSourceCollectedAt: null,
} as unknown as HamiltonSelectedInstitutionContext;

const teammate = {
  id: 41, institutionId: bankX.id, institutionName: bankX.name, city: null, stateCode: null, userId: 9922003,
  userDisplayName: "X Teammate", userEmail: "teammate@bank-x.example.test", role: "viewer", status: "active",
  source: "manual_admin", claimId: null, grantedByUserId: null, grantedAt: "2026-10-10", notes: null,
} as unknown as InstitutionWorkspaceMembership;
const invite = { id: 7, institutionId: bankX.id, email: "new-hire@bank-x.example.test", role: "analyst", expiresAt: "2026-10-25" } as unknown as InstitutionWorkspaceInvitation;

const pro = (id: number) => ({ id, role: "premium", display_name: `User ${id}`, email: `u${id}@example.test`, subscription_status: "active" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue({ institution: bankX, source: "url" });
  mocks.members.mockResolvedValue([teammate]);
  mocks.invitations.mockResolvedValue([invite]);
  mocks.accessManager.mockImplementation(({ members }: { members: InstitutionWorkspaceMembership[] }) =>
    <ul>{members.map((m) => <li key={m.id}>{m.userEmail}</li>)}</ul>);
});
afterEach(() => cleanup());

describe("Settings team roster across accounts (#1922)", () => {
  it("another bank's Pro user who researches bank X sees none of X's team or invites", async () => {
    mocks.user.mockResolvedValue(pro(9922002));
    mocks.membership.mockResolvedValue(null);
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: String(bankX.id) }) }));
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.invitations).not.toHaveBeenCalled();
    expect(mocks.accessManager).not.toHaveBeenCalled();
    expect(screen.queryByText("teammate@bank-x.example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("new-hire@bank-x.example.test")).not.toBeInTheDocument();
    expect(screen.getByText(/Only people on Synthetic Bank X.s team can see who has access to it\./)).toBeInTheDocument();
  });

  it("a member of bank X sees X's team", async () => {
    mocks.user.mockResolvedValue(pro(9922001));
    mocks.membership.mockResolvedValue({ ...teammate, id: 40, userId: 9922001, role: "owner" });
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: String(bankX.id) }) }));
    expect(mocks.members).toHaveBeenCalledWith(bankX.id);
    expect(mocks.accessManager).toHaveBeenCalledWith(
      expect.objectContaining({ members: [teammate], invitations: [invite], canManage: true }), undefined);
    expect(screen.getByText("teammate@bank-x.example.test")).toBeInTheDocument();
  });

  it("a membership row for another user or bank does not count", async () => {
    mocks.user.mockResolvedValue(pro(9922002));
    mocks.membership.mockResolvedValue({ ...teammate, userId: 9922001 });
    render(await SettingsPage({ searchParams: Promise.resolve({ instId: String(bankX.id) }) }));
    expect(mocks.members).not.toHaveBeenCalled();
    expect(screen.queryByText("teammate@bank-x.example.test")).not.toBeInTheDocument();
  });
});
