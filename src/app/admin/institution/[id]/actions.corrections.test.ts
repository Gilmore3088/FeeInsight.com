import { beforeEach, describe, expect, it, vi } from "vitest";

// H03-T11 (#978): the admin correction actions under attack. Only role=admin corrects; a database
// failure says nothing changed and refreshes nothing; a refresh that fails after the commit never
// reports the committed correction as lost.

const requireAuth = vi.fn();
const revalidatePath = vi.fn();
const invalidatePublicReadCache = vi.fn(() => true);
const recordPublicCacheRefresh = vi.fn();
const service = vi.hoisted(() => ({ correct: vi.fn<(...args: unknown[]) => unknown>(), reverse: vi.fn<(...args: unknown[]) => unknown>(), dismiss: vi.fn<(...args: unknown[]) => unknown>(), actual: null as null | typeof import("@/lib/fee-corrections") }));
const db = vi.hoisted(() => ({ sql: Object.assign(vi.fn(), { begin: vi.fn() }) }));

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock("@/lib/auth", () => ({ requireAuth: (permission: string) => requireAuth(permission) }));
vi.mock("@/lib/data-store/connection", () => ({ sql: db.sql }));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: () => invalidatePublicReadCache() }));
vi.mock("@/lib/fee-admin-run", () => ({
  retryAdminFeeRefresh: vi.fn(),
  recordPublicCacheRefresh: (...args: unknown[]) => recordPublicCacheRefresh(...args),
}));
vi.mock("@/lib/institution-commands", () => ({}));
vi.mock("@/lib/fee-corrections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fee-corrections")>();
  service.actual = actual;
  return {
    ...actual,
    correctPublishedFee: (...args: Parameters<typeof actual.correctPublishedFee>) => service.correct(...args),
    reverseFeeCorrection: (...args: Parameters<typeof actual.reverseFeeCorrection>) => service.reverse(...args),
    dismissCorrectionConflict: (...args: Parameters<typeof actual.dismissCorrectionConflict>) => service.dismiss(...args),
  };
});

import { correctFee, dismissConflict, reverseCorrection } from "./actions";

const user = (role: string) => ({ id: 3, display_name: "Operator", username: "op", role });
const input = { feePublishedId: 500, expectedVersion: 0, idempotencyKey: "key-0000000001" };
const saved = { ok: true, correctionId: 11, version: 1, feePublishedId: 501, previousFeePublishedId: 500, institutionId: 7, runId: 70, indexRefreshed: true, replay: false };

beforeEach(() => {
  vi.clearAllMocks();
  invalidatePublicReadCache.mockReturnValue(true);
  revalidatePath.mockImplementation(() => undefined);
  // By default the real service runs, so its role check is the one under test.
  service.correct.mockImplementation((...args) => service.actual!.correctPublishedFee(...(args as Parameters<typeof import("@/lib/fee-corrections").correctPublishedFee>)));
  service.reverse.mockImplementation((...args) => service.actual!.reverseFeeCorrection(...(args as Parameters<typeof import("@/lib/fee-corrections").reverseFeeCorrection>)));
  service.dismiss.mockImplementation((...args) => service.actual!.dismissCorrectionConflict(...(args as Parameters<typeof import("@/lib/fee-corrections").dismissCorrectionConflict>)));
});

