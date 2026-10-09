// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CYCLE_MS, ShowcasePillars, ShowcaseProvider, ShowcaseStage } from "./showcase";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  }));
}

function renderShowcase(autoCycle = true) {
  render(
    <ShowcaseProvider autoCycle={autoCycle} entry="direct">
      <ShowcaseStage panels={["one", "two", "three", "four"].map((t) => <p key={t}>{t}</p>)} />
      <ShowcasePillars />
    </ShowcaseProvider>,
  );
}

const shown = () => document.querySelector('[id^="pro-example-"][aria-hidden="false"]')?.id;

beforeEach(() => {
  vi.useFakeTimers();
  stubReducedMotion(false);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("subscribe showcase", () => {
  it("steps through the four examples on its own", () => {
    renderShowcase();
    expect(shown()).toBe("pro-example-benchmark");
    act(() => vi.advanceTimersByTime(CYCLE_MS));
    expect(shown()).toBe("pro-example-analyze");
  });

  it("opens the example a reader picks and stops cycling", () => {
    renderShowcase();
    fireEvent.click(screen.getByText("Report").closest("button")!);
    expect(shown()).toBe("pro-example-report");
    act(() => vi.advanceTimersByTime(CYCLE_MS * 2));
    expect(shown()).toBe("pro-example-report");
  });

  it("holds still under reduced motion and once an institution is picked", () => {
    stubReducedMotion(true);
    renderShowcase();
    act(() => vi.advanceTimersByTime(CYCLE_MS * 2));
    expect(shown()).toBe("pro-example-benchmark");
    document.body.innerHTML = "";
    stubReducedMotion(false);
    renderShowcase(false);
    act(() => vi.advanceTimersByTime(CYCLE_MS * 2));
    expect(shown()).toBe("pro-example-benchmark");
  });
});
