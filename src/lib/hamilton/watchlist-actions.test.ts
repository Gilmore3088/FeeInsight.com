import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getCurrentUser: vi.fn(),
  canAccessPremium: vi.fn(),
  getHamiltonInstitutionContext: vi.fn(),
  setHamiltonWorkspaceContext: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.canAccessPremium }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ setHamiltonWorkspaceContext: mocks.setHamiltonWorkspaceContext }));
vi.mock("@/lib/hamilton/institution-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hamilton/institution-context")>()),
  getHamiltonInstitutionContext: mocks.getHamiltonInstitutionContext,
}));

import { addToWatchlist } from "@/app/pro/(hamilton)/monitor/actions";
import { MAX_WATCHLIST_INSTITUTIONS } from "./monitor-data";

describe("addToWatchlist", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7 });
    mocks.canAccessPremium.mockReturnValue(true);
    mocks.setHamiltonWorkspaceContext.mockResolvedValue(undefined);
    mocks.getHamiltonInstitutionContext.mockResolvedValue({
      institution: { id: 9999, name: "New Bank", feePublicationStatus: "published", feePublicationLabel: "Published" },
      error: null,
    });
  });

  it("refuses to grow a full watchlist", async () => {
    const full = Array.from({ length: MAX_WATCHLIST_INSTITUTIONS }, (_, i) => String(i + 1));
    mocks.sql.mockResolvedValueOnce([{ id: 1, institution_ids: full }]);

    const result = await addToWatchlist("9999");

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("watchlist is full") });
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it("adds below the limit", async () => {
    mocks.sql.mockResolvedValueOnce([{ id: 1, institution_ids: ["1"] }]).mockResolvedValue([]);

    const result = await addToWatchlist("9999");

    expect(result.ok).toBe(true);
    expect(mocks.sql.mock.calls[1][1]).toBe(JSON.stringify(["1", "9999"]));
  });
});
