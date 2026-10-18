import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PositionSplit } from "./position-split";

afterEach(() => vi.unstubAllGlobals());

function stubBrowser({ reduced }: { reduced: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("PositionSplit", () => {
  it("draws the live counts, with the sentence for screen readers", () => {
    stubBrowser({ reduced: true });
    const { container } = render(<PositionSplit above={2} inside={6} below={1} summary="Two of nine compared fees sit above." />);
    const figures = [...container.querySelectorAll("[aria-hidden='true'] .font-mono")].map((n) => n.textContent);
    expect(figures).toEqual(["2", "6", "1"]);
    expect(screen.getByText("Two of nine compared fees sit above.")).toHaveClass("sr-only");
    expect(container.textContent).toContain("across 9 compared fees");
  });

  it("leaves an empty part out of the bar", () => {
    stubBrowser({ reduced: true });
    const { container } = render(<PositionSplit above={0} inside={3} below={1} summary="x" />);
    const bar = container.querySelector(".fi-grow-x");
    expect(bar?.children).toHaveLength(2);
  });
});
