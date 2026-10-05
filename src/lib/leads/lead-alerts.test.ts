import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/email/resend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/resend")>()),
  sendResendEmail: vi.fn(),
}));

import { sql } from "@/lib/data-store/connection";
import { sendResendEmail } from "@/lib/email/resend";
import { handleLeadDeliveryOutcome, leadWatchAlert, runLeadWatch, summarizeLeadWatch } from "./lead-alerts";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const sendMock = sendResendEmail as unknown as ReturnType<typeof vi.fn>;
const SENT = { status: "sent", providerId: "em_1" } as const;
const FAILED = { status: "failed", error: "Resend 500" } as const;
const LEAD = { email: "vp@bank.example", name: "Pat", source: "report" };

function issued(callIndex: number): { text: string; values: unknown[] } {
  const [strings, ...values] = sqlMock.mock.calls[callIndex] as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join("?").replace(/\s+/g, " "), values };
}

function row(id: number, status: string, source = "report") {
  return { id, name: `Lead ${id}`, email: `l${id}@bank.example`, company: "Bank", source, status, created_at: "2026-10-04T10:00:00Z", kind: status === "email_failed" ? "email_failed" : "overdue" };
}

describe("lead alerts", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    sendMock.mockReset();
  });

  it("does nothing when both emails went out", async () => {
    await handleLeadDeliveryOutcome(LEAD, { notification: SENT, confirmation: SENT });
    expect(sqlMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("marks the lead email_failed when James's notification failed", async () => {
    await handleLeadDeliveryOutcome(LEAD, { notification: FAILED, confirmation: SENT });
    expect(issued(0).text).toContain("UPDATE leads SET status = 'email_failed'");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("alerts James at once when only the requester's confirmation failed", async () => {
    sendMock.mockResolvedValue(SENT);
    await handleLeadDeliveryOutcome(LEAD, { notification: SENT, confirmation: FAILED });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ subject: "Confirmation email failed: vp@bank.example" }), "the lead alert");
    expect(issued(0).values[0]).toBe("needs_reply");
  });

  it("falls back to email_failed when that alert also fails", async () => {
    sendMock.mockResolvedValue(FAILED);
    await handleLeadDeliveryOutcome(LEAD, { notification: SENT, confirmation: FAILED });
    expect(issued(0).values[0]).toBe("email_failed");
  });

  it("builds no alert when nothing is owed", () => {
    expect(leadWatchAlert([], [])).toBeNull();
  });

  it("alerts once, then moves alerted leads so the next run is quiet", async () => {
    sqlMock.mockResolvedValueOnce([row(1, "new"), row(2, "email_failed")]);
    sendMock.mockResolvedValue(SENT);
    const result = await runLeadWatch();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].subject).toBe("2 leads waiting on a reply");
    expect(issued(1).text).toContain("UPDATE leads SET status = 'overdue'");
    expect(issued(1).values).toEqual([[1]]);
    expect(issued(2).text).toContain("UPDATE leads SET status = 'needs_reply'");
    expect(issued(2).values).toEqual([[2]]);
    expect(summarizeLeadWatch(result)).toBe("Alerted James: 1 overdue, 1 with failed emails.");
  });

  it("leaves statuses alone when the alert could not be sent", async () => {
    sqlMock.mockResolvedValueOnce([row(1, "new")]);
    sendMock.mockResolvedValue(FAILED);
    const result = await runLeadWatch();
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(result.alert).toBe("failed");
    expect(summarizeLeadWatch(result)).toBe("Could not alert James (Resend 500): 1 overdue, 0 with failed emails.");
  });

  it("sends nothing on a dry run", async () => {
    sqlMock.mockResolvedValueOnce([row(1, "new")]);
    const result = await runLeadWatch({ dryRun: true });
    expect(sendMock).not.toHaveBeenCalled();
    expect(result.alertReason).toBe("dry run");
  });

  it("only selects request leads past 24 hours, or failed ones", async () => {
    await runLeadWatch();
    const select = issued(0);
    expect(select.text).toContain("status = 'email_failed'");
    expect(select.text).toContain("status IN ('new', 'in_progress')");
    expect(select.values).toContain(24);
  });
});
