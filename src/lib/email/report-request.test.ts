import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendContactRequestNotifications,
  sendReportRequestNotifications,
} from "./report-request";

const REQUEST = {
  name: "Dana Lee",
  email: "dana@examplecu.org",
  institution: "Example Credit Union",
  role: "VP Retail",
  institutionId: 4802,
  src: "profile",
};

function okResponse(id: string) {
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) => {
    const parsed = JSON.parse(String((init as RequestInit).body)) as Record<string, string>;
    return parsed;
  });
}

describe("sendReportRequestNotifications", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns not_configured for both messages without calling the provider", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "");
    vi.stubEnv("WORKSPACE_INVITE_EMAIL_FROM", "");
    vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendReportRequestNotifications(REQUEST);

    expect(result.notification.status).toBe("not_configured");
    expect(result.confirmation.status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends from the default address when no From variable is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "");
    vi.stubEnv("WORKSPACE_INVITE_EMAIL_FROM", "");
    vi.stubEnv("TRANSACTIONAL_EMAIL_FROM", "");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchMock = vi.fn().mockResolvedValue(okResponse("em_1"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendReportRequestNotifications(REQUEST);

    expect(result.notification.status).toBe("sent");
    expect(sentBodies(fetchMock).every((body) => body.from === "Fee Insight <hello@bankfeeindex.com>")).toBe(true);
  });

  it("repairs a From address typed without angle brackets", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "Fee Insight hello@bankfeeindex.com");
    const fetchMock = vi.fn().mockResolvedValue(okResponse("em_1"));
    vi.stubGlobal("fetch", fetchMock);

    await sendReportRequestNotifications(REQUEST);

    expect(sentBodies(fetchMock)[0].from).toBe("Fee Insight <hello@bankfeeindex.com>");
  });

  it("sends the internal notification and the requester auto-reply", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "");
    vi.stubEnv("WORKSPACE_INVITE_EMAIL_FROM", "Fee Insight <invites@example.com>");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse("em_internal"))
      .mockResolvedValueOnce(okResponse("em_reply"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendReportRequestNotifications(REQUEST);

    expect(result).toEqual({
      notification: { status: "sent", providerId: "em_internal" },
      confirmation: { status: "sent", providerId: "em_reply" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.headers).toMatchObject({ Authorization: "Bearer re_test" });
    }

    const [internal, reply] = sentBodies(fetchMock);
    expect(internal.from).toBe("Fee Insight <invites@example.com>");
    expect(internal.to).toBe("hello@bankfeeindex.com");
    expect(internal.reply_to).toBe("dana@examplecu.org");
    expect(internal.subject).toBe(
      "New report request: Example Credit Union — Dana Lee, dana@examplecu.org, VP Retail",
    );
    expect(internal.text).toContain("Institution ID: 4802");
    expect(internal.text).toContain("Source: profile");
    expect(internal.text).toContain("https://feeinsight.com/admin/leads");
    expect(internal.html).toContain("/admin/leads");

    expect(reply.to).toBe("dana@examplecu.org");
    expect(reply.reply_to).toBe("hello@bankfeeindex.com");
    expect(reply.subject).toBe("We received your request for Example Credit Union");
    expect(reply.text).toContain(
      "We confirm your peer set within one business day and deliver the Competitive Fee Position Report within 48 hours of confirmation.",
    );
    expect(reply.html).toContain("Example Credit Union");
  });

  it("prefers REPORT_REQUEST_EMAIL_FROM over the workspace invite address", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "Fee Insight <reports@example.com>");
    vi.stubEnv("WORKSPACE_INVITE_EMAIL_FROM", "Fee Insight <invites@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(okResponse("em_1"));
    vi.stubGlobal("fetch", fetchMock);

    await sendReportRequestNotifications({ ...REQUEST, role: null, institutionId: null, src: null });

    const [internal] = sentBodies(fetchMock);
    expect(internal.from).toBe("Fee Insight <reports@example.com>");
    expect(internal.subject).toBe(
      "New report request: Example Credit Union — Dana Lee, dana@examplecu.org",
    );
    expect(internal.text).not.toContain("Institution ID");
  });

  it("returns failed per message and never throws when the provider rejects", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "Fee Insight <reports@example.com>");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse("em_internal"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "domain is not verified" }), { status: 400 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendReportRequestNotifications(REQUEST);

    expect(result.notification).toEqual({ status: "sent", providerId: "em_internal" });
    expect(result.confirmation).toEqual({ status: "failed", error: "domain is not verified" });
  });

  it("survives a network failure with a failed status", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "Fee Insight <reports@example.com>");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await sendReportRequestNotifications(REQUEST);

    expect(result.notification).toEqual({ status: "failed", error: "ECONNRESET" });
    expect(result.confirmation).toEqual({ status: "failed", error: "ECONNRESET" });
  });
});

describe("sendContactRequestNotifications", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a contact notification with the message and a one-business-day auto-reply", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "Fee Insight <reports@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(okResponse("em_1"));
    vi.stubGlobal("fetch", fetchMock);

    await sendContactRequestNotifications({
      name: "Sam Ortiz",
      email: "sam@bank.example",
      company: "First Example Bank",
      role: null,
      message: "Can we license the dataset?",
      inquiryType: "enterprise",
    });

    const [internal, reply] = sentBodies(fetchMock);
    expect(internal.subject).toBe(
      "New contact request (enterprise): First Example Bank — Sam Ortiz, sam@bank.example",
    );
    expect(internal.text).toContain("Can we license the dataset?");
    expect(internal.text).toContain("Message:");
    expect(reply.to).toBe("sam@bank.example");
    expect(reply.text).toContain("We reply within one business day.");
  });

  it("escapes HTML in user-supplied fields", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("REPORT_REQUEST_EMAIL_FROM", "Fee Insight <reports@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(okResponse("em_1"));
    vi.stubGlobal("fetch", fetchMock);

    await sendContactRequestNotifications({
      name: "<script>alert(1)</script>",
      email: "x@example.com",
      company: null,
      role: null,
      message: null,
      inquiryType: null,
    });

    const [internal] = sentBodies(fetchMock);
    expect(internal.html).not.toContain("<script>");
    expect(internal.html).toContain("&lt;script&gt;");
  });
});
