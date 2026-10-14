import { describe, expect, it } from "vitest";

import { cooldownDays, FOUND_COOLDOWN_DAYS, MISS_COOLDOWN_DAYS, onCooldown } from "./cooldowns";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1) + (n - 1) * 24 * 60 * 60 * 1000);

describe("Magellan paid cooldowns (#1031)", () => {
  it("holds a find for 90 days and a miss for 30", () => {
    expect(FOUND_COOLDOWN_DAYS).toBe(90);
    expect(MISS_COOLDOWN_DAYS).toBe(30);
    expect(cooldownDays("ok")).toBe(90);
    expect(cooldownDays("no_candidates")).toBe(30);
    expect(cooldownDays("wrong_document")).toBe(30);
  });

  it("does not search again on day 32 a bank found on day 30 (no reset at the month boundary)", () => {
    const found = { outcome: "ok", createdAt: day(30) };
    expect(onCooldown(found, day(32))).toBe(true);
    expect(onCooldown(found, day(30 + 89))).toBe(true);
    expect(onCooldown(found, day(30 + 91))).toBe(false);
  });

  it("makes a miss due again after 30 days, not at the next month boundary", () => {
    const miss = { outcome: "no_candidates", createdAt: day(20) };
    expect(onCooldown(miss, day(33))).toBe(true);
    expect(onCooldown(miss, day(20 + 29))).toBe(true);
    expect(onCooldown(miss, day(20 + 31))).toBe(false);
  });
});
