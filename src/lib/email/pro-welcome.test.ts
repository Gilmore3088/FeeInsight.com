import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./resend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resend")>()),
  sendResendEmail: vi.fn(),
}));

import { sendResendEmail } from "./resend";
import { buildProWelcomeEmail, sendProWelcomeEmail } from "./pro-welcome";

const sendMock = sendResendEmail as unknown as ReturnType<typeof vi.fn>;

describe("Pro welcome email", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("points the new subscriber at Hamilton and their account", () => {
    const content = buildProWelcomeEmail("Pat");
    expect(content.lines[0]).toBe("Hi Pat,");
    expect(content.cta?.href).toMatch(/\/pro\/hamilton$/);
    expect(content.lines.join("\n")).toContain("/account");
  });

  it("never throws when the send fails", async () => {
    sendMock.mockImplementation(async () => {
      throw new Error("network");
    });
    const result = await sendProWelcomeEmail({ email: "a@b.com", name: null });
    expect(result).toEqual({ status: "failed", error: "network" });
  });

  it("alerts James when the welcome email doesn't go out", async () => {
    sendMock
      .mockResolvedValueOnce({ status: "failed", error: "Resend 500" })
      .mockResolvedValueOnce({ status: "sent", providerId: "alert_1" });
    await sendProWelcomeEmail({ email: "a@b.com", name: "Pat" });
    expect(sendMock).toHaveBeenCalledTimes(2);
    const [alert, label] = sendMock.mock.calls[1] as [{ subject: string; text: string }, string];
    expect(label).toBe("the lead alert");
    expect(alert.subject).toBe("Pro welcome email failed: a@b.com");
    expect(alert.text).toContain("Resend 500");
  });

  it("sends no alert when the welcome email went out", async () => {
    sendMock.mockResolvedValueOnce({ status: "sent", providerId: "em_1" });
    await sendProWelcomeEmail({ email: "a@b.com", name: "Pat" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
