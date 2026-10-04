import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SimulateWorkspace } from "./SimulateWorkspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@ai-sdk/react", () => ({
  useCompletion: () => ({
    complete: vi.fn(),
    completion: "",
    isLoading: false,
  }),
}));

vi.mock("@/app/pro/(hamilton)/simulate/actions", () => ({
  getSimulationCategories: vi.fn(() => Promise.resolve([])),
  getDistributionForCategory: vi.fn(),
  getInstitutionFee: vi.fn(),
  getScenario: vi.fn(),
  saveScenario: vi.fn(),
  listScenarios: vi.fn(() => Promise.resolve([])),
}));

describe("SimulateWorkspace", () => {
  it("labels scenario modeling as verified-only and manual instead of fake live sync", () => {
    const html = renderToStaticMarkup(
      <SimulateWorkspace
        userId={42}
        institutionId="2945"
        institutionContext={{
          name: "Example Bank",
          type: "Bank",
          assetTier: "1B-10B",
          fedDistrict: 10,
        }}
        savedPeerSets={[]}
        selectedSource="manual"
        selectedSourceLabel="Manual"
      />,
    );

    expect(html).toContain("Verified-only benchmark");
    expect(html).toContain("Provisional rows excluded from scoring");
    expect(html).toContain("Your what-if");
    expect(html).not.toContain("No provider automation queued");
    expect(html).toContain("Evidence posture:");
    expect(html).not.toContain("Last Live Sync");
    expect(html).not.toContain("Live Simulation Mode");
  });
});
