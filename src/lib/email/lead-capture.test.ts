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

  it("tells a reader who picked a state about that state's monthly edition", () => {
    const links = { confirmUrl: "https://x/confirm", unsubscribeUrl: "https://x/unsub" };
    const withState = buildCaptureConfirmation({ ...base, placement: "national_index", stateCode: "TX" }, links).closing!.join("\n");
    expect(withState).toContain("Each month you'll also get the Texas edition by email");
    const without = buildCaptureConfirmation({ ...base, placement: "national_index" }, links).closing!.join("\n");
    expect(without).not.toContain("edition");
  });

  it.each(["sample_report", "homepage"] as const)("delivers the sample PDF without another offer for %s", (placement) => {
    const content = buildCaptureConfirmation(
      { ...base, placement },
      { confirmUrl: "https://x/confirm", unsubscribeUrl: "https://x/unsub" },
    );
    const text = content.closing!.join("\n");
    expect(text).toContain("Open the sample report: https://");
    expect(text).not.toContain(".pdf");
    expect(text).not.toContain("/for-institutions#report");
    expect(text).toContain("Unsubscribe: https://x/unsub");
    expect(content.cta).toEqual({ label: "Confirm my email", href: "https://x/confirm" });
  });

  it("leads with the confirm button, then what the reader receives", () => {
    const content = buildCaptureConfirmation(
      { ...base, placement: "state_benchmark", stateCode: "GA" },
      { confirmUrl: "https://x/confirm", unsubscribeUrl: "https://x/unsub" },
    );
    expect(content.heading).toBe("Confirm your email");
    expect(content.subject).toBe("Confirm your email for the Georgia fee benchmark");
    expect(content.lines).toEqual(["Confirm your address to get the Georgia fee benchmark from Fee Insight."]);
    expect(content.closing![0]).toMatch(/^The Georgia benchmark puts .*\/research\/state\/GA$/);
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
