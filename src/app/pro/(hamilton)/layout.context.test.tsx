import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), headers: vi.fn(), resolve: vi.fn(), artifact: vi.fn(), account: vi.fn(), pendingLink: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: async () => new Map() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/components/hamilton/layout/HamiltonShell", () => ({ HamiltonShell: () => null }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/lib/hamilton/artifact-context-store", () => ({ getHamiltonArtifactInstitutionId: mocks.artifact }));
vi.mock("@/lib/hamilton/account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
vi.mock("@/lib/data-store/connection", () => ({ sql: "db" }));
vi.mock("@/lib/pro-institution-link", () => ({ getPendingInstitutionLink: mocks.pendingLink }));
import HamiltonLayout from "./layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: 25, role: "premium", subscription_status: "active", institution_name: "Unverified profile name" });
  mocks.account.mockResolvedValue({ status: "identified", institution: { id: 8109, name: "Space Coast Federal Credit Union" } });
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "/pro/reports?report_id=saved-a&instId=1535" }));
  mocks.pendingLink.mockResolvedValue(null);
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

it.each(["scenario", "scenario_id"])("keeps a reopened simulation's subject in the shell (%s)", async (alias) => {
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": `/pro/simulate?${alias}=saved-a&instId=1535` }));
  mocks.artifact.mockResolvedValue("8109");
  const value = await props();
  expect(mocks.artifact).toHaveBeenCalledWith({ userId: 25, lookup: { kind: "scenario", artifactId: "saved-a" } });
  expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ instId: "8109", transientSource: "artifact", persistUrlSelection: false }));
  expect(value.selectedInstitutionId).toBe("8109");
  expect(value.institutionContext.name).toBe("Original saved A");
});

it.each(["missing", "unscoped"])("leaves the shell unscoped for a %s saved simulation", async () => {
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "/pro/simulate?scenario_id=saved-a&instId=1535" }));
  mocks.artifact.mockResolvedValue(null);
  const value = await props();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(value.selectedInstitutionId).toBeNull();
  expect(value.institutionContext.name).toBeNull();
});

it.each([
  ["/pro/simulate?scenario_id=saved-a&instId=1535", "scenario"],
  ["/pro/reports?report_id=saved-a", "report"],
])("surfaces a failed saved-artifact read at %s instead of an empty shell", async (path, kind) => {
  // A failed read is not a missing artifact: it is logged with context and reaches the Pro error
  // boundary (Hamilton's error state), never silently turned into "no saved institution".
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": path }));
  const failure = new Error("Synthetic database failure");
  mocks.artifact.mockRejectedValue(failure);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(props()).rejects.toBe(failure);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(
      "[hamilton-shell] saved artifact context read failed",
      expect.objectContaining({ userId: 25, kind, artifactId: "saved-a", pathname: path.split("?")[0] }),
      failure,
    );
  } finally {
    logged.mockRestore();
  }
});

it.each(["legacy unscoped", "unavailable private"])("does not borrow B for a %s saved report", async (kind) => {
  // The stored-preference mock would produce B even with no URL institution.
  if (kind === "legacy unscoped") mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "/pro/reports?report_id=legacy" }));
  mocks.artifact.mockResolvedValue(null);
  const value = await props();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(value.selectedInstitutionId).toBeNull();
  expect(value.institutionContext.name).toBeNull();
});

it("does not show profile text as unresolved canonical research metadata", async () => {
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": "/pro/research?instId=999999" }));
  mocks.resolve.mockResolvedValue({ institution: null, source: "none", isWorkspaceBank: false });
  const value = await props();
  expect(value.institutionContext).toMatchObject({ name: null, type: null, assetTier: null, fedDistrict: null, selectedSource: "none" });
});

it("names a pending link request in the bar when the account has no membership (id as text)", async () => {
  // postgres.js returns users.id (bigint) as a string.
  mocks.user.mockResolvedValue({ id: "26", role: "premium", subscription_status: "active", institution_name: "Capital City Bank" });
  mocks.account.mockResolvedValue({ status: "unlinked", institution: null });
  mocks.pendingLink.mockResolvedValue({ institutionName: "Capital City Bank", emailConfirmed: true, needsInfo: false });
  const value = await props();
  expect(mocks.pendingLink).toHaveBeenCalledWith("db", "26");
  expect(value.pendingInstitution).toEqual({ name: "Capital City Bank", needsInfo: false });
});

it("does not read a pending request once a membership links the account", async () => {
  const value = await props();
  expect(mocks.pendingLink).not.toHaveBeenCalled();
  expect(value.pendingInstitution).toBeNull();
});
