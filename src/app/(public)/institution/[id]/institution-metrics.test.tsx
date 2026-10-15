import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildPublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { InstitutionOfferBand } from "./institution-metrics";

vi.mock("@/components/track-link", () => ({
  TrackLink: ({ event, eventProps, href, children }: {
    event: string; eventProps?: { placement?: string }; href: string; children: React.ReactNode;
  }) => (
    <a href={href} data-event={event} data-placement={eventProps?.placement}>
      {children}
    </a>
  ),
}));

describe("InstitutionOfferBand", () => {
  it("opens the plans on this institution's tier and offers a demo (growth OS review M2, M4)", () => {
    const links = buildPublicInstitutionProfileLinks({ institutionId: 8109, institutionName: "Space Coast", isAuthenticated: false });
    const html = renderToStaticMarkup(
      <InstitutionOfferBand
        institutionName="Space Coast"
        reportOfferHref={links.reportOfferHref}
        plansHref={links.plansHref}
        correctSourceHref={links.correctSourceHref}
      />,
    ).replace(/&amp;/g, "&");
    expect(html).toContain('href="/subscribe?inst=8109&from=%2Finstitution%2F8109#pro" data-event="upgrade_click" data-placement="institution_offer"');
    expect(html).toContain('href="/contact?source=demo" data-event="contact_sales" data-placement="institution_offer_demo">Or ask for a demo');
  });
});
