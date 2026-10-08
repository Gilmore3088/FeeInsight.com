import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/pro/monitor", useSearchParams: () => new URLSearchParams("instId=8109") }));

import { activeTabHref, HamiltonTabStrip } from "./HamiltonTabStrip";

describe("HamiltonTabStrip", () => {
  it("lights the tab a screen belongs to", () => {
    expect(activeTabHref("/pro/simulate/plan")).toBe("/pro/simulate");
    expect(activeTabHref("/pro/monitor/deliverable")).toBe("/pro/hamilton");
    expect(activeTabHref("/pro/studies/market")).toBe("/pro/reports");
    expect(activeTabHref("/pro/analyze")).toBeNull();
  });

  it("shows the four tabs with the bank kept, and More opens the rest", () => {
    render(<HamiltonTabStrip />);
    expect(screen.getByRole("link", { name: "This month" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "My fees" }).getAttribute("href")).toBe("/pro/research?instId=8109");
    expect(screen.queryByRole("link", { name: "My bank and data" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("link", { name: "My bank and data" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Regulatory Wire" })).toBeTruthy();
  });
});
