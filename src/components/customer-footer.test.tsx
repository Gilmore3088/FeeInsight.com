import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./public/email-signup", () => ({ EmailSignup: () => null }));

import { CustomerFooter, FOOTER_LEGAL_LINKS, FOOTER_LINKS } from "./customer-footer";
import { MARKS } from "@/brand/components";
import { MOBILE_NAV_SECTIONS, PUBLIC_NAV_ITEMS, menuLinks } from "./nav-items";

/** Pages that are gated or noindexed; the footer must not link to them (site v3 brief 05, section 3). */
const NOINDEXED = ["/research/fee-revenue-analysis", "/research/market-concentration", "/tools/price-check", "/guides/pro"];

/** Every page the four-column footer linked before it was cut to one band (2026-10-15). */
const FORMER_FOOTER_ONLY = [
  "/fees",
  "/institutions",
  "/research",
  "/research/national-fee-index",
  "/guides",
  "/methodology",
  "/research/data-sources",
  "/api-docs",
  "/submit-fees",
];

const path = (href: string) => href.split("#")[0];

describe("CustomerFooter", () => {
  it("is one short band: at most eight links in all", () => {
    expect(FOOTER_LINKS.length + FOOTER_LEGAL_LINKS.length).toBeLessThanOrEqual(8);
    render(<CustomerFooter />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Product",
      "Reports",
      "Pricing",
      "For consumers",
      "About",
      "Contact",
    ]);
    expect(within(nav).getByRole("link", { name: "For consumers" })).toHaveAttribute("href", "/for-consumers");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "hello@bankfeeindex.com" })).toHaveAttribute(
      "href",
      "mailto:hello@bankfeeindex.com",
    );
  });

  it("carries the parent brand: the Fee Insight logo, and no Hamilton or Bank Fee Index mark", () => {
    const { container } = render(<CustomerFooter />);
    expect(screen.getByRole("link", { name: "Fee Insight: home" })).toHaveAttribute("href", "/");
    const marks = Array.from(container.querySelectorAll("svg.fi-mark")).map((svg) => svg.getAttribute("viewBox"));
    expect(marks).toEqual([MARKS["fee-insight-oneline"].viewBox]);
    expect(container.textContent).not.toMatch(/Hamilton/);
  });

  it("links no gated or noindexed page", () => {
    for (const { href } of [...FOOTER_LINKS, ...FOOTER_LEGAL_LINKS]) {
      expect(NOINDEXED.some((p) => href === p || href.startsWith(`${p}/`))).toBe(false);
    }
  });

  it("drops no destination: each page the old footer listed is still in the header menus", () => {
    const headerPaths = new Set(PUBLIC_NAV_ITEMS.flatMap((item) => [item.href, ...menuLinks(item).map((l) => l.href)]).map(path));
    for (const href of FORMER_FOOTER_ONLY) expect(headerPaths, href).toContain(href);
  });

  it("keeps the state and district hubs one tap away on a phone", () => {
    const drawerPaths = MOBILE_NAV_SECTIONS.flatMap((section) => section.items.map((l) => path(l.href)));
    expect(drawerPaths).toContain("/research");
  });
});
