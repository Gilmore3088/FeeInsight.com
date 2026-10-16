import { fireEvent, render, screen } from "@testing-library/react";
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

import { ApiHero, CodeBlock, EndpointList, GetKeyCta, KeysAndLimits, Quickstart } from "./api-docs-sections";
import { API_ENDPOINTS, API_ERRORS, RATE_LIMIT_HEADERS, coverageStrip, keyTiers } from "./api-docs-view";

const NO_DASH = /[–—]/;

describe("api-docs sections", () => {
  it("hero shows the live coverage strip it is given", () => {
    render(<ApiHero coverage={[{ label: "Institutions with published fees", value: "1,234" }]} freshnessLabel="Data refreshed Oct 1, 2026" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Bank Fee Index");
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("Data refreshed Oct 1, 2026")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NO_DASH);
  });

  it("code blocks scroll inside themselves and copy their text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CodeBlock label="Request" code="curl https://example.test" />);
    expect(document.querySelector("pre")?.className).toContain("overflow-x-auto");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("curl https://example.test");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("quickstart pairs the request with the response", () => {
    render(<Quickstart request="curl x" response='{"total": 6}' responseLabel="Live response" responseNote="free key" />);
    expect(screen.getByText("curl x")).toBeInTheDocument();
    expect(screen.getByText('{"total": 6}')).toBeInTheDocument();
    expect(screen.getByText("Live response")).toBeInTheDocument();
  });

  it("lists every endpoint with method, path, access, params and response shape", () => {
    render(<EndpointList endpoints={API_ENDPOINTS} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(API_ENDPOINTS.length);
    expect(screen.getByText("/api/v1/fees?category={key}")).toBeInTheDocument();
    expect(screen.getByText("/api/v1/mcp")).toBeInTheDocument();
    expect(screen.getAllByText("Pro key").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Rows per page. Default 50, up to 200");
    expect(screen.getByRole("link", { name: "Open the spec" })).toHaveAttribute("href", "/api/v1/openapi.json");
    expect(document.body.textContent).not.toMatch(NO_DASH);
  });

  it("keys and limits shows each tier's allowance and every error code", () => {
    render(
      <KeysAndLimits
        tiers={keyTiers({
          spotlightCount: 6,
          categoriesLabel: "49",
          unavailableLabel: "\u2014",
          limits: { free: 100, pro: 10_000, enterprise: Infinity },
        })}
        errors={API_ERRORS}
        headers={RATE_LIMIT_HEADERS}
      />,
    );
    expect(screen.getByText("10,000")).toBeInTheDocument();
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
    for (const error of API_ERRORS) expect(screen.getByText(error.code)).toBeInTheDocument();
    expect(screen.getByText("X-RateLimit-Reset")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NO_DASH);
  });

  it("a failed category read renders no dash in the hero or the tiers", () => {
    const dash = "\u2014";
    render(
      <>
        <ApiHero
          coverage={coverageStrip(
            { institutionsLabel: "1,200", observationsLabel: dash, categoriesLabel: dash, statesLabel: dash },
            { institutions: "Institutions with published fees", observations: "Entries", categories: "Categories" },
            dash,
          )}
          freshnessLabel="Data refresh pending"
        />
        <KeysAndLimits
          tiers={keyTiers({ spotlightCount: 6, categoriesLabel: dash, unavailableLabel: dash, limits: { free: 100, pro: 10_000, enterprise: Infinity } })}
          errors={API_ERRORS}
          headers={RATE_LIMIT_HEADERS}
        />
      </>,
    );
    expect(screen.getAllByText("All categories")).toHaveLength(2);
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NO_DASH);
  });

  it("the one next action is asking for a key, or a demo, with tracked links", () => {
    render(<GetKeyCta />);
    expect(screen.queryByRole("link", { name: /Hamilton plans/ })).toBeNull();
    const key = screen.getByRole("link", { name: "Ask for a key" });
    expect(key).toHaveAttribute("href", "/contact?source=partnership");
    expect(key).toHaveAttribute("data-event", "contact_sales");
    expect(key).toHaveAttribute("data-placement", "api_docs_key");
    const demo = screen.getByRole("link", { name: "Or ask for a demo" });
    expect(demo).toHaveAttribute("href", "/contact?source=demo");
    expect(demo).toHaveAttribute("data-event", "contact_sales");
  });
});
