import { describe, expect, it } from "vitest";
import { renderLeadEmailHtml, renderLeadEmailText } from "./lead-notification";
import { reportPaidEmails, reportQuoteEmail } from "./report-payment";

describe("quote email", () => {
  it("names the price once and links the pay page", () => {
    const email = reportQuoteEmail({ email: "pat@example.com", institution: "Hanmi Bank", cents: 30000, payUrl: "https://feeinsight.com/pay/report/18-x" });
    const text = renderLeadEmailText(email);
    expect(email.subject).toBe("Your quote for the Hanmi Bank fee report: $300");
    expect(text).toContain("Price: $300, one time.");
    expect(text).toContain("https://feeinsight.com/pay/report/18-x");
    expect(renderLeadEmailHtml(email)).toContain("Review and pay by card");
  });
});

describe("paid emails", () => {
  const base = { leadId: 18, name: "Pat Lee", email: "pat@example.com", institution: "Hanmi Bank", cents: 30000, checkoutSessionId: "cs_1" };

  it("sends the requester their report link and tells James", () => {
    const { notification, confirmation } = reportPaidEmails({ ...base, reportUrl: "https://feeinsight.com/market-report/201-x" });
    expect(notification.subject).toBe("Paid: Hanmi Bank report, $300 — Pat Lee");
    expect(notification.status).toEqual({ label: "Paid $300", tone: "good" });
    expect(confirmation.cta?.href).toBe("https://feeinsight.com/market-report/201-x");
  });

  it("says plainly when no link could be made", () => {
    const { notification, confirmation } = reportPaidEmails({ ...base, reportUrl: null });
    expect(notification.status?.tone).toBe("warn");
    expect(renderLeadEmailText(notification)).toContain("Send the report by hand.");
    expect(confirmation.cta).toBeUndefined();
    expect(renderLeadEmailText(confirmation)).toContain("within one business day");
  });
});
