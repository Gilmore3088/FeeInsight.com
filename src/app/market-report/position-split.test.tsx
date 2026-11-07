import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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

  it("should_paint_the_final_counts_first_when_rendered_on_the_server", () => {
    const html = renderToStaticMarkup(<PositionSplit above={3} inside={7} below={1} summary="x" />);
    const figures = [...html.matchAll(/font-mono[^>]*>(\d+)</g)].map((m) => m[1]);
    expect(figures).toEqual(["3", "7", "1"]);
  });

  it("leaves an empty part out of the bar", () => {
    stubBrowser({ reduced: true });
    const { container } = render(<PositionSplit above={0} inside={3} below={1} summary="x" />);
    const bar = container.querySelector(".fi-grow-x");
    expect(bar?.children).toHaveLength(2);
  });

  it("colors above red and below blue, each beside its arrow and word (site variance rule)", () => {
    stubBrowser({ reduced: true });
    const { container } = render(<PositionSplit above={2} inside={6} below={1} summary="x" />);
    const [above, , below] = [...container.querySelectorAll("[aria-hidden='true'] .font-mono")];
    expect(above).toHaveClass("text-variance-above");
    expect(below).toHaveClass("text-variance-below");
    expect(container.innerHTML).not.toMatch(/below-market|text-brick/);
    expect(container.textContent).toContain("above");
    expect(container.textContent).toContain("below");
  });
});
