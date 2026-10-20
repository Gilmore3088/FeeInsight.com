import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPurchaseReportToken, createReportToken, LINK_LIFETIME_DAYS, verifyReportToken } from "./link";

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

describe("purchase-bound report links (#2000)", () => {
  beforeEach(() => {
    process.env.CUSTOM_REPORT_LINK_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.CUSTOM_REPORT_LINK_SECRET;
  });

  it("should_carry_the_purchase_id_when_signed_for_a_payment", () => {
    const token = createPurchaseReportToken(201, 77, NOW)!;
    expect(token).toMatch(/^201-20261005-p77-[0-9a-f]{24}$/);
    expect(verifyReportToken(token, NOW)).toMatchObject({ institutionId: 201, purchaseId: 77 });
  });

  it("should_reject_a_tampered_purchase_id_or_bank", () => {
    const token = createPurchaseReportToken(201, 77, NOW)!;
    expect(verifyReportToken(token.replace("-p77-", "-p78-"), NOW)).toBeNull();
    expect(verifyReportToken(token.replace(/^201/, "202"), NOW)).toBeNull();
  });

  it("should_not_turn_a_legacy_link_into_a_purchase_link_or_back", () => {
    const legacy = createReportToken(201, NOW)!;
    const legacySig = legacy.split("-")[2];
    expect(verifyReportToken(`201-20261005-p77-${legacySig}`, NOW)).toBeNull();
    const bound = createPurchaseReportToken(201, 77, NOW)!;
    expect(verifyReportToken(`201-20261005-${bound.split("-")[3]}`, NOW)).toBeNull();
  });

  it("should_keep_a_legacy_link_valid_until_it_expires_with_no_purchase_id", () => {
    const legacy = createReportToken(201, NOW)!;
    expect(verifyReportToken(legacy, NOW)?.purchaseId).toBeNull();
    const lastDay = new Date(NOW.getTime() + (LINK_LIFETIME_DAYS - 1) * 86_400_000);
    expect(verifyReportToken(legacy, lastDay)).not.toBeNull();
    const after = new Date(NOW.getTime() + (LINK_LIFETIME_DAYS + 1) * 86_400_000);
    expect(verifyReportToken(legacy, after)).toBeNull();
  });

  it("should_issue_nothing_without_a_purchase_id_or_a_secret", () => {
    expect(createPurchaseReportToken(201, 0, NOW)).toBeNull();
    delete process.env.CUSTOM_REPORT_LINK_SECRET;
    expect(createPurchaseReportToken(201, 77, NOW)).toBeNull();
  });
});
