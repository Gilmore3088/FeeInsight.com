import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeLandingResearch } from "./landing-research-handoff";
import { getHamiltonArtifactContextLookup } from "./artifact-context";

// Independent S01–S03: the saved page reads this path ID, so the shell must use the
// same authorized analysis. A different workspace preference must never fill a gap.
const SAVED = "00000000-0000-4000-8000-000009701701";
const OTHER = "00000000-0000-4000-8000-000009701702";
const PATH = `/pro/peer-research/${SAVED}`;
const researchB = encodeLandingResearch({ version: 1, task: "compare", scope: { kind: "local", institutionId: 9701002 }, categories: ["nsf"], charter: "credit_union" });

describe("saved peer research path identity", () => {
  it.each([
    "",
    "instId=9701002",
    `analysis=${OTHER}&instId=9701002`,
    `report_id=${OTHER}&scenario_id=${OTHER}`,
    new URLSearchParams({ research: researchB, instId: "9701002" }).toString(),
  ])("resolves the saved page's path analysis before query context (%s)", (query) => {
    expect(getHamiltonArtifactContextLookup({ pathname: PATH, searchParams: new URLSearchParams(query) }))
      .toEqual({ kind: "peer-research", artifactId: SAVED });
  });

  it("does not confuse a similarly named route with saved peer research", () => {
    expect(getHamiltonArtifactContextLookup({ pathname: `/pro/peer-researcher/${SAVED}`, searchParams: new URLSearchParams("instId=9701002") }))
      .toBeNull();
  });
});

const mocks = vi.hoisted(() => ({ user: vi.fn(), headers: vi.fn(), artifact: vi.fn(), resolve: vi.fn(), account: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: async () => new Map() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/components/hamilton/layout/HamiltonShell", () => ({ HamiltonShell: () => null }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("@/lib/hamilton/artifact-context-store", () => ({ getHamiltonArtifactInstitutionId: mocks.artifact }));
vi.mock("@/lib/hamilton/account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
vi.mock("@/lib/hamilton/peer-index", () => ({ getActivePeerSet: async () => null }));
vi.mock("@/lib/data-store/connection", () => ({ sql: "unused fixture database" }));
vi.mock("@/lib/pro-institution-link", () => ({ getPendingInstitutionLink: async () => null }));

import HamiltonLayout from "@/app/pro/(hamilton)/layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: 25, role: "premium", subscription_status: "active" });
  mocks.account.mockResolvedValue({ status: "identified", institution: { id: 9701002, name: "Selected B" } });
  mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": `${PATH}?instId=9701002` }));
  mocks.artifact.mockImplementation(async ({ lookup }) => lookup?.kind === "peer-research" && lookup.artifactId === SAVED ? "9701001" : null);
  mocks.resolve.mockImplementation(async ({ instId }) => ({
    institution: { id: Number(instId ?? 9701002), name: instId === "9701001" ? "Saved subject A" : "Selected B" },
    source: instId === "9701001" ? "artifact" : "workspace", isWorkspaceBank: false,
  }));
});

async function shellProps() {
  const inner = HamiltonLayout({ children: null }).props.children;
  return (await inner.type(inner.props)).props;
}

describe("real Hamilton layout composes saved peer context", () => {
  it.each([
    `${PATH}?instId=9701002`,
    `${PATH}?${new URLSearchParams({ research: researchB, instId: "9701002" })}`,
    `${PATH}?research=invalid&instId=9701002`,
  ])("uses authorized A rather than URL, research or workspace B (%s)", async (path) => {
    mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": path }));
    const value = await shellProps();
    expect(mocks.artifact).toHaveBeenCalledWith({ userId: 25, lookup: { kind: "peer-research", artifactId: SAVED } });
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: 25, instId: "9701001", transientSource: "artifact", persistUrlSelection: false }));
    expect(value.selectedInstitutionId).toBe("9701001");
    expect(value.institutionContext.name).toBe("Saved subject A");
  });

  it.each(["missing", "wrong-owner", "inactive", "unscoped"])("does not borrow B when authorized storage returns no institution (%s)", async () => {
    // This is a layout-composition test. Native storage authorization is separately tested;
    // each of these failures is represented by its existing authorized-store null result.
    mocks.artifact.mockResolvedValue(null);
    const value = await shellProps();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(value.selectedInstitutionId).toBeNull();
    expect(value.institutionContext.name).toBeNull();
  });

  it.each(["/pro/peer-research", "/pro/peer-research/", "/pro/peer-research/not-a-uuid", `${PATH}/extra`])("never fills an invalid saved-path request with workspace B (%s)", async (path) => {
    mocks.headers.mockResolvedValue(new Headers({ "x-invoke-path": `${path}?instId=9701002` }));
    mocks.artifact.mockResolvedValue(null);
    const value = await shellProps();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(value.selectedInstitutionId).toBeNull();
  });

  it("preserves an authorized saved-context read error rather than substituting B", async () => {
    const failure = new Error("fixture saved-context read unavailable");
    mocks.artifact.mockRejectedValue(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(shellProps()).rejects.toBe(failure);
      expect(mocks.resolve).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
