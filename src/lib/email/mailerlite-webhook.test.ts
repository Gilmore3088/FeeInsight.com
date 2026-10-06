import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unsubscribedEmails, verifyMailerLiteSignature } from "./mailerlite-webhook";

describe("MailerLite webhook", () => {
  it("accepts only the right HMAC signature", () => {
    const body = JSON.stringify({ type: "subscriber.unsubscribed", email: "a@b.co" });
    const good = createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyMailerLiteSignature(body, good, "s3cret")).toBe(true);
    expect(verifyMailerLiteSignature(body, good, "other")).toBe(false);
    expect(verifyMailerLiteSignature(body, null, "s3cret")).toBe(false);
  });

  it("reads unsubscribes from single and batched deliveries", () => {
    expect(unsubscribedEmails({ type: "subscriber.unsubscribed", data: { email: "A@B.co" } })).toEqual(["a@b.co"]);
    expect(unsubscribedEmails({ events: [
      { type: "subscriber.unsubscribed", subscriber: { email: "x@y.co" } },
      { type: "subscriber.created", subscriber: { email: "new@y.co", status: "active" } },
      { type: "subscriber.updated", subscriber: { email: "junk@y.co", status: "junk" } },
    ] })).toEqual(["x@y.co", "junk@y.co"]);
    expect(unsubscribedEmails({ type: "campaign.sent" })).toEqual([]);
  });
});
