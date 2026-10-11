import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), headers: vi.fn(), resolve: vi.fn(), artifact: vi.fn(), account: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: async () => new Map() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/components/hamilton/layout/HamiltonShell", () => ({ HamiltonShell: () => null }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/lib/hamilton/artifact-context-store", () => ({ getHamiltonArtifactInstitutionId: mocks.artifact }));
vi.mock("@/lib/hamilton/account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
import HamiltonLayout from "./layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: 25, role: "premium", subscription_status: "active", institution_name: "Unverified profile name" });
  mocks.account.mockResolvedValue({ status: "identified", institution: { id: 8109, name: "Space Coast Federal Credit Union" } });
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "/pro/reports?report_id=saved-a&instId=1535" }));
  mocks.artifact.mockImplementation(async ({ lookup }) => lookup?.kind === "report" ? "8109" : null);
  mocks.resolve.mockImplementation(async ({ instId }) => ({ institution: { id: Number(instId ?? 1535), name: instId === "8109" ? "Original saved A" : "Addition research preference" }, source: "artifact", isWorkspaceBank: false }));
});

async function props() {
  const inner = HamiltonLayout({ children: null }).props.children;
  return (await inner.type(inner.props)).props;
}

it("keeps reopened report A's authorized subject when the URL points at B", async () => {
  const value = await props();
  expect(mocks.artifact).toHaveBeenCalledWith({ userId: 25, lookup: { kind: "report", artifactId: "saved-a" } });
  expect(value.selectedInstitutionId).toBe("8109");
  expect(value.institutionContext.name).toBe("Original saved A");
  expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ instId: "8109", transientSource: "artifact", persistUrlSelection: false }));
});

it.each(["legacy unscoped", "unavailable private"])("does not borrow B for a %s saved report", async (kind) => {
  // The stored-preference mock would produce B even with no URL institution.
  if (kind === "legacy unscoped") mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "/pro/reports?report_id=legacy" }));
  mocks.artifact.mockResolvedValue(null);
  const value = await props();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(value.selectedInstitutionId).toBeNull();
  expect(value.institutionContext.name).toContain("research subject unavailable");
});

it("does not show profile text as unresolved canonical research metadata", async () => {
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "/pro/research?instId=999999" }));
  mocks.resolve.mockResolvedValue({ institution: null, source: "none", isWorkspaceBank: false });
  const value = await props();
  expect(value.institutionContext).toMatchObject({ name: null, type: null, assetTier: null, fedDistrict: null, selectedSource: "none" });
});
