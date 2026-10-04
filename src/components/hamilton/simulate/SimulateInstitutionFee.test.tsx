import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulateWorkspace } from "./SimulateWorkspace";

const actions = vi.hoisted(() => ({
  getSimulationCategories: vi.fn(),
  getDistributionForCategory: vi.fn(),
  getInstitutionFee: vi.fn(),
  getScenario: vi.fn(),
  saveScenario: vi.fn(),
  listScenarios: vi.fn(),
}));

// The Radix slider measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@ai-sdk/react", () => ({
  useCompletion: () => ({ complete: vi.fn(), completion: "", isLoading: false, error: undefined }),
}));
vi.mock("@/app/pro/(hamilton)/simulate/actions", () => actions);

function renderWorkspace() {
  return render(
    <SimulateWorkspace
      userId={42}
      institutionId="2945"
      initialCategory="wire_transfer"
      institutionContext={{ name: "Example Bank", type: "Bank", assetTier: "community", fedDistrict: 6 }}
      savedPeerSets={[]}
      selectedSource="manual"
      selectedSourceLabel="Manual"
    />,
  );
}

describe("Simulate with the selected institution's own fee", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    actions.listScenarios.mockResolvedValue([]);
    actions.getSimulationCategories.mockResolvedValue([
      { fee_category: "wire_transfer", display_name: "Wire Transfer", approved_count: 40, confidence_tier: "strong" },
    ]);
    actions.getDistributionForCategory.mockResolvedValue({
      distribution: {
        fee_category: "wire_transfer", median_amount: 25, p25_amount: 20, p75_amount: 30,
        min_amount: 10, max_amount: 45, approved_count: 40, institution_count: 24, peer_source: "national",
      },
      confidenceTier: "strong",
    });
  });

  afterEach(cleanup);

  it("starts from the institution's fee when it has one", async () => {
    actions.getInstitutionFee.mockResolvedValue({ amount: 32.5 });
    renderWorkspace();

    expect(await screen.findByText("Your Current Fee")).toBeTruthy();
    expect(screen.queryByText("Your institution has no published fee in this category.")).toBeNull();
  });

  it("says so when the institution has no fee, instead of passing the median off as its fee", async () => {
    actions.getInstitutionFee.mockResolvedValue(null);
    renderWorkspace();

    expect(await screen.findByText("Your institution has no published fee in this category.")).toBeTruthy();
    expect(screen.queryByText("Your Current Fee")).toBeNull();
  });
});
