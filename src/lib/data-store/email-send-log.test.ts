import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { getEmailSendLog, mapEmailSendCounts, mapEmailSendLogRow } from "./email-send-log";

describe("email send log", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("maps a row and the counts", () => {
    expect(mapEmailSendLogRow({
      id: "7", created_at: new Date("2026-10-09T12:00:00Z"), label: "lead alert", recipient: "a@b.example",
      subject: "New lead", status: "sent", provider_id: "re_1", error: null, last_event: "email.delivered",
      last_event_at: "2026-10-09T12:00:05Z",
    })).toEqual({
      id: 7, createdAt: "2026-10-09T12:00:00.000Z", label: "lead alert", recipient: "a@b.example", subject: "New lead",
      status: "sent", providerId: "re_1", error: null, lastEvent: "email.delivered", lastEventAt: "2026-10-09T12:00:05.000Z",
    });
    expect(mapEmailSendCounts({ total: 5, accepted: 3, failed: 1, not_configured: 1, delivered: 2, undelivered: 0, with_events: 2 }))
      .toEqual({ total: 5, configured: 4, notConfigured: 1, accepted: 3, failed: 1, delivered: 2, undelivered: 0, withEvents: 2 });
  });

  it("says so before the migration and without a database", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await getEmailSendLog(25, vi.fn() as never)).toEqual({ status: "failed", reason: "DATABASE_URL is not set." });
    vi.stubEnv("DATABASE_URL", "postgres://test");
    const db = vi.fn(() => Promise.resolve([{ ready: false }]));
    expect(await getEmailSendLog(25, db as never)).toEqual({ status: "not_migrated" });
  });
});
