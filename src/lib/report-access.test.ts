// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(async () => []) }));

import type { User } from "@/lib/auth";
import {
  canReadReportJob,
  REPORT_START_BLOCKED_MESSAGE,
  reportStartBlockedMessage,
  reportStartRefusal,
} from "./report-access";

const user = (overrides: Partial<User> = {}): User =>
  ({ id: 7, role: "viewer", subscription_status: "canceled", stripe_customer_id: null, ...overrides }) as User;

describe("canReadReportJob (#1999)", () => {
  it("should_allow_cancelled_owner_to_read_own_job", () => {
    expect(canReadReportJob(user(), { user_id: 7 })).toBe(true);
    expect(canReadReportJob(user(), { user_id: "7" })).toBe(true);
  });

  it("should_deny_another_users_job_and_cron_jobs_to_non_admins", () => {
    expect(canReadReportJob(user({ subscription_status: "active" }), { user_id: 8 })).toBe(false);
    expect(canReadReportJob(user(), { user_id: null })).toBe(false);
  });

  it("should_allow_admin_to_read_any_job", () => {
    expect(canReadReportJob(user({ role: "admin" }), { user_id: 8 })).toBe(true);
    expect(canReadReportJob(user({ role: "admin" }), { user_id: null })).toBe(true);
  });
});

describe("reportStartRefusal (#1999)", () => {
  it("should_block_cancelled_user_with_message_and_subscribe_link", async () => {
    const refusal = await reportStartRefusal(user(), "/pro/reports");
    expect(refusal?.error).toBe(REPORT_START_BLOCKED_MESSAGE);
    expect(refusal?.error).toContain("/subscribe");
    expect(refusal?.href).toMatch(/^\/subscribe\?from=%2Fpro%2Freports/);
  });

  it("should_allow_active_subscriber_to_start", async () => {
    expect(await reportStartRefusal(user({ subscription_status: "active" }), "/pro/reports")).toBeNull();
  });

  it("should_point_lapsed_payer_to_billing_issue_not_subscribe", async () => {
    const lapsedSince = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const refusal = await reportStartRefusal(
      user({ subscription_status: "past_due", past_due_since: lapsedSince } as Partial<User>),
      "/pro/reports",
    );
    expect(refusal?.href).toBe("/account/billing-issue");
    expect(refusal?.error).toContain("/account/billing-issue");
    expect(refusal?.error).not.toContain("/subscribe");
    expect(refusal?.error).toContain("/account/reports");
  });
});

describe("reportStartBlockedMessage (#1999)", () => {
  it("should_send_lapsed_team_member_to_team_billing", () => {
    const message = reportStartBlockedMessage("/account/team-billing");
    expect(message).toContain("/account/team-billing");
    expect(message).not.toContain("/subscribe");
  });

  it("should_send_cancelled_account_to_subscribe_and_its_reports_page", () => {
    expect(reportStartBlockedMessage("/subscribe?from=x")).toBe(REPORT_START_BLOCKED_MESSAGE);
    expect(REPORT_START_BLOCKED_MESSAGE).toContain("/account/reports");
  });
});
