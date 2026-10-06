import { afterEach, describe, expect, it, vi } from "vitest";
import { getSentEmailLog, parseSentEmails } from "./resend-log";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseSentEmails", () => {
  it("reads Resend's list shape", () => {
    expect(
      parseSentEmails({
        object: "list",
        data: [
          { id: "e1", to: ["a@example.com"], subject: "Morning brief", created_at: "2026-10-06 12:00:01.5+00", last_event: "delivered" },
          { id: "e2", to: "b@example.com", subject: "Report", created_at: null },
        ],
      }),
    ).toEqual([
      { id: "e1", to: ["a@example.com"], subject: "Morning brief", createdAt: "2026-10-06T12:00:01.500Z", lastEvent: "delivered" },
      { id: "e2", to: ["b@example.com"], subject: "Report", createdAt: null, lastEvent: null },
    ]);
  });

  it("returns nothing for an unexpected body", () => {
    expect(parseSentEmails({ error: "nope" })).toEqual([]);
  });
});

describe("getSentEmailLog", () => {
  it("says when Resend isn't configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await getSentEmailLog()).toEqual({ status: "not_configured", reason: "RESEND_API_KEY is not set." });
  });

  it("reports a failed answer instead of an empty log", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect(await getSentEmailLog()).toEqual({ status: "failed", reason: "Resend answered 401. The key may be limited to sending; a key with full access can list sent emails." });
  });
});
