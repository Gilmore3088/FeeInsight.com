import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuth = vi.fn();
const retryAdminFeeRefresh = vi.fn();
const recordPublicCacheRefresh = vi.fn();
const invalidatePublicReadCache = vi.fn(() => true);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: (permission: string) => requireAuth(permission) }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: () => invalidatePublicReadCache() }));
vi.mock("@/lib/fee-admin-run", () => ({
  retryAdminFeeRefresh: (...args: unknown[]) => retryAdminFeeRefresh(...args),
  recordPublicCacheRefresh: (...args: unknown[]) => recordPublicCacheRefresh(...args),
}));
vi.mock("@/lib/institution-commands", () => ({}));

import { retryFeeRefresh } from "./actions";

// H03-T08 (#978): retrying a refresh is an admin action (`edit`); it records the cache clear on
// the retry run only after the retry has committed.
describe("retryFeeRefresh", () => {
  beforeEach(() => {
    requireAuth.mockReset();
    retryAdminFeeRefresh.mockReset();
    recordPublicCacheRefresh.mockReset();
  });

  it("should_require_the_edit_permission_before_anything_runs", async () => {
    requireAuth.mockRejectedValue(new Error("forbidden"));
    await expect(retryFeeRefresh(41)).rejects.toThrow("forbidden");
    expect(requireAuth).toHaveBeenCalledWith("edit");
    expect(retryAdminFeeRefresh).not.toHaveBeenCalled();
  });

  it("should_retry_then_clear_the_caches_and_record_it_on_the_retry_run", async () => {
    requireAuth.mockResolvedValue({ id: 1, display_name: "James", username: "james", role: "admin" });
    retryAdminFeeRefresh.mockResolvedValue({ ok: true, runId: 50, retryOf: 41, institutionId: 7, indexRefreshed: true });
    const result = await retryFeeRefresh(41);
    expect(result).toMatchObject({ ok: true, runId: 50 });
    expect(retryAdminFeeRefresh).toHaveBeenCalledWith(expect.anything(), 41, { id: 1, name: "James" });
    expect(recordPublicCacheRefresh).toHaveBeenCalledWith(expect.anything(), 50, true);
  });

  it("should_refuse_a_bad_run_id_without_a_retry", async () => {
    requireAuth.mockResolvedValue({ id: 1, display_name: null, username: "james", role: "admin" });
    expect(await retryFeeRefresh(-3)).toEqual({ ok: false, error: "Choose a run to retry." });
    expect(retryAdminFeeRefresh).not.toHaveBeenCalled();
  });
});
