import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  canAccessPremium: vi.fn(),
  sql: vi.fn(),
  adoptInstitution: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser, logout: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.canAccessPremium }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/hamilton/adopt-institution", () => ({ adoptInstitution: mocks.adoptInstitution }));

import { saveOnboardingProfile } from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("saveOnboardingProfile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7 });
    mocks.sql.mockResolvedValue([]);
    mocks.adoptInstitution.mockResolvedValue({ id: 2945, name: "First Bank" });
  });

  it("saves a picked institution and sets the Pro workspace context", async () => {
    mocks.canAccessPremium.mockReturnValue(true);

    const result = await saveOnboardingProfile(form({ institution_id: "2945", job_role: "marketing" }));

    expect(result).toEqual({ success: true, institutionName: "First Bank" });
    expect(mocks.adoptInstitution).toHaveBeenCalledWith({
      userId: 7,
      institutionId: 2945,
      setWorkspace: true,
      source: "profile",
      intent: "onboarding",
    });
  });

  it("only fills the profile for a user without Pro", async () => {
    mocks.canAccessPremium.mockReturnValue(false);

    await saveOnboardingProfile(form({ institution_id: "2945" }));

    expect(mocks.adoptInstitution).toHaveBeenCalledWith(expect.objectContaining({ setWorkspace: false }));
  });

  it("keeps a free-text organization when no institution is picked", async () => {
    const result = await saveOnboardingProfile(form({ institution_name: "Acme Advisory", institution_type: "consulting" }));

    expect(result).toEqual({ success: true });
    expect(mocks.adoptInstitution).not.toHaveBeenCalled();
    expect(mocks.sql.mock.calls[1].slice(1)).toEqual(["Acme Advisory", "consulting", 7]);
  });

  it("reports an institution that no longer exists", async () => {
    mocks.adoptInstitution.mockResolvedValue(null);

    const result = await saveOnboardingProfile(form({ institution_id: "99" }));

    expect(result.success).toBe(false);
  });
});
