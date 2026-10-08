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

const headerPath = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    if (headerPath.value === null) throw new Error("outside a request");
    return new Headers({ "x-pathname": headerPath.value });
  }),
}));

import { gateReturnPath, UpgradeGate } from "./upgrade-gate";

describe("UpgradeGate", () => {
  it("speaks to consumers without selling exports or district data", async () => {
    render(await UpgradeGate({ audience: "consumer", message: "Overdraft by charter, asset size and state" }));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Everything above stays free");
    expect(text).not.toMatch(/CSV|district|API/i);
    expect(screen.getByRole("link", { name: /See pricing/ })).toHaveAttribute("href", "/subscribe#pro");
  });

  it("keeps the professional pitch by default", async () => {
    render(await UpgradeGate({}));
    expect(document.body.textContent).toContain("CSV exports");
  });

  it("sends readers back to the page they were on", async () => {
    headerPath.value = "/research/market-concentration";
    render(await UpgradeGate({ message: "Market concentration" }));
    expect(screen.getByRole("link", { name: /See pricing/ })).toHaveAttribute(
      "href",
      "/subscribe?from=%2Fresearch%2Fmarket-concentration#pro",
    );
    headerPath.value = null;
  });

  it("prefers an explicit from and says what is locked", async () => {
    render(await UpgradeGate({ from: "/fees/overdraft", locked: "Overdraft by asset size." }));
    expect(document.body.textContent).toContain("Overdraft by asset size.");
    expect(document.body.textContent).not.toContain("CSV exports");
    expect(screen.getByRole("link", { name: /See pricing/ })).toHaveAttribute("href", "/subscribe?from=%2Ffees%2Foverdraft#pro");
  });
});

describe("gateReturnPath", () => {
  it("allows only internal paths", () => {
    expect(gateReturnPath("/fees")).toBe("/fees");
    expect(gateReturnPath("//evil.example")).toBeNull();
    expect(gateReturnPath("https://evil.example")).toBeNull();
    expect(gateReturnPath(null)).toBeNull();
  });
});
