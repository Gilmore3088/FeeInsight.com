import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, LEGAL_ENTITY_LINE } from "@/lib/constants";
import { UNAVAILABLE_LABEL } from "@/lib/public-stats";
import { AboutBlocks, AboutContact, AboutHero, AboutNextAction } from "./about-sections";
import { ABOUT_BLOCKS, aboutNextAction, aboutProof } from "./about-view";

const LIVE = {
  monitored: 8000,
  monitoredLabel: "8,000",
  institutions: 2000,
  institutionsLabel: "2,000",
  observations: 40000,
  observationsLabel: "40,000",
  refreshedOn: "Oct 15, 2026",
};

describe("AboutHero", () => {
  it("says what Fee Insight is in one heading and shows the live counts", () => {
    render(<AboutHero proof={aboutProof(LIVE)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Fee Insight publishes the Bank Fee Index");
    const exhibit = screen.getByRole("figure", { name: "Live coverage" });
    expect(within(exhibit).getByText("8,000")).toBeInTheDocument();
    expect(within(exhibit).getByText("Institutions monitored").tagName).toBe("DT");
    expect(within(exhibit).getByText("2,000")).toBeInTheDocument();
    expect(within(exhibit).getByText("40,000")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "25% of institutions monitored have published fees" })).toBeInTheDocument();
    expect(screen.getByText("Data refreshed Oct 15, 2026")).toBeInTheDocument();
  });

  it("hides a failed count and never prints a dash or zero in its place", () => {
    render(<AboutHero proof={aboutProof({ ...LIVE, observations: 0, observationsLabel: UNAVAILABLE_LABEL, refreshedOn: null })} />);
    expect(screen.queryByText("Published fee entries")).not.toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText(/Data refresh/)).not.toBeInTheDocument();
  });

  it("drops the whole exhibit when no count could be read", () => {
    render(<AboutHero proof={{ figures: [], publishedShare: null, freshness: null }} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });
});

describe("AboutBlocks", () => {
  it("renders the three blocks with the methodology link", () => {
    render(<AboutBlocks blocks={ABOUT_BLOCKS} />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "The Bank Fee Index" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read the methodology" })).toHaveAttribute("href", "/methodology");
  });
});

describe("AboutNextAction", () => {
  it("offers the report request when the sample is not live, the demo second, and the consumer lookup", () => {
    const { container } = render(<AboutNextAction action={aboutNextAction(false)} />);
    expect(screen.getByRole("link", { name: "Request your institution report" })).toHaveAttribute(
      "href",
      "/reports?report=institution&src=about#request",
    );
    expect(screen.getByRole("link", { name: "Or ask for a demo" })).toHaveAttribute("href", "/contact?source=demo");
    expect(screen.getByRole("link", { name: "Look up your own bank" })).toHaveAttribute("href", "/institutions");
    expect(container.querySelector(".fi-on-navy")).not.toBeNull();
  });

  it("offers the sample report when it is live", () => {
    render(<AboutNextAction action={aboutNextAction(true)} />);
    expect(screen.getByRole("link", { name: "See the sample report" })).toHaveAttribute(
      "href",
      "/reports/sample-competitive-fee-position",
    );
  });
});

describe("AboutContact", () => {
  it("names who runs Fee Insight and has one email link", () => {
    const { container } = render(<AboutContact email={CONTACT_EMAIL} legalLine={LEGAL_ENTITY_LINE} />);
    expect(screen.getByRole("heading", { name: "Who's behind this" })).toBeInTheDocument();
    expect(screen.getByText("Fee Insight is built and run by James Gilmore, a banking data analyst.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Write to James" })).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
    expect(container.querySelectorAll('a[href^="mailto:"]')).toHaveLength(1);
    expect(container.textContent).toContain(CONTACT_EMAIL);
    expect(container.textContent).toContain(LEGAL_ENTITY_LINE);
    expect(container.textContent).not.toMatch(/\u2014|Velocity|CSI|Frost/);
  });
});
