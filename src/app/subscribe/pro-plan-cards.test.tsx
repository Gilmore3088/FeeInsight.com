import { fireEvent, render, screen, within } from "@testing-library/react";
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
import { API_LINE, CHECKOUT_ID, PLANS_ID, ProPlanBoard, RECOMMENDED_PLAN } from "./pro-plan-cards";

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

  it("before an institution is chosen, the search is the one step: one column, no card buttons, no checkout", () => {
    board();
    const panel = document.getElementById(CHECKOUT_ID)!;
    expect(within(panel).getByRole("heading", { name: "Find your price" })).toBeInTheDocument();
    expect(within(panel).getByLabelText("Find your institution")).toBeInTheDocument();
    expect(panel.className).not.toContain("md:grid-cols-2");
    // The search sits under the toggle, above the cards.
    expect(panel.compareDocumentPosition(document.getElementById(PLANS_ID)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const card of cards()) expect(within(card).queryByRole("link")).toBeNull();
    expect(screen.queryByRole("link", { name: /Subscribe/ })).toBeNull();
    expect(panel.textContent).not.toContain("Your price and checkout show here.");
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

  it("says the API and Claude connector come only on the plans that include them", () => {
    board();
    expect(PRO_TIERS.filter((tier) => apiIncludedInTier(tier.key)).map((tier) => tier.key)).toEqual(["mid", "large"]);
    PRO_TIERS.forEach((tier, i) => {
      expect(cards()[i].textContent?.includes(API_LINE)).toBe(apiIncludedInTier(tier.key));
    });
    // The consultant price is the mid tier, so consultants get it too.
    expect(apiIncludedInTier(NON_INSTITUTION_TIER)).toBe(true);
  });
});
