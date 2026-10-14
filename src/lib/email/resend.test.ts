import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/email-send-log", () => ({
  emailSendLogConfigured: vi.fn(() => true),
  insertEmailSendLog: vi.fn(() => Promise.resolve()),
}));

import { emailSendLogConfigured, insertEmailSendLog } from "@/lib/data-store/email-send-log";
import { sendLogLabel, sendResendEmail } from "./resend";

const insertMock = insertEmailSendLog as unknown as ReturnType<typeof vi.fn>;
const configuredMock = emailSendLogConfigured as unknown as ReturnType<typeof vi.fn>;

const MESSAGE = { from: "Fee Insight <hello@bankfeeindex.com>", to: "vp@bank.example", subject: "Reset", html: "<p>x</p>", text: "x" };

describe("sendResendEmail send log", () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue(undefined);
    configuredMock.mockReturnValue(true);
    vi.stubEnv("RESEND_API_KEY", "re_test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records an accepted send with Resend's id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 })));
    expect(await sendResendEmail(MESSAGE, "the password reset email")).toEqual({ status: "sent", providerId: "re_1" });
    expect(insertMock).toHaveBeenCalledWith({
      label: "password reset email",
      recipient: "vp@bank.example",
      subject: "Reset",
      status: "sent",
      providerId: "re_1",
      error: null,
    });
  });

  it("records a refused send and a not-configured one with their reasons", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Domain not verified" }), { status: 403 })));
    expect(await sendResendEmail(MESSAGE, "the lead alert")).toEqual({ status: "failed", error: "Domain not verified" });
    expect(insertMock.mock.calls[0][0]).toMatchObject({ status: "failed", providerId: null, error: "Domain not verified" });

    vi.stubEnv("RESEND_API_KEY", "");
    expect((await sendResendEmail(MESSAGE)).status).toBe("not_configured");
    expect(insertMock.mock.calls[1][0]).toMatchObject({ label: "email", status: "not_configured", error: "RESEND_API_KEY is not configured." });
  });

  it("returns the same result when the log write fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    insertMock.mockRejectedValue(new Error("relation \"email_send_log\" does not exist"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "re_2" }), { status: 200 })));
    expect(await sendResendEmail(MESSAGE, "the quote email")).toEqual({ status: "sent", providerId: "re_2" });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("skips logging without a database", async () => {
    configuredMock.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "re_3" }), { status: 200 })));
    expect((await sendResendEmail(MESSAGE)).status).toBe("sent");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("names the sender from its failure label", () => {
    expect(sendLogLabel("the Atlas daily brief")).toBe("Atlas daily brief");
    expect(sendLogLabel("")).toBe("email");
  });
});
