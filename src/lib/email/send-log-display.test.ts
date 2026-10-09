import { describe, expect, it } from "vitest";
import { emailCountLines, emailEventLabel, emailEventTone } from "./send-log-display";

const COUNTS = { total: 10, configured: 8, notConfigured: 2, accepted: 7, failed: 1, delivered: 0, undelivered: 0, withEvents: 0 };

describe("Emails sent wording", () => {
  it("keeps configured, send accepted and delivered apart", () => {
    const lines = emailCountLines(COUNTS);
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ["Configured", 8],
      ["Send accepted", 7],
      ["Delivered", 0],
    ]);
    expect(lines[0].note).toBe("2 skipped because Resend was not configured.");
    expect(lines[1].note).toBe("1 refused by Resend or not reached.");
  });

  it("says delivery events need the Resend webhook until one arrives", () => {
    expect(emailCountLines(COUNTS)[2].note).toMatch(/Resend webhook/);
    expect(emailCountLines({ ...COUNTS, delivered: 5, withEvents: 6, undelivered: 1 })[2].note)
      .toBe("1 bounced, complained or failed after Resend accepted them.");
    expect(emailCountLines({ ...COUNTS, delivered: 5, withEvents: 5 })[2].note).toBe("Reported by Resend's webhook.");
  });

  it("labels and colors Resend events", () => {
    expect(emailEventLabel("email.delivery_delayed")).toBe("Delivery delayed");
    expect(emailEventLabel(null)).toBe("No event yet");
    expect(emailEventTone("email.delivered")).toBe("good");
    expect(emailEventTone("email.bounced")).toBe("bad");
    expect(emailEventTone("email.sent")).toBe("neutral");
  });
});
