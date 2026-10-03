import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  addAlertSubscription: vi.fn(),
  removeAlertSubscription: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
  getRequestSubjectKey: vi.fn(() => "test"),
}));
vi.mock("@/lib/data-store/alerts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data-store/alerts")>("@/lib/data-store/alerts");
  return {
    normalizeAlertCategories: actual.normalizeAlertCategories,
    addAlertSubscription: mocks.addAlertSubscription,
    removeAlertSubscription: mocks.removeAlertSubscription,
  };
});

import { DELETE, POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7 });
    mocks.sql.mockResolvedValue([{ id: 3 }]);
    mocks.addAlertSubscription.mockResolvedValue({ id: 11, fee_categories: ["overdraft"] });
  });

  it("requires a session", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await post({ institution_id: 3 })).status).toBe(401);
  });

  it("rejects categories outside the fee taxonomy", async () => {
    const response = await post({ institution_id: 3, fee_categories: ["made_up"] });
    expect(response.status).toBe(400);
    expect(mocks.addAlertSubscription).not.toHaveBeenCalled();
  });

  it("saves taxonomy categories by merging", async () => {
    const response = await post({ institution_id: 3, fee_categories: ["overdraft"] });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 11, fee_categories: ["overdraft"] });
    expect(mocks.addAlertSubscription).toHaveBeenCalledWith(7, 3, ["overdraft"]);
  });

  it("does not leak database errors", async () => {
    mocks.addAlertSubscription.mockRejectedValue(new Error("relation users does not exist"));
    const response = await post({ institution_id: 3 });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("relation");
  });

  it("removes by query parameter without a body", async () => {
    mocks.removeAlertSubscription.mockResolvedValue(true);
    const response = await DELETE(new NextRequest("http://localhost/api/alerts?institution_id=3", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(mocks.removeAlertSubscription).toHaveBeenCalledWith(7, 3);
  });

  it("rejects a malformed institution id", async () => {
    const response = await DELETE(new NextRequest("http://localhost/api/alerts?institution_id=abc", { method: "DELETE" }));
    expect(response.status).toBe(400);
  });
});
