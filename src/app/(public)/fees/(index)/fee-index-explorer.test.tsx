import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeeIndexExplorer, type ExplorerFee } from "./fee-index-explorer";

const fees: ExplorerFee[] = [
  { key: "overdraft", label: "Overdraft", median: 30, p25: 25, p75: 33, institutions: 2496, zeroCount: 18, chart: <p>overdraft chart</p> },
  { key: "nsf", label: "NSF", median: 29.5, p25: null, p75: null, institutions: 2000, zeroCount: 0, chart: <p>nsf chart</p>, unstated: true },
];

describe("fee index explorer", () => {
  it("opens on the first fee and switches when another is picked", () => {
    render(<FeeIndexExplorer fees={fees} />);
    expect(screen.getByRole("button", { name: "Overdraft" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Overdraft, U.S. median")).toBeTruthy();
    expect(screen.getByText("$30")).toBeTruthy();
    expect(screen.getByText(/middle half of institutions charge \$25 to \$33/)).toBeTruthy();
    expect(screen.getByText(/2,496 institutions; 18 charge nothing/)).toBeTruthy();
    expect(screen.getByText("overdraft chart")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "NSF" }));
    expect(screen.getByText("NSF, U.S. median")).toBeTruthy();
    expect(screen.getByText("nsf chart")).toBeTruthy();
    expect(screen.queryByText("overdraft chart")).toBeNull();
    expect(screen.getByRole("link", { name: "See every figure for this fee" }).getAttribute("href")).toBe("/fees/nsf");
    expect(screen.queryByText(/charge nothing/)).toBeNull();
  });

  it("drops the range line when a quartile is missing and marks an unstated-audience median", () => {
    const { container } = render(<FeeIndexExplorer fees={[fees[1]]} />);
    expect(screen.queryByText(/middle half/)).toBeNull();
    expect(container.textContent).toContain("$29.50");
    expect(container.textContent).toContain("*");
  });

  it("draws nothing without a fee", () => {
    const { container } = render(<FeeIndexExplorer fees={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
