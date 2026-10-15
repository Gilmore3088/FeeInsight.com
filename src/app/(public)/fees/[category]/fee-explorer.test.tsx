import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MarketDot, NationalBand } from "./category-view";
import { ExplorerChart, ExplorerMarkets, FeeExplorer, type ExplorerPoint } from "./fee-explorer";

const band: NationalBand = { min: 0, p25: 25, median: 30, p75: 33, max: 50, institutions: 10 };

// Six institutions in Philadelphia charge $32-$35; four in San Francisco charge $20-$25.
const points: ExplorerPoint[] = [
  ...[32, 32, 33, 34, 35, 35].map((v) => ({ v, d: 3, c: "b" as const })),
  ...[20, 22, 25, 25].map((v) => ({ v, d: 12, c: "c" as const })),
];

const dots: MarketDot[] = [
  { key: "District 3", label: "Philadelphia", median: 33.5, institutions: 6, position: "above" },
  { key: "District 12", label: "San Francisco", median: 23.5, institutions: 4, position: "below" },
];

function renderExplorer() {
  render(
    <FeeExplorer points={points}>
      <ExplorerChart median={30} />
      <ExplorerMarkets dots={dots} band={band} dim="district" ariaLabel="By district" />
    </FeeExplorer>,
  );
}

describe("fee explorer", () => {
  it("counts the institutions in a tapped price range and shows each market's share of it", () => {
    renderExplorer();
    expect(screen.getByText("10 institutions")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^\$25 to \$29\.99: 2 institutions/ }));
    expect(screen.getByText("2 institutions")).toBeTruthy();
    expect(screen.getByText("charge $25 to $29.99, 20% of all")).toBeTruthy();
    // Both $25 fees are in San Francisco: half its institutions, none of Philadelphia's.
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("redraws for a tapped market and clears back to every institution", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /Philadelphia/ }));
    expect(screen.getByText("Philadelphia: the median of 6 institutions, drawn over the U.S.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Philadelphia/ }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("10 institutions")).toBeTruthy();
  });
});
