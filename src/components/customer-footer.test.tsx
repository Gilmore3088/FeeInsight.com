import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./public/email-signup", () => ({ EmailSignup: () => null }));

import { CustomerFooter, FOOTER_COLUMNS } from "./customer-footer";

/** Pages that are gated or noindexed; the footer must not link to them (site v3 brief 05, section 3). */
const NOINDEXED = ["/research/fee-revenue-analysis", "/research/market-concentration", "/tools/price-check", "/guides/pro"];

describe("CustomerFooter", () => {
  it("has the four columns from the site v3 brief", () => {
    expect(FOOTER_COLUMNS.map((c) => c.heading)).toEqual(["Product", "Resources", "Company", "Legal"]);
    render(<CustomerFooter />);
    expect(screen.getByRole("link", { name: "Hamilton" })).toHaveAttribute("href", "/for-institutions");
    expect(screen.getByRole("link", { name: "State reports" })).toHaveAttribute("href", "/research#states");
    expect(screen.getByRole("link", { name: "Methodology" })).toHaveAttribute("href", "/methodology");
  });

  it("links no gated or noindexed page", () => {
    const hrefs = FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href));
    for (const href of hrefs) {
      expect(NOINDEXED.some((path) => href === path || href.startsWith(`${path}/`))).toBe(false);
    }
  });

  it("lists the sample report under Product only when the page says it can be shown", () => {
    const { unmount } = render(<CustomerFooter />);
    expect(screen.queryByRole("link", { name: "Sample report" })).toBeNull();
    unmount();
    render(<CustomerFooter sampleReport />);
    expect(screen.getByRole("link", { name: "Sample report" })).toHaveAttribute(
      "href",
      "/reports/sample-competitive-fee-position",
    );
  });
});
