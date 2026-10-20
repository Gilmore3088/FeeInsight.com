import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  chosen: vi.fn(),
  pricing: vi.fn(),
  ProPlanBoard: vi.fn(() => null),
  ProTierChooser: vi.fn(() => null),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => false }));
vi.mock("@/lib/subscription-activation", () => ({ activateIfPaid: async () => false }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/components/consumer-nav", () => ({ ConsumerNav: () => null }));
vi.mock("@/components/customer-footer", () => ({ CustomerFooter: () => null }));
vi.mock("@/components/public/search-modal", () => ({ SearchModal: () => null }));
vi.mock("@/components/track-view", () => ({ TrackView: () => null }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ getPendingWorkspaceInvitationsForEmail: async () => [] }));
vi.mock("@/lib/public-stats", () => ({ getPublicStatsSummary: async () => ({}) }));
vi.mock("@/lib/custom-report/sample-report", () => ({ loadSampleReport: async () => null }));
vi.mock("@/lib/data-store/connection", () => ({ sql: "db" }));
vi.mock("@/lib/data-store/pro-accounts", () => ({ getProPricingInstitution: mocks.pricing }));
vi.mock("@/lib/pro-checkout-institution", () => ({ chosenProInstitutionId: mocks.chosen }));
vi.mock("./pro-plan-cards", () => ({ ProPlanBoard: mocks.ProPlanBoard, PlanBenefits: () => null }));
vi.mock("./pro-tier-chooser", () => ({ ProTierChooser: mocks.ProTierChooser }));
vi.mock("./report-excerpt", () => ({ ReportExcerpt: () => null }));
vi.mock("./pricing-sections", () => ({ GatedOptions: () => null, OtherOptions: () => null, PricingFaq: () => null }));
vi.mock("./pricing-jump", () => ({ PricingJump: () => null }));
vi.mock("./sticky-cta", () => ({ StickyCta: () => null }));

import SubscribePage from "./page";

function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as ReactElement<Record<string, unknown>>;
  return find((node.props as { children?: ReactNode }).children, type);
}

async function board(params: Record<string, string>) {
  const page = await SubscribePage({ searchParams: Promise.resolve(params) });
  const element = find(page, mocks.ProPlanBoard);
  expect(element).not.toBeNull();
  return element!.props as {
    selection: { institutionId: number | null; tier: string } | null;
    selectedName: string | null;
    autoStartPlan: string | null;
    chooser: ReactElement<{ chosenLabel: string | null; institutionId: number | null }>;
  };
}

const capitalCity = { id: 2945, name: "Capital City Bank", city: "Tallahassee", stateCode: "FL", assetsThousands: 4_300_000, assetsReport: null };

beforeEach(() => {
  vi.clearAllMocks();
  // postgres.js returns users.id (bigint) as a string.
  mocks.user.mockResolvedValue({ id: "26", email: "james@bankfeeindex.com", username: "james", role: "viewer" });
  mocks.chosen.mockResolvedValue(2945);
  mocks.pricing.mockImplementation(async (id: number) => (id === 2945 ? capitalCity : id === 8109 ? { ...capitalCity, id: 8109, name: "Other Bank" } : null));
});

describe("/subscribe pre-fills the institution the buyer already chose (#1958)", () => {
  it("prices a signed-in user's chosen institution with no ?inst= and no new search", async () => {
    const props = await board({ plan: "annual", checkout: "1" });
    expect(mocks.chosen).toHaveBeenCalledWith("db", "26");
    // The tier is read on the server from the institution, never from the browser.
    expect(mocks.pricing).toHaveBeenCalledWith(2945);
    expect(props.selection).toMatchObject({ institutionId: 2945 });
    expect(props.selectedName).toBe("Capital City Bank, Tallahassee, FL");
    expect(props.chooser.props.chosenLabel).toBe("Capital City Bank, Tallahassee, FL");
    expect(props.chooser.props.institutionId).toBe(2945);
    // Shown first, never sent to Stripe unseen.
    expect(props.autoStartPlan).toBeNull();
  });

  it("lets ?inst= win, and keeps auto-start for an institution named in the URL", async () => {
    const props = await board({ inst: "8109", plan: "annual", checkout: "1" });
    expect(mocks.chosen).not.toHaveBeenCalled();
    expect(props.selection).toMatchObject({ institutionId: 8109 });
    expect(props.autoStartPlan).toBe("annual");
  });

  it("shows the search after Change, and for a consultant", async () => {
    for (const params of [{ change: "1" }, { org: "other" }] as Array<Record<string, string>>) {
      mocks.chosen.mockClear();
      const props = await board(params);
      expect(mocks.chosen).not.toHaveBeenCalled();
      expect(props.selection?.institutionId ?? null).toBeNull();
    }
  });

  it("asks a signed-out visitor to search, as before", async () => {
    mocks.user.mockResolvedValue(null);
    const props = await board({});
    expect(mocks.chosen).not.toHaveBeenCalled();
    expect(props.selection).toBeNull();
    expect(props.chooser.props.chosenLabel).toBeNull();
  });
});
