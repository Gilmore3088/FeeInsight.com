import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONTACT_EMAIL, LEGAL_ENTITY_LINE } from "@/lib/constants";
import { UNAVAILABLE_LABEL } from "@/lib/public-stats";

vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif-var" } }));

import {
  AboutCoverage,
  AboutEvidence,
  AboutFounder,
  AboutHero,
  AboutLegal,
  AboutNextAction,
  AboutProducts,
} from "./about-sections";
import { aboutNextAction, aboutProof } from "./about-view";

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
  it("leads with the purpose in the shared curved hero", () => {
    const { container } = render(<AboutHero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Better banking decisions start with a clearer picture.",
    );
    expect(container.querySelector(".fi-page-hero")).not.toBeNull();
    expect(container.textContent).not.toMatch(/—/);
  });
});

describe("AboutProducts", () => {
  it("shows the Bank Fee Index and Hamilton side by side, then the neutrality line", () => {
    render(<AboutProducts />);
    expect(screen.getByRole("heading", { level: 3, name: "The Bank Fee Index" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Hamilton" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore the index" })).toHaveAttribute("href", "/fees");
    expect(screen.getByRole("link", { name: "See Hamilton plans" })).toHaveAttribute("href", "/subscribe");
    expect(screen.getByText("The Bank Fee Index reports published fees without recommending a price.")).toBeInTheDocument();
  });
});

describe("AboutEvidence", () => {
  it("lists three steps and links the methodology", () => {
    render(<AboutEvidence />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Read the methodology" })).toHaveAttribute("href", "/methodology");
  });
});

describe("AboutCoverage", () => {
  it("shows the live counts, the share and what each term means", () => {
    render(<AboutCoverage proof={aboutProof(LIVE)} />);
    const exhibit = screen.getByRole("figure", { name: "Live coverage" });
    expect(within(exhibit).getByText("8,000")).toBeInTheDocument();
    expect(within(exhibit).getByText("Institutions monitored").tagName).toBe("DT");
    expect(within(exhibit).getByText("2,000")).toBeInTheDocument();
    expect(within(exhibit).getByText("40,000")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "25% of monitored institutions have fees in the index" })).toBeInTheDocument();
    expect(screen.getByText("Data refreshed Oct 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("Monitored")).toBeInTheDocument();
    expect(screen.getByText(/not the date every schedule was last checked/)).toBeInTheDocument();
  });

  it("hides a failed count and never prints a dash or zero in its place", () => {
    render(
      <AboutCoverage
        proof={aboutProof({ ...LIVE, observations: 0, observationsLabel: UNAVAILABLE_LABEL, refreshedOn: null })}
      />,
    );
    expect(screen.queryByText("Published fee entries")).not.toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText(/Data refreshed Oct/)).not.toBeInTheDocument();
  });

  it("drops the whole section when no count could be read", () => {
    const { container } = render(<AboutCoverage proof={{ figures: [], publishedShare: null, freshness: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AboutNextAction", () => {
  it("offers the report request when the sample is not live, the demo second, and the consumer lookup", () => {
    const { container } = render(<AboutNextAction action={aboutNextAction(false)} />);
    expect(screen.getByRole("link", { name: "Request your institution report" })).toHaveAttribute(
      "href",
      "/reports?report=institution&src=about#request",
    );
    expect(screen.getByRole("link", { name: "Or ask for a demo" })).toHaveAttribute("href", "/for-institutions#demo");
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

describe("AboutFounder and AboutLegal", () => {
  it("names who runs Fee Insight, has one email link and no employer", () => {
    const { container } = render(
      <>
        <AboutFounder email={CONTACT_EMAIL} />
        <AboutLegal legalLine={LEGAL_ENTITY_LINE} />
      </>,
    );
    expect(screen.getByRole("heading", { name: "Who's behind this" })).toBeInTheDocument();
    expect(screen.getByText("Fee Insight is built and run by James Gilmore, a banking data analyst.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Write to James" })).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
    expect(container.querySelectorAll('a[href^="mailto:"]')).toHaveLength(1);
    expect(container.textContent).toContain(CONTACT_EMAIL);
    expect(container.textContent).toContain(LEGAL_ENTITY_LINE);
    expect(container.textContent).not.toMatch(/—|Velocity|CSI|Frost/);
  });
});
