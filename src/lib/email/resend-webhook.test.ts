import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseResendEvent, verifySvixSignature } from "./resend-webhook";

const KEY = Buffer.from("resend-test-signing-key");
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW = new Date("2026-10-09T12:00:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));
const BODY = JSON.stringify({ type: "email.delivered", created_at: "2026-10-09T11:59:58Z", data: { email_id: "re_123" } });

function sign(id: string, timestamp: string, body: string, key = KEY) {
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

describe("verifySvixSignature", () => {
  it("accepts a valid signature, also among several entries", () => {
    expect(verifySvixSignature(BODY, { id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, BODY) }, SECRET, NOW)).toBe(true);
    const several = `v1,c29tZXRoaW5nIGVsc2U= ${sign("msg_1", TS, BODY)}`;
    expect(verifySvixSignature(BODY, { id: "msg_1", timestamp: TS, signature: several }, SECRET, NOW)).toBe(true);
  });

  it("rejects a wrong key, a changed body, another id or missing headers", () => {
    const wrongKey = sign("msg_1", TS, BODY, Buffer.from("another key"));
    expect(verifySvixSignature(BODY, { id: "msg_1", timestamp: TS, signature: wrongKey }, SECRET, NOW)).toBe(false);
    expect(verifySvixSignature(`${BODY} `, { id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, BODY) }, SECRET, NOW)).toBe(false);
    expect(verifySvixSignature(BODY, { id: "msg_2", timestamp: TS, signature: sign("msg_1", TS, BODY) }, SECRET, NOW)).toBe(false);
    expect(verifySvixSignature(BODY, { id: null, timestamp: TS, signature: sign("msg_1", TS, BODY) }, SECRET, NOW)).toBe(false);
    expect(verifySvixSignature(BODY, { id: "msg_1", timestamp: TS, signature: "v1,short" }, SECRET, NOW)).toBe(false);
  });

  it("rejects a timestamp more than five minutes from now", () => {
    const stale = String(Number(TS) - 301);
    const future = String(Number(TS) + 301);
    expect(verifySvixSignature(BODY, { id: "msg_1", timestamp: stale, signature: sign("msg_1", stale, BODY) }, SECRET, NOW)).toBe(false);
    expect(verifySvixSignature(BODY, { id: "msg_1", timestamp: future, signature: sign("msg_1", future, BODY) }, SECRET, NOW)).toBe(false);
    const recent = String(Number(TS) - 299);
    expect(verifySvixSignature(BODY, { id: "msg_1", timestamp: recent, signature: sign("msg_1", recent, BODY) }, SECRET, NOW)).toBe(true);
  });
});

describe("parseResendEvent", () => {
  it("reads email.* events by Resend email id", () => {
    expect(parseResendEvent(JSON.parse(BODY))).toEqual({
      type: "email.delivered",
      providerId: "re_123",
      at: new Date("2026-10-09T11:59:58Z"),
    });
  });

  it("ignores other events and events without an email id", () => {
    expect(parseResendEvent({ type: "contact.created", data: { email_id: "re_1" } })).toBeNull();
    expect(parseResendEvent({ type: "email.sent", data: {} })).toBeNull();
    expect(parseResendEvent(null)).toBeNull();
  });
});
