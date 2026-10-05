import { describe, expect, it } from "vitest";
import { isLeadOverdue, isLeadStatus, isRequestLead, leadDueAt } from "./lead-status";

const CREATED = "2026-10-05T12:00:00.000Z";

describe("lead status", () => {
  it("treats report and contact requests as owed an answer, not subscriptions", () => {
    expect(isRequestLead("report")).toBe(true);
    expect(isRequestLead("newsletter,contact_enterprise")).toBe(true);
    expect(isRequestLead("capture_report_sample")).toBe(false);
    expect(isRequestLead("newsletter")).toBe(false);
    expect(isRequestLead(null)).toBe(false);
  });

  it("gives an open request a due time 24 hours after it arrived", () => {
    expect(leadDueAt({ source: "report", status: "new", created_at: CREATED })?.toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(leadDueAt({ source: "report", status: "sent", created_at: CREATED })).toBeNull();
    expect(leadDueAt({ source: "newsletter", status: "new", created_at: CREATED })).toBeNull();
  });

  it("is overdue only once the due time passes", () => {
    const lead = { source: "report", status: "in_progress", created_at: CREATED };
    expect(isLeadOverdue(lead, new Date("2026-10-06T11:59:00Z"))).toBe(false);
    expect(isLeadOverdue(lead, new Date("2026-10-06T12:00:00Z"))).toBe(true);
  });

  it("accepts only known statuses", () => {
    expect(isLeadStatus("sent")).toBe(true);
    expect(isLeadStatus("converted")).toBe(false);
    expect(isLeadStatus(3)).toBe(false);
  });
});
