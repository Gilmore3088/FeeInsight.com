import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsafe: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ getSql: () => ({ unsafe: mocks.unsafe }) }));

import { assembleMonthlyPulse, loadConfirmedFeeChanges } from "./monthly-pulse";

beforeEach(() => {
  mocks.unsafe.mockReset();
  mocks.unsafe.mockResolvedValue([]);
});

describe("loadConfirmedFeeChanges scope (#1891)", () => {
  it("reads one institution's changes in the query when it names one, not the whole state", async () => {
    await loadConfirmedFeeChanges("2026-07-06T12:00:00Z", null, 9701001);
    const [sql, params] = mocks.unsafe.mock.calls[0];
    expect(params).toEqual(["2026-07-06T12:00:00Z", null, 9701001]);
    expect(sql).toContain("($3::bigint IS NULL OR c.institution_id = $3::bigint)");
  });

  it("keeps the state and national reads unscoped", async () => {
    await loadConfirmedFeeChanges("2026-07-06T12:00:00Z", "FL");
    expect(mocks.unsafe.mock.calls[0][1]).toEqual(["2026-07-06T12:00:00Z", "FL", null]);
    mocks.unsafe.mockReset();
    mocks.unsafe.mockResolvedValue([]);
    await assembleMonthlyPulse(new Date("2026-10-25T00:00:00Z"));
    expect(mocks.unsafe.mock.calls[0][1]).toEqual([expect.any(String), null, null]);
  });
});
