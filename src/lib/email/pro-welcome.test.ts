import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./resend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resend")>()),
  sendResendEmail: vi.fn(),
}));

import { sendResendEmail } from "./resend";
import { buildProWelcomeEmail, sendProWelcomeEmail } from "./pro-welcome";

const sendMock = sendResendEmail as unknown as ReturnType<typeof vi.fn>;

describe("Pro welcome email", () => {
  beforeEach(() => sendMock.mockReset());

  it("points the new subscriber at Hamilton and their account", () => {
    const content = buildProWelcomeEmail("Pat");
    expect(content.lines[0]).toBe("Hi Pat,");
    expect(content.cta?.href).toMatch(/\/pro\/hamilton$/);
    expect(content.lines.join("\n")).toContain("/account");
  });

  it("never throws when the send fails", async () => {
    sendMock.mockRejectedValue(new Error("network"));
    await expect(sendProWelcomeEmail({ email: "a@b.com", name: null })).resolves.toEqual({ status: "failed", error: "network" });
  });
});
