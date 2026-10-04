import { afterEach, describe, expect, it, vi } from "vitest";
import { describeLeadEmailConfig, normalizeFromAddress } from "./lead-notification";
import { sendLeadTestEmail } from "./lead-email-test";

describe("lead email configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("repairs a From address missing its angle brackets and leaves valid ones alone", () => {
    expect(normalizeFromAddress("Fee Insight hello@bankfeeindex.com")).toBe("Fee Insight <hello@bankfeeindex.com>");
    expect(normalizeFromAddress('"Fee Insight <hello@bankfeeindex.com>"')).toBe("Fee Insight <hello@bankfeeindex.com>");
    expect(normalizeFromAddress("hello@bankfeeindex.com")).toBe("hello@bankfeeindex.com");
  });

  it("reports which variable the From address came from, or the default", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "");
    vi.stubEnv("WORKSPACE_INVITE_EMAIL_FROM", "");
    vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(describeLeadEmailConfig()).toEqual({
      apiKeyConfigured: false,
      from: "Fee Insight <hello@bankfeeindex.com>",
      fromSource: "default",
    });

    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "Fee Insight <reports@feeinsight.com>");
    expect(describeLeadEmailConfig()).toEqual({
      apiKeyConfigured: true,
      from: "Fee Insight <reports@feeinsight.com>",
      fromSource: "REPORT_REQUEST_EMAIL_FROM",
    });
  });

  it("sends a test email through Resend with the lead From address", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "Fee Insight <reports@feeinsight.com>");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "em_9" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await sendLeadTestEmail("owner@example.com");

    expect(outcome.result).toEqual({ status: "sent", providerId: "em_9" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ from: "Fee Insight <reports@feeinsight.com>", to: "owner@example.com" });
  });

  it("surfaces the provider error, e.g. an unverified domain", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "The bankfeeindex.com domain is not verified." }), { status: 403 }),
      ),
    );
    const outcome = await sendLeadTestEmail("owner@example.com");
    expect(outcome.result).toEqual({ status: "failed", error: "The bankfeeindex.com domain is not verified." });
  });

  it("does not call the provider without an API key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await sendLeadTestEmail("owner@example.com");
    expect(outcome.result.status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
