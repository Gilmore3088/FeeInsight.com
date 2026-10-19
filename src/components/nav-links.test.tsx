import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/fees" }));
vi.mock("./use-session-chrome", () => ({ useSessionChrome: () => ({ signedIn: false }) }));

import { NavLinks } from "./nav-links";

describe("NavLinks Product menu", () => {
  it("opens three cards with their links, the plans button on Hamilton's", () => {
    render(<NavLinks />);
    fireEvent.click(screen.getByRole("button", { name: "Product" }));
    const menu = screen.getByRole("link", { name: /Bank Fee Index/ }).closest("[id]") as HTMLElement;
    expect(menu).not.toHaveAttribute("hidden");
    const m = within(menu);
    expect(m.getByRole("link", { name: /Bank Fee Index/ })).toHaveAttribute("aria-current", "page");
    expect(m.getByRole("link", { name: /Find your institution/ })).toHaveAttribute("href", "/institutions");
    expect(m.getByRole("link", { name: /National index/ })).toHaveAttribute("href", "/research/national-fee-index");
    expect(m.getByRole("link", { name: /Market Benchmarks/ })).toHaveAttribute("href", "/research");
    expect(m.getByRole("link", { name: /Reports/ })).toHaveAttribute("href", "/reports");
    expect(m.getByRole("link", { name: /^Hamilton/ })).toHaveAttribute("href", "/for-institutions#hamilton");
    expect(m.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/subscribe");
    expect(m.getByRole("link", { name: "Ask for a demo" })).toHaveAttribute("href", "/for-institutions#demo");
    expect(menu.textContent).not.toMatch(/every fee/i);
    expect(menu.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("opens Resources as a how-it's-built card beside a short list", () => {
    render(<NavLinks />);
    fireEvent.click(screen.getByRole("button", { name: "Resources" }));
    const menu = screen.getByRole("link", { name: /How the index is built/ }).closest("[id]") as HTMLElement;
    expect(menu).not.toHaveAttribute("hidden");
    const m = within(menu);
    expect(m.getByRole("link", { name: /How the index is built/ })).toHaveAttribute("href", "/methodology");
    expect(m.getByRole("link", { name: /Data sources/ })).toHaveAttribute("href", "/research/data-sources");
    for (const [name, href] of [["Guides", "/guides"], ["API", "/api-docs"], ["Submit a fee source", "/submit-fees"]]) {
      expect(m.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
    }
  });
});
