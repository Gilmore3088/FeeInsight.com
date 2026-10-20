import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getInstitutionById: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  hasPermission: (user: { role: string }, permission: string) =>
    permission === "operate" && (user.role === "admin" || user.role === "analyst"),
}));
vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
  getRequestSubjectKey: vi.fn(() => "test"),
}));
vi.mock("@/lib/api-hardening/rate-limit", () => ({ isRateLimited: vi.fn(async () => false) }));
vi.mock("@/lib/data-store", () => ({
  getInstitutionById: mocks.getInstitutionById,
  getFeesByInstitution: vi.fn(async () => []),
  getFinancialsByInstitution: vi.fn(async () => []),
}));
vi.mock("@/lib/data-store/call-reports", () => ({
  getInstitutionPeerRanking: vi.fn(async () => null),
  getInstitutionRevenueTrend: vi.fn(async () => []),
}));
vi.mock("@/lib/data-store/institution", () => ({
  getInstitutionFeeScheduleEvidence: vi.fn(async () => null),
  getInstitutionSubmissionState: vi.fn(async () => ({ status: "none" })),
}));
vi.mock("@/lib/automation-control", () => ({ getAutomationControl: vi.fn(async () => null) }));

import { GET } from "./route";

function get(id: string) {
  return GET(new Request(`http://localhost/api/institutions/${id}/evidence`), { params: Promise.resolve({ id }) });
}

describe("/api/institutions/[id]/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInstitutionById.mockResolvedValue({ id: 7, institution_name: "Harbor Bank" });
  });

  it("refuses anonymous and non-staff callers before any database read", async () => {
    for (const user of [null, { role: "viewer" }, { role: "premium" }]) {
      mocks.getCurrentUser.mockResolvedValueOnce(user);
      expect((await get("7")).status).toBe(401);
    }
    expect(mocks.getInstitutionById).not.toHaveBeenCalled();
  });

  it("serves staff", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ role: "analyst" });
    const response = await get("7");
    expect(response.status).toBe(200);
    expect((await response.json()).institution_id).toBe(7);
  });
});
