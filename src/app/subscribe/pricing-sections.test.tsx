import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/track-link", () => ({
  TrackLink: ({ event, eventProps, href, className, children }: {
    event: string; eventProps?: { placement?: string }; href: string; className?: string; children: React.ReactNode;
  }) => (
    <a href={href} className={className} data-event={event} data-placement={eventProps?.placement}>
      {children}
    </a>
  ),
}));

import { GatedOptions, OtherOptions } from "./pricing-sections";

describe("/subscribe demo links (growth OS review N3)", () => {
  it("gated state: offers the demo first, in the site's one wording", () => {
    render(<GatedOptions reportHref="/reports?report=institution&src=subscribe#request" />);
    expect(document.body.textContent).toContain("Want to see Hamilton first? Ask for a demo");
    const demo = screen.getByRole("link", { name: "Ask for a demo" });
    expect(demo).toHaveAttribute("href", "/contact?source=demo");
    expect(demo).toHaveAttribute("data-event", "contact_sales");
    expect(demo).toHaveAttribute("data-placement", "pricing_gated_demo");
    expect(screen.getByRole("link", { name: /Explore the/ })).toHaveAttribute(
      "href",
      "/reports?report=institution&src=subscribe#request",
    );
  });

  it("direct visit: the demo row says Ask for a demo, never Request a demo", () => {
    render(<OtherOptions />);
    const demo = screen.getByRole("link", { name: "Ask for a demo" });
    expect(demo).toHaveAttribute("href", "/contact?source=demo");
    // Its own placement, apart from the Hamilton window's link (pricing_exhibit_demo).
    expect(demo).toHaveAttribute("data-placement", "pricing_demo");
    expect(document.body.textContent).not.toContain("Request a demo");
  });
});
