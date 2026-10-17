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
    expect(text).toContain("Hamilton, the Fee Insight workspace");
    expect(text).not.toMatch(/Fee Insight Pro|Hamilton Pro/);
    expect(text).not.toMatch(/CSV|district|API/i);
    expect(screen.getByRole("link", { name: /See Hamilton plans/ })).toHaveAttribute("href", "/subscribe#pro");
  });

  it("keeps the professional pitch by default", async () => {
    render(await UpgradeGate({}));
    expect(document.body.textContent).toContain("CSV exports");
  });

  it("sends readers back to the page they were on", async () => {
    headerPath.value = "/research/market-concentration";
    render(await UpgradeGate({ message: "Market concentration" }));
    expect(screen.getByRole("link", { name: /See Hamilton plans/ })).toHaveAttribute(
      "href",
      "/subscribe?from=%2Fresearch%2Fmarket-concentration#pro",
    );
    headerPath.value = null;
  });

  it("prefers an explicit from and says what is locked", async () => {
    render(await UpgradeGate({ from: "/fees/overdraft", locked: "Overdraft by asset size." }));
    expect(document.body.textContent).toContain("Overdraft by asset size.");
    expect(document.body.textContent).not.toContain("CSV exports");
    expect(screen.getByRole("link", { name: /See Hamilton plans/ })).toHaveAttribute("href", "/subscribe?from=%2Ffees%2Foverdraft#pro");
  });
});

describe("UpgradeGate links", () => {
  it("uses the caller's plans link, so the institution page opens /subscribe on that institution", async () => {
    headerPath.value = "/institution/8109";
    render(await UpgradeGate({ href: "/subscribe?inst=8109&from=%2Finstitution%2F8109#pro" }));
    expect(screen.getByRole("link", { name: /See Hamilton plans/ })).toHaveAttribute(
      "href",
      "/subscribe?inst=8109&from=%2Finstitution%2F8109#pro",
    );
    headerPath.value = null;
  });

  it("ignores an outside link and keeps the default", async () => {
    render(await UpgradeGate({ href: "https://evil.example", from: "/fees" }));
    expect(screen.getByRole("link", { name: /See Hamilton plans/ })).toHaveAttribute("href", "/subscribe?from=%2Ffees#pro");
  });

  it("compact: names Hamilton in full and shows the plans link underlined at rest", async () => {
    render(await UpgradeGate({ compact: true, message: "Overdraft by state", from: "/fees/overdraft" }));
    expect(document.body.textContent).toContain("Overdraft by state with Hamilton, the Fee Insight workspace");
    const link = screen.getByRole("link", { name: /See Hamilton plans/ });
    expect(link).toHaveAttribute("href", "/subscribe?from=%2Ffees%2Foverdraft#pro");
    expect(link.className.split(" ")).toContain("underline");
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
