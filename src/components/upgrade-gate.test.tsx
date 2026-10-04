import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/public-stats", () => ({
  getPublicStatsSummary: vi.fn(async () => ({
    categories: 40,
    categoriesLabel: "40",
    observationsLabel: "1,000",
    institutionsLabel: "100",
  })),
}));

import { UpgradeGate } from "./upgrade-gate";

describe("UpgradeGate", () => {
  it("speaks to consumers without selling exports or district data", async () => {
    render(await UpgradeGate({ audience: "consumer", message: "Overdraft by charter, asset size and state" }));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Everything above stays free");
    expect(text).not.toMatch(/CSV|district|API/i);
    expect(screen.getByRole("link", { name: /See pricing/ })).toHaveAttribute("href", "/subscribe");
  });

  it("keeps the professional pitch by default", async () => {
    render(await UpgradeGate({}));
    expect(document.body.textContent).toContain("CSV exports");
  });
});
