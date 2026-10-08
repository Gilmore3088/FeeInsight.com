import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setEmail: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("./actions", () => ({ updateProfile: vi.fn(), logoutAction: vi.fn() }));
vi.mock("./alert-actions", () => ({ removeInstitutionAlert: vi.fn() }));
vi.mock("./email-actions", () => ({ setAccountEmail: mocks.setEmail }));
vi.mock("@/lib/stripe-actions", () => ({ createPortalSession: vi.fn() }));
vi.mock("@/lib/access", () => ({ isInPaymentGrace: () => false }));

import { AccountView, type AccountViewData } from "./account-view";

const base: AccountViewData = {
  heading: "First Bank",
  email: "pat@firstbank.com",
  justSubscribed: false,
  statusUser: { role: "viewer", subscription_status: "none", stripe_customer_id: null, past_due_since: null },
  invitations: [],
  plan: { kind: "free", fromMonthlyUsd: 150 },
  subscriptions: [],
  reports: null,
  ownInstitution: null,
  emails: null,
  profile: { institution_name: "First Bank", institution_type: "bank", asset_tier: null, state_code: "TX", job_role: null },
};

const proPlan = {
  kind: "pro" as const,
  access: "subscription" as const,
  billing: {
    cadence: "Annual",
    priceLabel: "$3,000 per year",
    tierLabel: "$500M to $2B in assets",
    periodEnd: new Date("2027-10-08T00:00:00Z"),
    cancelsAtPeriodEnd: false,
  },
  canManageBilling: true,
  seatInstitutionName: null,
  team: { institutionName: "First Bank", used: 3, limit: 5 },
  hamiltonHref: "/pro/hamilton?instId=7",
};

function section(name: string) {
  return screen.getByRole("region", { name });
}

describe("AccountView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("free: plan, banks, organization and sign-in in that order, with the lowest Pro price", () => {
    render(<AccountView data={base} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Your plan", "Your reports", "Banks you follow", "Your organization", "Sign-in"]);
    expect(section("Your plan")).toHaveTextContent("From $150 a month");
    expect(within(section("Your plan")).getByRole("link", { name: "See Pro plans" })).toHaveAttribute(
      "href",
      "/subscribe?from=%2Faccount",
    );
    expect(screen.queryByText(/Quick Actions|Institution Authority|API Keys/i)).toBeNull();
  });

  it("pro: plan details, team seats, Hamilton and billing", () => {
    render(<AccountView data={{ ...base, plan: proPlan, emails: { watchlist_alerts: true, pro_digest: false } }} />);
    const plan = section("Fee Insight Pro");
    expect(plan).toHaveTextContent("$3,000 per year");
    expect(plan).toHaveTextContent("RenewsOctober 8, 2027");
    expect(plan).toHaveTextContent("Team: 3 of 5 seats used");
    expect(within(plan).getByRole("link", { name: "Open Hamilton" })).toHaveAttribute("href", "/pro/hamilton?instId=7");
    expect(within(plan).getByRole("button", { name: "Billing and invoices" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Competitor fee alerts" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Monday digest" })).toHaveAttribute("aria-checked", "false");
  });

  it("seat holder: no billing button, says who pays", () => {
    render(
      <AccountView
        data={{
          ...base,
          plan: { ...proPlan, access: "seat", billing: null, canManageBilling: false, team: null, seatInstitutionName: "First Bank" },
        }}
      />,
    );
    const plan = section("Fee Insight Pro");
    expect(plan).toHaveTextContent("You’re on First Bank's team plan");
    expect(within(plan).queryByRole("button", { name: "Billing and invoices" })).toBeNull();
  });

  it("an email switch flips back when the save fails", async () => {
    mocks.setEmail.mockResolvedValue({ ok: false, error: "That didn't save. Try again." });
    render(<AccountView data={{ ...base, plan: proPlan, emails: { watchlist_alerts: true, pro_digest: true } }} />);
    const digest = screen.getByRole("switch", { name: "Monday digest" });
    fireEvent.click(digest);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That didn't save"));
    expect(digest).toHaveAttribute("aria-checked", "true");
    expect(mocks.setEmail).toHaveBeenCalledWith("pro_digest", false);
  });

  it("pro: lists the user's reports with links", () => {
    render(
      <AccountView
        data={{
          ...base,
          plan: proPlan,
          reports: [{ id: "r1", title: "Overdraft position vs Texas peers", createdAt: "2026-10-07T12:00:00Z", href: "/pro/reports?report_id=r1" }],
        }}
      />,
    );
    const reports = section("Your reports");
    expect(within(reports).getByRole("link", { name: /Overdraft position vs Texas peers/ })).toHaveAttribute(
      "href",
      "/pro/reports?report_id=r1",
    );
    expect(within(reports).getByRole("link", { name: "All reports" })).toHaveAttribute("href", "/pro/reports");
  });

  it("asks for the fee schedule only when the bank is under the 3-fee bar", () => {
    const { rerender } = render(
      <AccountView data={{ ...base, ownInstitution: { id: 42, name: "First Bank", publishedFeeCount: 0 } }} />,
    );
    const reminder = screen.getByRole("region", { name: "We don’t have First Bank’s fee schedule yet" });
    expect(within(reminder).getByRole("link", { name: "Send the link" })).toHaveAttribute(
      "href",
      "/submit-fees?institutionId=42&institutionName=First%20Bank",
    );
    expect(within(reminder).getByRole("link", { name: "Email it to us" }).getAttribute("href")).toContain(
      "subject=Fee%20schedule%20for%20First%20Bank",
    );
    rerender(<AccountView data={{ ...base, ownInstitution: { id: 42, name: "First Bank", publishedFeeCount: 12 } }} />);
    expect(screen.queryByText(/fee schedule yet/)).toBeNull();
  });

  it("a pending team invite shows first", () => {
    render(<AccountView data={{ ...base, invitations: [{ id: 1, institutionName: "Lone Star CU", role: "analyst" }] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("You're invited to Lone Star CU's Pro team.");
  });
});
