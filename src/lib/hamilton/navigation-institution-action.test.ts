import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ user: vi.fn(), institution: vi.fn(), workspace: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("./institution-context", () => ({ getHamiltonInstitutionContext: mocks.institution }));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.workspace }));

import { loadHamiltonNavigationInstitution } from "./navigation-institution-action";

const viewer: User = {
  id: 25, username: "h01-viewer", display_name: "H01 viewer", role: "viewer",
  email: "h01-viewer@example.test", stripe_customer_id: null, subscription_status: "none",
  workspace_seat: true, institution_name: "Unverified profile text", institution_type: null,
  asset_tier: null, state_code: null, fed_district: null, job_role: null, interests: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(viewer);
  mocks.institution.mockResolvedValue({ institution: { id: 8109, name: "Space Coast Credit Union" }, error: null });
  mocks.workspace.mockResolvedValue({ institution: null, error: null, source: "none" });
});

describe("Hamilton navigation institution identity", () => {
  it("rejects signed-out requests before reading institution data", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await loadHamiltonNavigationInstitution("8109")).toBeNull();
    expect(mocks.institution).not.toHaveBeenCalled();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("rejects viewers without premium access before reading institution data", async () => {
    mocks.user.mockResolvedValue({ ...viewer, workspace_seat: false });
    expect(await loadHamiltonNavigationInstitution("8109")).toBeNull();
    expect(mocks.institution).not.toHaveBeenCalled();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each(["", "0", "-1", "8109.5", "8.109e3", "08109", "space-coast", "8109&private=true"])(
    "rejects noncanonical institution input %j before lookup", async value => {
      expect(await loadHamiltonNavigationInstitution(value)).toBeNull();
      expect(mocks.institution).not.toHaveBeenCalled();
      expect(mocks.workspace).not.toHaveBeenCalled();
    },
  );

  it("resolves the selected institution independently of a viewer's account and returns only public identity", async () => {
    mocks.institution.mockResolvedValueOnce({
      institution: { id: 8109, name: "Space Coast Credit Union", privateNote: "never return", city: "Melbourne" }, error: null,
    }).mockResolvedValueOnce({ institution: { id: 1535, name: "Addition Financial Credit Union" }, error: null });
    expect(await loadHamiltonNavigationInstitution(" 8109 ")).toEqual({ id: "8109", name: "Space Coast Credit Union" });
    expect(await loadHamiltonNavigationInstitution("1535")).toEqual({ id: "1535", name: "Addition Financial Credit Union" });
    expect(mocks.institution.mock.calls).toEqual([["8109"], ["1535"]]);
    expect(mocks.user).toHaveBeenCalledTimes(2);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("reads the authenticated user's fresh saved preference on every bare Hamilton URL", async () => {
    mocks.workspace.mockResolvedValueOnce({ institution: { id: 8109, name: "Space Coast Credit Union" }, source: "manual", error: null })
      .mockResolvedValueOnce({ institution: { id: 1535, name: "Addition Financial Credit Union" }, source: "manual", error: null });
    expect(await loadHamiltonNavigationInstitution(null)).toEqual({ id: "8109", name: "Space Coast Credit Union" });
    expect(await loadHamiltonNavigationInstitution(null)).toEqual({ id: "1535", name: "Addition Financial Credit Union" });
    expect(mocks.workspace.mock.calls).toEqual([
      [{ userId: 25, persistUrlSelection: false }], [{ userId: 25, persistUrlSelection: false }],
    ]);
    expect(mocks.institution).not.toHaveBeenCalled();
  });

  it.each([null, { ...viewer, workspace_seat: false }])(
    "does not read a saved preference without authenticated premium access", async user => {
      mocks.user.mockResolvedValue(user);
      expect(await loadHamiltonNavigationInstitution(null)).toBeNull();
      expect(mocks.workspace).not.toHaveBeenCalled();
      expect(mocks.institution).not.toHaveBeenCalled();
    },
  );

  it("withholds the identity when the saved-preference read fails", async () => {
    mocks.workspace.mockRejectedValue(new Error("saved preference unavailable"));
    expect(await loadHamiltonNavigationInstitution(null)).toBeNull();
    expect(mocks.institution).not.toHaveBeenCalled();
  });

  it("does not assign profile text when a bare URL has no canonical saved preference", async () => {
    mocks.workspace.mockResolvedValue({ institution: null, profileLabel: "Unverified profile text", source: "none", error: null });
    expect(await loadHamiltonNavigationInstitution(null)).toBeNull();
    expect(mocks.institution).not.toHaveBeenCalled();
  });

  it("withholds a saved preference without a canonical ID or name", async () => {
    mocks.workspace.mockResolvedValueOnce({ institution: { id: 1535, name: " " }, source: "manual", error: null })
      .mockResolvedValueOnce({ institution: { id: 0, name: "Unverified profile text" }, source: "profile", error: null });
    expect(await loadHamiltonNavigationInstitution(null)).toBeNull();
    expect(await loadHamiltonNavigationInstitution(null)).toBeNull();
  });

  it("returns no identity when authentication fails", async () => {
    mocks.user.mockRejectedValue(new Error("session unavailable"));
    expect(await loadHamiltonNavigationInstitution("8109")).toBeNull();
    expect(mocks.institution).not.toHaveBeenCalled();
  });

  it("returns no identity when institution lookup fails", async () => {
    mocks.institution.mockRejectedValue(new Error("institution lookup unavailable"));
    expect(await loadHamiltonNavigationInstitution("8109")).toBeNull();
  });

  it("does not replace a missing canonical institution with profile text", async () => {
    mocks.institution.mockResolvedValue({ institution: null, error: "Institution not found" });
    expect(await loadHamiltonNavigationInstitution("8109")).toBeNull();
  });

  it("withholds a blank canonical name", async () => {
    mocks.institution.mockResolvedValue({ institution: { id: 8109, name: " \n " }, error: null });
    expect(await loadHamiltonNavigationInstitution("8109")).toBeNull();
  });

  it("withholds a mismatched canonical institution rather than relabeling the URL", async () => {
    mocks.institution.mockResolvedValue({ institution: { id: 1535, name: "Addition Financial Credit Union" }, error: null });
    expect(await loadHamiltonNavigationInstitution("8109")).toBeNull();
  });
});
