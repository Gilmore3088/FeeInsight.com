import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayToken, isExpiredPayToken, payPath, verifyPayToken } from "./pay-link";
import { formatUsd, institutionIdFromUseCase, isReportRequestSource, parseQuoteCents } from "./report-payment";

describe("pay links", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a lead id and refuses a changed one", () => {
    vi.stubEnv("CUSTOM_REPORT_LINK_SECRET", "test-secret");
    const now = new Date("2026-10-06T12:00:00Z");
    const token = createPayToken(18, now)!;
    expect(token).toMatch(/^18-20261006-[0-9a-f]{24}$/);
    expect(verifyPayToken(token, now)?.leadId).toBe(18);
    expect(verifyPayToken(token.replace(/^18-/, "19-"), now)).toBeNull();
    expect(payPath(token)).toBe(`/pay/report/${token}`);
  });

  it("expires after 60 days and is never valid without the secret", () => {
    vi.stubEnv("CUSTOM_REPORT_LINK_SECRET", "test-secret");
    const token = createPayToken(18, new Date("2026-10-06T12:00:00Z"))!;
    expect(verifyPayToken(token, new Date("2026-12-04T12:00:00Z"))).not.toBeNull();
    expect(verifyPayToken(token, new Date("2026-12-06T12:00:00Z"))).toBeNull();
    expect(isExpiredPayToken(token, new Date("2026-12-06T12:00:00Z"))).toBe(true);
    expect(isExpiredPayToken(token, new Date("2026-12-04T12:00:00Z"))).toBe(false);
    expect(isExpiredPayToken(token.replace(/^18-/, "19-"), new Date("2026-12-06T12:00:00Z"))).toBe(false);
    vi.stubEnv("CUSTOM_REPORT_LINK_SECRET", "");
    expect(createPayToken(18)).toBeNull();
    expect(verifyPayToken(token)).toBeNull();
  });

  it("is not a report link: the same secret signs a different message", () => {
    vi.stubEnv("CUSTOM_REPORT_LINK_SECRET", "test-secret");
    const token = createPayToken(201, new Date("2026-10-06T12:00:00Z"))!;
    return import("@/lib/custom-report/link").then(({ verifyReportToken }) => {
      expect(verifyReportToken(token, new Date("2026-10-06T12:00:00Z"))).toBeNull();
    });
  });
});

describe("quote helpers", () => {
  it.each([
    ["300", 30000],
    ["$1,250.50", 125050],
    [" 300.5 ", 30050],
  ])("parses %s", (input, cents) => expect(parseQuoteCents(input)).toBe(cents));

  it.each(["", "0.99", "abc", "300.123", "-5", "60000"])("refuses %s", (input) => expect(parseQuoteCents(input)).toBeNull());

  it("formats whole and part dollars", () => {
    expect(formatUsd(30000)).toBe("$300");
    expect(formatUsd(125050)).toBe("$1,250.50");
  });

  it("reads the institution id a report request stored", () => {
    expect(institutionIdFromUseCase("Pricing review; institution_id=201; src=landing")).toBe(201);
    expect(institutionIdFromUseCase("institution_id=7")).toBe(7);
    expect(institutionIdFromUseCase("no id here")).toBeNull();
  });

  it("knows which leads ask for an institution report", () => {
    expect(isReportRequestSource("report")).toBe(true);
    expect(isReportRequestSource("newsletter,contact_report")).toBe(true);
    expect(isReportRequestSource("capture_report_sample")).toBe(false);
    expect(isReportRequestSource("contact_general")).toBe(false);
  });
});
