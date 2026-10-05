import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReportToken, LINK_LIFETIME_DAYS, verifyReportToken } from "./link";

const NOW = new Date("2026-10-05T12:00:00Z");

describe("report links", () => {
  beforeEach(() => {
    process.env.CUSTOM_REPORT_LINK_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.CUSTOM_REPORT_LINK_SECRET;
  });

  it("round-trips a signed token", () => {
    const token = createReportToken(201, NOW)!;
    expect(token).toMatch(/^201-20261005-[0-9a-f]{24}$/);
    expect(verifyReportToken(token, NOW)?.institutionId).toBe(201);
  });

  it("rejects a tampered institution id or signature", () => {
    const token = createReportToken(201, NOW)!;
    expect(verifyReportToken(token.replace(/^201/, "202"), NOW)).toBeNull();
    expect(verifyReportToken(`${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`, NOW)).toBeNull();
  });

  it("expires after the link lifetime", () => {
    const token = createReportToken(201, NOW)!;
    const later = new Date(NOW.getTime() + (LINK_LIFETIME_DAYS + 1) * 86_400_000);
    expect(verifyReportToken(token, later)).toBeNull();
  });

  it("issues and accepts nothing without a secret", () => {
    const token = createReportToken(201, NOW)!;
    delete process.env.CUSTOM_REPORT_LINK_SECRET;
    expect(createReportToken(201, NOW)).toBeNull();
    expect(verifyReportToken(token, NOW)).toBeNull();
  });
});
