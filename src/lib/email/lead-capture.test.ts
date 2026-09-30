import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCaptureConfirmation, describeCaptureOffer, sendLeadCaptureNotifications } from "./lead-capture";
import { verifySubscriptionToken } from "./subscription-token";

const base = { email: "vp@bank.example", institutionId: null, institutionName: null, stateCode: null };

describe("lead capture emails", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "Fee Insight <reports@feeinsight.com>");
    vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", "secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("describes each placement's offer concretely", () => {
    expect(describeCaptureOffer({ ...base, placement: "state_benchmark", stateCode: "TX" })).toBe(
      "the Texas fee benchmark",
    );
    expect(
      describeCaptureOffer({ ...base, placement: "institution_alerts", institutionId: 1, institutionName: "Example CU" }),
    ).toBe("fee-change alerts for Example CU");
  });

  it.each(["sample_report", "homepage"] as const)("delivers the sample PDF and the report offer for %s", (placement) => {
    const content = buildCaptureConfirmation(
      { ...base, placement },
      { confirmUrl: "https://x/confirm", unsubscribeUrl: "https://x/unsub" },
    );
    const text = content.lines.join("\n");
    expect(text).toContain("/reports/sample-competitive-fee-position.pdf");
    expect(text).toContain("Competitive Fee Position Report — free (a $300 value)");
    expect(text).toContain("/for-institutions#report");
    expect(text).toContain("Unsubscribe: https://x/unsub");
    expect(content.cta).toEqual({ label: "Confirm my email", href: "https://x/confirm" });
  });

  it("sends a signed confirm link and List-Unsubscribe headers to the requester", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await sendLeadCaptureNotifications({ ...base, placement: "state_benchmark", stateCode: "OH" });
    expect(outcome.confirmation.status).toBe("sent");
    expect(outcome.notification.status).toBe("sent");

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    const confirmation = bodies.find((b) => b.to === "vp@bank.example");
    expect(confirmation.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const confirmUrl = new URL(/https?:\/\/[^\s"<]+email-preferences\?action=confirm[^\s"<]*/.exec(confirmation.text)![0]);
    expect(
      verifySubscriptionToken("confirm", "vp@bank.example", confirmUrl.searchParams.get("token")!, "secret"),
    ).toBe(true);
  });

  it("reports not_configured without calling the provider", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await sendLeadCaptureNotifications({ ...base, placement: "national_index" });
    expect(outcome.confirmation.status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
