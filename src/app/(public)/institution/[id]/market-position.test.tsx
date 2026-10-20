import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MarketPositionCard, SUBJECT } from "./market-position";
import type { MarketPosition, MetroPosition } from "@/lib/data-store/market-position";

function metro(overrides: Partial<MetroPosition>): MetroPosition {
  return {
    code: 45220,
    name: "Tallahassee, FL",
    isHome: true,
    year: 2026,
    totalDeposits: 8_000_000,
    institutions: 3,
    subject: { sharePct: 20.6, rank: 1, branches: 16, deposits: 1_720_000 },
    shares: [
      { name: "Subject Bank", sharePct: 20.6, rank: 1, branches: 16, subject: true },
      { name: "Bank of America, National Association", sharePct: 14.2, rank: 2, branches: 9, subject: false },
    ],
    history: [
      { year: 2024, sharePct: 18.1, branches: 15, rank: 2, institutions: 19 },
      { year: 2025, sharePct: 19.9, branches: 16, rank: 1, institutions: 18 },
      { year: 2026, sharePct: 20.6, branches: 16, rank: 1, institutions: 18 },
    ],
    creditUnions: { offices: 12, institutions: 4, reportDate: "2026-06-30" },
    institutionsOnMap: [
      { name: "Subject Bank", kind: "bank", band: 1 },
      { name: "Bank of America, National Association", kind: "bank", band: 3 },
      { name: "FSU Credit Union", kind: "credit_union", band: 0 },
    ],
    subjectIndex: 0,
    map: { width: 600, height: 420, counties: [{ d: "M0 0L10 0L10 10Z", inMetro: true }], points: [100, 100, 0, 120, 110, 1, 130, 140, 2] },
    mappableOffices: 3,
    unmappedOffices: 0,
    ...overrides,
  };
}

const POSITION: MarketPosition = {
  latestYear: 2026,
  firstYear: 2024,
  metros: [metro({}), metro({ code: 23540, name: "Gainesville, FL", isHome: false, history: [{ year: 2026, sharePct: 7.9, branches: 15, rank: 5, institutions: 20 }] })],
};

describe("MarketPositionCard", () => {
  it("shows the share with its reporting date and banks-only coverage, credit unions apart", () => {
    const { container } = render(<MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
    expect(container.textContent).toContain("holds 20.6% of bank deposits, #1 of 3, with 16 offices");
    expect(container.textContent).toContain("As of June 30, 2026. FDIC-insured offices only; credit unions are not included.");
    expect(container.textContent).toContain("12 offices of 4 credit unions in the metro's cities");
    expect(container.textContent).toContain("Source: FDIC Summary of Deposits, as of June 30, 2026.");
    expect(container.textContent).toContain("Source: FDIC Summary of Deposits, as of June 30 of each year, 2024 to 2026.");
    expect(container.textContent).toContain(
      "Source: FDIC Summary of Deposits, as of June 30, 2026 (bank offices); NCUA branch file, quarter ending June 30, 2026 (credit union offices).",
    );
    expect(container.textContent).toContain("Source: NCUA branch file, quarter ending June 30, 2026.");
    expect(container.textContent).not.toContain("Showing 3 of");
    expect(container.textContent).toContain("Position over time, 2024 to 2026");
    expect(screen.getByRole("link", { name: /Compare fees with banks in Tallahassee, FL that publish fees/ })).toHaveAttribute("href", "/institution/323?peers=metro#peers");
    expect(container.textContent).not.toMatch(/Frost/);
  });

  it("hides credit union offices with the charter toggle but keeps the subject", () => {
    const { container } = render(<MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
    expect(container.textContent).toContain("3 offices of 3 institutions shown.");
    fireEvent.click(screen.getByRole("button", { name: "Credit unions" }));
    expect(container.textContent).toContain("2 offices of 2 institutions shown.");
  });

  it("draws the subject in ink, never the variance red or blue", () => {
    expect(SUBJECT).toContain("--color-ink");
    const { container } = render(<MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
    expect(container.innerHTML).not.toMatch(/fi-subject|2a6fc4|variance-(above|below)/);
  });

  it("says how many offices a capped map shows", () => {
    const capped: MarketPosition = { ...POSITION, metros: [metro({ mappableOffices: 2345 })] };
    const { container } = render(<MarketPositionCard institutionId={323} position={capped} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
    expect(container.textContent).toContain("Showing 3 of 2,345 offices");
  });

  it("says when one survey year is all there is, and points a non-home metro at the home metro's peers", () => {
    const onSelect = vi.fn();
    const { container } = render(<MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={23540} onSelect={onSelect} />);
    expect(container.textContent).toContain("Only the 2026 survey has Subject Bank in this metro");
    expect(screen.getByRole("link", { name: /Compare fees with banks in Tallahassee, FL that publish fees/ })).toBeInTheDocument();
    // The explorer compares the home metro only, so a non-home chip says so.
    expect(container.textContent).toContain("The fee comparison uses its home metro, Tallahassee, FL.");
    fireEvent.click(screen.getByRole("button", { name: "Tallahassee, FL" }));
    expect(onSelect).toHaveBeenCalledWith(45220);
  });

  it("keeps the fee the reader came to compare on the metro peers link", () => {
    window.history.replaceState(null, "", "/institution/323?fee=nsf");
    try {
      render(<MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
      expect(screen.getByRole("link", { name: /Compare fees with banks in Tallahassee, FL that publish fees/ })).toHaveAttribute(
        "href",
        "/institution/323?fee=nsf&peers=metro#peers",
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("should_name_the_explorer_count_of_publishing_banks_on_the_link", () => {
    const { container } = render(
      <MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} metroPeerCount={9} />,
    );
    const link = screen.getByRole("link", { name: /Compare fees with the 9 banks in Tallahassee, FL that publish fees/ });
    expect(link).toBeInTheDocument();
    expect(container.textContent).not.toContain("The fee comparison uses its home metro");
  });

  it("should_keep_the_arrow_with_the_last_word", () => {
    render(<MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} metroPeerCount={9} />);
    const link = screen.getByRole("link", { name: /Compare fees/ });
    const tail = link.querySelector(".whitespace-nowrap");
    expect(tail?.textContent).toBe("fees\u00a0\u2192");
  });

  it("should_hide_the_link_when_the_metro_set_is_not_offered", () => {
    render(<MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} metroPeerCount={null} />);
    expect(screen.queryByRole("link", { name: /Compare fees/ })).toBeNull();
  });

  it("should_show_filter_chips_that_start_on_as_selected", () => {
    render(<MarketPositionCard institutionId={323} position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
    const chip = screen.getByRole("button", { name: "Credit unions" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.className).toContain("bg-ink");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.className).not.toContain("bg-ink");
  });
});