describe("who may correct", () => {
  it("should_stop_a_viewer_at_the_permission_check", async () => {
    requireAuth.mockRejectedValue(new Error("Forbidden"));
    await expect(correctFee(input)).rejects.toThrow("Forbidden");
    expect(requireAuth).toHaveBeenCalledWith("approve");
    expect(service.correct).not.toHaveBeenCalled();
  });

  for (const role of ["analyst", "premium", "viewer"]) {
    it(`should_refuse_${role}_with_no_query_and_no_refresh`, async () => {
      requireAuth.mockResolvedValue(user(role));
      expect(await correctFee(input)).toMatchObject({ ok: false, code: "forbidden" });
      expect(await reverseCorrection(input)).toMatchObject({ ok: false, code: "forbidden" });
      expect((await dismissConflict(4, "Older schedule text")).ok).toBe(false);
      expect(db.sql).not.toHaveBeenCalled();
      expect(db.sql.begin).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(invalidatePublicReadCache).not.toHaveBeenCalled();
    });
  }

  it("should_pass_the_signed_in_role_never_a_role_from_the_form", async () => {
    requireAuth.mockResolvedValue(user("analyst"));
    service.correct.mockResolvedValue(saved);
    await correctFee({ ...input, role: "admin", actor: { role: "admin" } });
    expect(service.correct).toHaveBeenCalledWith(db.sql, expect.anything(), { id: 3, name: "Operator", role: "analyst" });
  });
});

describe("database failure", () => {
  it("should_say_nothing_changed_and_refresh_nothing_when_the_transaction_fails", async () => {
    requireAuth.mockResolvedValue(user("admin"));
    service.correct.mockRejectedValue(new Error("connection reset"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await correctFee(input)).toEqual({ ok: false, error: "The correction could not be saved. Nothing changed. Try again." });
    service.reverse.mockRejectedValue(new Error("connection reset"));
    expect(await reverseCorrection(input)).toEqual({ ok: false, error: "The reversal could not be saved. Nothing changed. Try again." });
    expect(invalidatePublicReadCache).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(recordPublicCacheRefresh).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("should_not_refresh_after_a_refused_correction", async () => {
    requireAuth.mockResolvedValue(user("admin"));
    service.correct.mockResolvedValue({ ok: false, code: "stale", error: "This fee changed since you opened it." });
    expect(await correctFee(input)).toMatchObject({ ok: false, code: "stale" });
    expect(invalidatePublicReadCache).not.toHaveBeenCalled();
  });
});

describe("refresh after a committed correction", () => {
  it("should_clear_the_caches_and_record_it_on_the_run", async () => {
    requireAuth.mockResolvedValue(user("admin"));
    service.correct.mockResolvedValue(saved);
    expect(await correctFee(input)).toEqual(saved);
    expect(revalidatePath).toHaveBeenCalledWith("/institution/7");
    expect(recordPublicCacheRefresh).toHaveBeenCalledWith(db.sql, 70, true);
  });

  it("should_record_a_failed_cache_clear_and_still_report_the_correction", async () => {
    requireAuth.mockResolvedValue(user("admin"));
    service.correct.mockResolvedValue(saved);
    invalidatePublicReadCache.mockReturnValue(false);
    expect(await correctFee(input)).toEqual(saved);
    expect(recordPublicCacheRefresh).toHaveBeenCalledWith(db.sql, 70, false);
  });

  it("should_never_call_a_committed_correction_lost_when_page_revalidation_throws", async () => {
    requireAuth.mockResolvedValue(user("admin"));
    service.correct.mockResolvedValue(saved);
    revalidatePath.mockImplementation(() => {
      throw new Error("static generation store missing");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await correctFee(input)).toEqual(saved);
    expect(recordPublicCacheRefresh).toHaveBeenCalledWith(db.sql, 70, false);
    error.mockRestore();
  });

  it("should_still_report_the_correction_when_the_refresh_event_cannot_be_written", async () => {
    requireAuth.mockResolvedValue(user("admin"));
    service.correct.mockResolvedValue(saved);
    recordPublicCacheRefresh.mockRejectedValue(new Error("pool exhausted"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await correctFee(input)).toEqual(saved);
    error.mockRestore();
  });
});

describe("conflict dismissal after commit", () => {
  it("should_report_a_committed_dismissal_even_when_page_revalidation_throws", async () => {
    requireAuth.mockResolvedValue(user("admin"));
    service.dismiss.mockResolvedValue({ ok: true, institutionId: 7 });
    revalidatePath.mockImplementation(() => {
      throw new Error("static generation store missing");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await dismissConflict(4, "Older schedule text")).toEqual({ ok: true });
    error.mockRestore();
  });
});
