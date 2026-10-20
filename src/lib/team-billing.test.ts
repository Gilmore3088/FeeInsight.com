import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import type { User } from "./auth";
import { PAST_DUE_GRACE_DAYS } from "./access";
import {
  TEAM_BILLING_PATH,
  findLapsedTeam,
  premiumGatePath,
  teamBillingContact,
  type LapsedTeam,
} from "./team-billing";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-20T12:00:00Z");

function user(overrides: Partial<User> = {}): User {
  return {
    id: 8,
    username: "seat",
    display_name: "Seat Member",
    role: "viewer",
    email: "seat@example.com",
    stripe_customer_id: null,
    subscription_status: "none",
    past_due_since: null,
    institution_name: null,
    institution_type: null,
    asset_tier: null,
    state_code: null,
    fed_district: null,
    job_role: null,
    interests: null,
    workspace_seat: false,
    ...overrides,
  };
}

const LAPSED_TEAM: LapsedTeam = { ownerName: "Dana Owner", ownerEmail: "dana@bank.example", teamName: "First Bank" };

function fakeDb(result: unknown[] | Error) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return { db: db as never, calls };
}

describe("premiumGatePath", () => {
  it("should_send_a_seat_member_of_a_lapsed_team_to_the_team_billing_page", async () => {
    const lookup = vi.fn().mockResolvedValue(LAPSED_TEAM);
    expect(await premiumGatePath(user(), "/pro/hamilton", { lookup, now: NOW })).toBe(TEAM_BILLING_PATH);
    expect(lookup).toHaveBeenCalledWith(8);
  });

  it("should_send_the_lapsed_owner_to_billing_issue_without_a_team_lookup", async () => {
    const lookup = vi.fn().mockResolvedValue(LAPSED_TEAM);
    const owner = user({
      subscription_status: "past_due",
      past_due_since: new Date(NOW.getTime() - (PAST_DUE_GRACE_DAYS + 1) * DAY_MS).toISOString(),
      stripe_customer_id: "cus_1",
    });
    expect(await premiumGatePath(owner, "/pro/hamilton", { lookup, now: NOW })).toBe("/account/billing-issue");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("should_let_an_active_team_seat_through_without_a_team_lookup", async () => {
    const lookup = vi.fn().mockResolvedValue(LAPSED_TEAM);
    expect(await premiumGatePath(user({ workspace_seat: true }), "/pro/hamilton", { lookup, now: NOW })).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("should_send_someone_with_no_team_to_subscribe_with_the_page_they_wanted", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    expect(await premiumGatePath(user(), "/pro/news", { lookup, now: NOW })).toBe(
      "/subscribe?from=%2Fpro%2Fnews&reason=pro_required",
    );
  });

  it("should_send_a_signed_out_visitor_to_login", async () => {
    const lookup = vi.fn();
    expect(await premiumGatePath(null, "/pro/news", { lookup, now: NOW })).toBe("/login?from=%2Fpro%2Fnews");
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("findLapsedTeam", () => {
  it("should_return_the_owner_and_team_when_the_owner_is_past_due_beyond_grace", async () => {
    const { db, calls } = fakeDb([{ owner_name: "Dana Owner", owner_email: "dana@bank.example", team_name: "First Bank" }]);
    expect(await findLapsedTeam(8, db)).toEqual(LAPSED_TEAM);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toContain(8);
    expect(calls[0].values).toContain(PAST_DUE_GRACE_DAYS);
  });

  it("should_match_only_active_non_owner_seats_whose_active_owner_lapsed", async () => {
    const { db, calls } = fakeDb([]);
    expect(await findLapsedTeam(8, db)).toBeNull();
    const text = calls[0].text;
    expect(text).toContain("seat.membership_status = 'active'");
    expect(text).toContain("seat.membership_role <> 'owner'");
    expect(text).toContain("owner_seat.membership_role = 'owner'");
    expect(text).toContain("owner_seat.membership_status = 'active'");
    expect(text).toContain("owner_user.is_active = true");
    expect(text).toContain("owner_user.subscription_status = 'past_due'");
    // An unknown past-due start counts as in grace (the seat still works), so it is never lapsed.
    expect(text).toContain("IS NOT NULL");
  });

  it("should_treat_blank_names_as_unknown", async () => {
    const { db } = fakeDb([{ owner_name: "  ", owner_email: null, team_name: "" }]);
    expect(await findLapsedTeam(8, db)).toEqual({ ownerName: null, ownerEmail: null, teamName: null });
  });

  it("should_fail_closed_to_null_when_the_query_errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb(new Error("relation does not exist"));
    expect(await findLapsedTeam(8, db)).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("teamBillingContact", () => {
  it("should_name_the_owner_and_team_and_link_the_owner_email", () => {
    expect(teamBillingContact(LAPSED_TEAM, "hello@example.com")).toEqual({
      who: "Dana Owner",
      team: "First Bank",
      href: "mailto:dana@bank.example",
      linkLabel: "Email Dana Owner",
    });
  });

  it("should_fall_back_to_the_team_owner_and_our_address_when_unknown", () => {
    expect(teamBillingContact({ ownerName: null, ownerEmail: null, teamName: null }, "hello@example.com")).toEqual({
      who: "your team's owner",
      team: null,
      href: "mailto:hello@example.com",
      linkLabel: "Email us",
    });
  });

  it("should_use_the_owner_email_as_the_label_when_there_is_no_name", () => {
    const contact = teamBillingContact({ ownerName: null, ownerEmail: "dana@bank.example", teamName: null }, "x@y.z");
    expect(contact.who).toBe("your team's owner");
    expect(contact.linkLabel).toBe("Email dana@bank.example");
  });
});
