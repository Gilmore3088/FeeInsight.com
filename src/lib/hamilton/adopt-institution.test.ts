import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getInstitutionById: vi.fn(),
  setHamiltonWorkspaceContext: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: mocks.getInstitutionById }));
vi.mock("./workspace-context", () => ({ setHamiltonWorkspaceContext: mocks.setHamiltonWorkspaceContext }));

import { adoptInstitution } from "./adopt-institution";

describe("adoptInstitution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sql.mockResolvedValue([]);
    mocks.getInstitutionById.mockResolvedValue({
      id: 2945,
      institution_name: "First Bank",
      charter_type: "bank",
      asset_size_tier: "community",
      state_code: "GA",
      fed_district: 6,
    });
  });

  it("fills the profile from the institution and anchors the Pro workspace", async () => {
    const result = await adoptInstitution({ userId: 7, institutionId: 2945, setWorkspace: true, source: "profile", intent: "onboarding" });

    expect(result).toEqual({ id: 2945, name: "First Bank" });
    const values = mocks.sql.mock.calls[0].slice(1);
    expect(values).toEqual(["First Bank", "bank", "community", "GA", 6, 7]);
    expect(mocks.setHamiltonWorkspaceContext).toHaveBeenCalledWith({
      userId: 7,
      institutionId: 2945,
      source: "profile",
      intent: "onboarding",
    });
  });

  it("leaves the workspace alone for non-Pro users", async () => {
    await adoptInstitution({ userId: 7, institutionId: 2945, setWorkspace: false, source: "profile" });

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    expect(mocks.setHamiltonWorkspaceContext).not.toHaveBeenCalled();
  });

  it("changes nothing for an unknown institution", async () => {
    mocks.getInstitutionById.mockResolvedValue(null);

    expect(await adoptInstitution({ userId: 7, institutionId: 1, setWorkspace: true, source: "profile" })).toBeNull();
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.setHamiltonWorkspaceContext).not.toHaveBeenCalled();
  });
});
