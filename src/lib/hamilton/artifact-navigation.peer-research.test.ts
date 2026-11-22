import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeLandingResearch } from "./landing-research-handoff";

// Current API/unit coverage after the genuine existing-route RED. Canned SQL rows do
// not claim native database authorization; the exact bound user and active-row read are checked.
const mocks = vi.hoisted(() => ({ user: vi.fn(), premium: vi.fn(), sql: vi.fn(), institution: vi.fn(), workspace: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("./institution-context", () => ({ getHamiltonInstitutionContext: mocks.institution }));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.workspace }));

import { getHamiltonArtifactInstitutionId } from "./artifact-context-store";
import { loadHamiltonArtifactNavigationInstitution } from "./navigation-institution-action";

const SAVED = "00000000-0000-4000-8000-000009701701";
const PATH = `/pro/peer-research/${SAVED}`;
const snapshot = () => ({ version: 1, status: "ready", subject: { institutionId: 9701001 }, rows: [{ institutionId: 9701003 }] });
const storeRead = () => getHamiltonArtifactInstitutionId({ userId: 25, lookup: { kind: "peer-research", artifactId: SAVED } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 25, role: "premium" }); mocks.premium.mockReturnValue(true);
  mocks.sql.mockResolvedValue([{ institution_id: "9701001", peer_list_snapshot: snapshot() }]);
  mocks.institution.mockResolvedValue({ institution: { id: 9701001, name: "Saved subject A", privateNote: "not public", charterType: "credit_union", stateCode: "FL" } });
  mocks.workspace.mockRejectedValue(new Error("Artifact navigation must not request a default workspace"));
});

describe("typed saved-peer storage prerequisites", () => {
  it("reads the exact owned active analysis and requires its matching peer snapshot", async () => {
    expect(await storeRead()).toBe("9701001");
    const [parts, ...values] = mocks.sql.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(values).toEqual([SAVED, 25]);
    const query = parts.join("?");
    expect(query).toContain("hamilton_saved_analyses"); expect(query).toContain("user_id ="); expect(query).toContain("status = 'active'"); expect(query).toContain("peerListSnapshot");
  });

  it.each([
    null,
    { ...snapshot(), version: 2 },
    { ...snapshot(), status: "pending" },
    { ...snapshot(), subject: null },
    { ...snapshot(), subject: { institutionId: 9701002 } },
    { ...snapshot(), rows: {} },
    JSON.stringify(snapshot()),
  ])("refuses absent, mismatched or malformed saved peer content (%j)", async (peer_list_snapshot) => {
    mocks.sql.mockResolvedValue([{ institution_id: "9701001", peer_list_snapshot }]);
    expect(await storeRead()).toBeNull();
  });

  it.each([null, "", "0", "institution-name", "9701001.5"])("does not turn invalid institution identity into a subject (%j)", async (institution_id) => {
    mocks.sql.mockResolvedValue([{ institution_id, peer_list_snapshot: snapshot() }]);
    expect(await storeRead()).toBeNull();
  });

  it("does not query a malformed path ID", async () => {
    expect(await getHamiltonArtifactInstitutionId({ userId: 25, lookup: { kind: "peer-research", artifactId: "not-an-id" } })).toBeNull();
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});

describe("authenticated saved-artifact client identity action", () => {
  it.each([
    "instId=9701002",
    new URLSearchParams({ instId: "9701002", research: encodeLandingResearch({ version: 1, task: "compare", scope: { kind: "local", institutionId: 9701002 }, categories: ["nsf"], charter: "credit_union" }) }).toString(),
    "research=invalid&instId=9701002",
  ])("resolves path A using its current user even when query asks for B (%s)", async (search) => {
    const result = await loadHamiltonArtifactNavigationInstitution(PATH, search);
    expect(result).toMatchObject({ id: "9701001", name: "Saved subject A" });
    expect(Object.keys(result ?? {}).sort()).toEqual(["facts", "id", "name"]);
    expect(mocks.sql.mock.calls[0].slice(1)).toEqual([SAVED, 25]);
    expect(mocks.institution).toHaveBeenCalledWith("9701001");
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("not public");
  });

  it.each(["missing", "wrong-owner", "inactive"])("does not fall back when the authorized active record read is empty (%s)", async () => {
    mocks.sql.mockResolvedValue([]);
    expect(await loadHamiltonArtifactNavigationInstitution(PATH, "instId=9701002")).toBeNull();
    expect(mocks.institution).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("rechecks the authenticated user on every invocation instead of caching prior owner A", async () => {
    expect(await loadHamiltonArtifactNavigationInstitution(PATH, "")).toMatchObject({ id: "9701001" });
    mocks.user.mockResolvedValue({ id: 26, role: "premium" }); mocks.sql.mockResolvedValue([]);
    expect(await loadHamiltonArtifactNavigationInstitution(PATH, "")).toBeNull();
    expect(mocks.sql.mock.calls.map(call => call.slice(1))).toEqual([[SAVED, 25], [SAVED, 26]]);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each(["signed-out", "not-premium", "auth-error"])("does not read saved data without current authorized access (%s)", async (state) => {
    if (state === "signed-out") mocks.user.mockResolvedValue(null);
    if (state === "not-premium") mocks.premium.mockReturnValue(false);
    if (state === "auth-error") mocks.user.mockRejectedValue(new Error("fixture auth unavailable"));
    expect(await loadHamiltonArtifactNavigationInstitution(PATH, "instId=9701002")).toBeNull();
    expect(mocks.sql).not.toHaveBeenCalled(); expect(mocks.institution).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("withholds a mismatched public identity and does not use a default", async () => {
    mocks.institution.mockResolvedValue({ institution: { id: 9701002, name: "Wrong B" } });
    expect(await loadHamiltonArtifactNavigationInstitution(PATH, "")).toBeNull();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each(["store", "public-identity"])("returns no subject when %s is unavailable", async (failure) => {
    if (failure === "store") mocks.sql.mockRejectedValue(new Error("fixture read unavailable"));
    else mocks.institution.mockRejectedValue(new Error("public identity unavailable"));
    expect(await loadHamiltonArtifactNavigationInstitution(PATH, "instId=9701002")).toBeNull();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("bounds path/search before authentication or data reads", async () => {
    expect(await loadHamiltonArtifactNavigationInstitution("x".repeat(1025), "")).toBeNull();
    expect(await loadHamiltonArtifactNavigationInstitution(PATH, "x".repeat(8193))).toBeNull();
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.sql).not.toHaveBeenCalled();
  });
});
