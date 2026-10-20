import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HamiltonLine } from "./hamilton-line";

vi.mock("@/components/track-link", () => ({
  TrackLink: ({ event, eventProps, href, children }: {
    event: string; eventProps?: { placement?: string }; href: string; children: React.ReactNode;
  }) => (
    <a href={href} data-event={event} data-placement={eventProps?.placement}>
      {children}
    </a>
  ),
}));

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("HamiltonLine (/reports, growth OS review M1)", () => {
  it("points on to Pro and the demo, naming Hamilton in full on first mention", () => {
    const html = renderToStaticMarkup(<HamiltonLine placement="reports_hub_form" firstMention />);
    expect(text(html)).toBe(
      "The report is a snapshot. Hamilton, the Fee Insight workspace, keeps your market current. See Hamilton plans · Or ask for a demo",
    );
    expect(html).toContain('href="/subscribe#pro" data-event="upgrade_click" data-placement="reports_hub_form"');
    expect(html).toContain('href="/for-institutions#demo" data-event="contact_sales" data-placement="reports_hub_form_demo"');
  });

  it("uses the short name after that", () => {
    const html = renderToStaticMarkup(<HamiltonLine placement="reports_hub_closing" tone="dark" />);
    expect(text(html)).toContain("The report is a snapshot. Hamilton keeps your market current.");
  });
});
