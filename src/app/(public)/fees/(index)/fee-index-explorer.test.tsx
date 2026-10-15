import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeeIndexExplorer, type ExplorerFee } from "./fee-index-explorer";

const fees: ExplorerFee[] = [
  { key: "overdraft", label: "Overdraft", median: 30, p25: 25, p75: 33, institutions: 2496, zeroCount: 18, values: [25, 30, 30, 33, 35] },
  { key: "nsf", label: "NSF", median: 29, p25: 25, p75: 32, institutions: 2000, zeroCount: 0, values: [25, 29, 29, 32, 34] },
];

describe("fee index explorer", () => {
  it("opens on the first fee and switches when another is picked", () => {
    render(<FeeIndexExplorer fees={fees} />);
    expect(screen.getByRole("button", { name: "Overdraft" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Overdraft, U.S. median")).toBeTruthy();
    expect(screen.getByText(/2,496 institutions; 18 charge nothing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "NSF" }));
    expect(screen.getByText("NSF, U.S. median")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See every figure for this fee" }).getAttribute("href")).toBe("/fees/nsf");
    expect(screen.queryByText(/charge nothing/)).toBeNull();
  });

  it("draws nothing without a fee", () => {
    const { container } = render(<FeeIndexExplorer fees={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
