import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NON_INSTITUTION_TIER, PRO_TIERS, annualMonthsFree, annualSavingsLabel, tierAmountLabel } from "@/lib/pro-tiers";

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ trackEvent: (...args: unknown[]) => track(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/stripe-actions", () => ({ createCheckoutSession: vi.fn() }));
vi.mock("@/components/track-link", () => ({
  TrackLink: ({ event, href, className, children }: { event: string; href: string; className?: string; children: React.ReactNode }) => (
    <a href={href} className={className} data-event={event}>
      {children}
    </a>
  ),
}));

import { apiIncludedInTier } from "@/lib/api-subscriber-access";
import {
  API_CARD_LINE,
  API_DETAILS,
  API_DETAILS_SUMMARY,
  API_INCLUDES_LINE,
  CONSULTANT_API_NOTE,
  CHECKOUT_ID,
  BILLING_TERMS_LINE,
  CANCEL_TERMS_LINE,
  CONSULTANT_PRICING_LABEL,
  ONE_SUBSCRIPTION_LINE,
  SAME_WORKSPACE_LINE,
  PLANS_ID,
  PlanBenefits,
  ProPlanBoard,
  RECOMMENDED_PLAN,
  SELECT_INSTITUTION_LABEL,
} from "./pro-plan-cards";
import { OPEN_LOOKUP_EVENT } from "./pricing-jump";

const registerHref = { annual: "/register?plan=annual", monthly: "/register?plan=monthly" };

function board(overrides: Partial<React.ComponentProps<typeof ProPlanBoard>> = {}) {
  return render(
    <ProPlanBoard
      isLoggedIn={false}
      chooser={<input id="pro_tier_institution" aria-label="Find your institution" />}
      selection={null}
      selectedName={null}
      destination={null}
      registerHref={registerHref}
      initialPlan={null}
      entry="direct"
      {...overrides}
    />,
  );
}

const cards = () => within(document.getElementById(PLANS_ID)!).getAllByRole("listitem");

afterEach(() => {
  track.mockClear();
  document.body.innerHTML = "";
});

describe("/subscribe plan board", () => {
  it("opens on the recommended plan, annual, with every tier priced from PRO_TIERS", () => {
    board();
    expect(RECOMMENDED_PLAN).toBe("annual");
    expect(screen.getByRole("button", { name: /Annual/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Annual/ }).textContent).toContain("Recommended");
    expect(cards()).toHaveLength(PRO_TIERS.length);
    PRO_TIERS.forEach((tier, i) => {
      expect(cards()[i].textContent).toContain(tier.assetsLabel);
      expect(cards()[i].textContent).toContain(tierAmountLabel(tier.key, "annual"));
      expect(cards()[i].textContent).toContain(`save ${annualSavingsLabel(tier.key)}`);
    });
  });

  it("the toggle switches every card to the monthly price and records the choice", () => {
    board();
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
    PRO_TIERS.forEach((tier, i) => expect(cards()[i].textContent).toContain(`${tierAmountLabel(tier.key, "monthly")}/ month`));
    expect(track).toHaveBeenCalledWith("billing_frequency_selected", { plan: "monthly", entry: "direct" });
  });

  it("puts the prices first: each card has a Select institution button that opens the lookup below the cards", () => {
    Element.prototype.scrollIntoView = vi.fn();
    board();
    const panel = document.getElementById(CHECKOUT_ID)!;
    expect(panel).not.toBeVisible();
    // The cards come before the lookup.
    expect(document.getElementById(PLANS_ID)!.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const card of cards()) expect(within(card).getByRole("button", { name: SELECT_INSTITUTION_LABEL })).toBeInTheDocument();
    fireEvent.click(within(cards()[2]).getByRole("button", { name: SELECT_INSTITUTION_LABEL }));
    expect(panel).toBeVisible();
    expect(within(panel).getByRole("heading", { name: "Find your institution" })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById("pro_tier_institution"));
    expect(track).toHaveBeenCalledWith("pricing_lookup_opened", { tier: PRO_TIERS[2].key, entry: "direct" });
    expect(screen.queryByRole("link", { name: /Subscribe/ })).toBeNull();
  });

  it("opens the lookup when another pricing button asks for it", () => {
    board();
    expect(document.getElementById(CHECKOUT_ID)!).not.toBeVisible();
    act(() => {
      window.dispatchEvent(new Event(OPEN_LOOKUP_EVENT));
    });
    expect(document.getElementById(CHECKOUT_ID)!).toBeVisible();
  });

  it("starts with the lookup open when the URL already names an institution", () => {
    board({ lookupOpen: true });
    expect(document.getElementById(CHECKOUT_ID)!).toBeVisible();
  });

  it("the toggle buttons say which billing is on, and the recommended chip states the shared months free", () => {
    board();
    expect(screen.getByRole("group", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Annual/ }).textContent).toContain(`${annualMonthsFree(PRO_TIERS[0].key)} months free`);
  });

  it("a consultant's card reads Consultant price, not Your price", () => {
    board({ selection: { tier: NON_INSTITUTION_TIER, institutionId: null, otherOrganization: true } });
    const mine = cards().find((card) => card.getAttribute("aria-current") === "true");
    expect(mine?.getAttribute("data-tier")).toBe(NON_INSTITUTION_TIER);
    expect(mine?.textContent).toContain("Consultant price");
    expect(mine?.textContent).not.toContain("Your price");
    expect(document.getElementById(CHECKOUT_ID)!.textContent).toContain(CONSULTANT_API_NOTE);
  });

  it("marks the chosen institution's tier and checks out at the toggle's billing", () => {
    const mid = PRO_TIERS[1];
    board({
      selection: { tier: mid.key, institutionId: 323, otherOrganization: false },
      selectedName: "Capital City Bank, Tallahassee, FL",
      initialPlan: "monthly",
    });
    const mine = cards().find((card) => card.getAttribute("aria-current") === "true");
    expect(mine?.getAttribute("data-tier")).toBe(mid.key);
    expect(mine?.textContent).toContain("Your price");
    expect(mine?.textContent).toContain("Capital City Bank, Tallahassee, FL");
    expect(document.getElementById(CHECKOUT_ID)?.className).toContain("md:grid-cols-2");

    const monthly = screen.getByRole("link", { name: `Subscribe monthly · ${tierAmountLabel(mid.key, "monthly")}/month` });
    expect(monthly).toHaveAttribute("href", registerHref.monthly);
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    expect(screen.getByRole("link", { name: `Subscribe annually · ${tierAmountLabel(mid.key, "annual")}/year` })).toHaveAttribute(
      "href",
      registerHref.annual,
    );
    expect(track).toHaveBeenCalledWith("billing_frequency_selected", { plan: "annual", tier: mid.key, entry: "direct" });
  });

  it("shows the API as a secondary inclusion on the plans that include it", () => {
    board();
    expect(PRO_TIERS.filter((tier) => apiIncludedInTier(tier.key)).map((tier) => tier.key)).toEqual(["mid", "large"]);
    PRO_TIERS.forEach((tier, i) => {
      expect(cards()[i].textContent?.includes(API_CARD_LINE)).toBe(apiIncludedInTier(tier.key));
    });
    // The consultant price is the mid tier, so consultants get it too.
    expect(apiIncludedInTier(NON_INSTITUTION_TIER)).toBe(true);
  });

  it("says the cards are one subscription with one workspace, API access the only difference", () => {
    board();
    const text = document.body.textContent ?? "";
    expect(text).toContain(ONE_SUBSCRIPTION_LINE);
    expect(ONE_SUBSCRIPTION_LINE).toBe("One subscription, priced by institution size.");
    expect(SAME_WORKSPACE_LINE).toContain("same Hamilton workspace");
    expect(SAME_WORKSPACE_LINE).toContain("API access, included from $500M");
  });

  it("before a choice, states the billing and cancellation terms as two lines", () => {
    board();
    const terms = document.querySelector("[data-plan-terms]")!;
    expect(terms.querySelectorAll("p")).toHaveLength(2);
    expect(terms.textContent).toContain(BILLING_TERMS_LINE);
    expect(terms.textContent).toContain(CANCEL_TERMS_LINE);
    expect(BILLING_TERMS_LINE).toContain("within 14 days of the first payment");
  });

  it("shows a Consultant pricing link under the cards before any lookup is opened", () => {
    board({ consultantHref: "/subscribe?org=other#pro-heading" });
    expect(screen.getByRole("link", { name: CONSULTANT_PRICING_LABEL })).toHaveAttribute("href", "/subscribe?org=other#pro-heading");
  });
});

describe("/subscribe plan benefits", () => {
  it("lists the shared benefits, then the API line with its limits in a closed API access details", () => {
    render(<PlanBenefits />);
    expect(screen.getByRole("heading", { name: "Every plan includes" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("Full Bank Fee Index access");
    expect(API_INCLUDES_LINE).toBe("Included on $500M+ plans and for consultants");
    const details = screen.getByText(API_DETAILS_SUMMARY).closest("details")!;
    expect(details.open).toBe(false);
    for (const line of API_DETAILS) expect(details.textContent).toContain(line);
    expect(API_DETAILS.join(" ")).toMatch(/10,000 API calls a month, shared/);
    expect(API_DETAILS.join(" ")).toMatch(/account holder makes it/);
  });
});
