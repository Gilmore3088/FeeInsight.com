import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MarketPositionCard } from "./market-position";
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
    const { container } = render(<MarketPositionCard position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
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
    expect(screen.getByRole("link", { name: /Compare fees with these local competitors/ })).toHaveAttribute("href", "?peers=metro#peers");
    expect(container.textContent).not.toMatch(/Frost/);
  });

  it("hides credit union offices with the charter toggle but keeps the subject", () => {
    const { container } = render(<MarketPositionCard position={POSITION} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
    expect(container.textContent).toContain("3 offices of 3 institutions shown.");
    fireEvent.click(screen.getByRole("button", { name: "Credit unions" }));
    expect(container.textContent).toContain("2 offices of 2 institutions shown.");
  });

  it("says how many offices a capped map shows", () => {
    const capped: MarketPosition = { ...POSITION, metros: [metro({ mappableOffices: 2345 })] };
    const { container } = render(<MarketPositionCard position={capped} institutionName="Subject Bank" selectedCode={45220} onSelect={() => {}} />);
    expect(container.textContent).toContain("Showing 3 of 2,345 offices");
  });

  it("says when one survey year is all there is, and points a non-home metro at the home metro's peers", () => {
    const onSelect = vi.fn();
    const { container } = render(<MarketPositionCard position={POSITION} institutionName="Subject Bank" selectedCode={23540} onSelect={onSelect} />);
    expect(container.textContent).toContain("Only the 2026 survey has Subject Bank in this metro");
    expect(screen.getByRole("link", { name: /Compare fees with competitors in Tallahassee, FL/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tallahassee, FL" }));
    expect(onSelect).toHaveBeenCalledWith(45220);
  });
});
