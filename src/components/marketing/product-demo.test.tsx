// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductDemo } from "./product-demo";
import { FrameMedia } from "./frame-media";

const VIEWS = ["one", "two", "three", "four"].map((key) => ({
  key,
  label: key.toUpperCase(),
  view: <p>{key} view</p>,
}));

const shown = () => document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')?.dataset.view;
const tab = (name: string) => screen.getByRole("tab", { name });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("product demo", () => {
  it("opens on the first view and never advances on its own", () => {
    render(<ProductDemo views={VIEWS} />);
    expect(shown()).toBe("one");
    act(() => vi.advanceTimersByTime(60_000));
    expect(shown()).toBe("one");
    // No time bar, no progress segments, no play or pause control.
    expect(document.querySelector("[data-segment]")).toBeNull();
    expect(screen.queryByRole("group", { name: "Demo progress" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause|Play|Replay/ })).toBeNull();
  });

  it("opens a view from its tab, as a tab list with one panel showing", () => {
    render(<ProductDemo views={VIEWS} />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    fireEvent.click(tab("THREE"));
    expect(shown()).toBe("three");
    expect(tab("THREE").getAttribute("aria-selected")).toBe("true");
    expect(tab("ONE").getAttribute("aria-selected")).toBe("false");
    const panel = document.getElementById(tab("THREE").getAttribute("aria-controls") ?? "");
    expect(panel?.hidden).toBe(false);
    expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
  });

  it("moves between tabs with the arrow, Home and End keys", () => {
    render(<ProductDemo views={VIEWS} />);
    fireEvent.keyDown(tab("ONE"), { key: "ArrowRight" });
    expect(shown()).toBe("two");
    expect(document.activeElement).toBe(tab("TWO"));
    fireEvent.keyDown(tab("TWO"), { key: "End" });
    expect(shown()).toBe("four");
    fireEvent.keyDown(tab("FOUR"), { key: "ArrowRight" });
    expect(shown()).toBe("one");
    fireEvent.keyDown(tab("ONE"), { key: "ArrowLeft" });
    expect(shown()).toBe("four");
    fireEvent.keyDown(tab("FOUR"), { key: "Home" });
    expect(shown()).toBe("one");
    // Only the open tab is in the tab order.
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("shows a short tab name on a phone when a view has one", () => {
    render(<ProductDemo views={[{ key: "map", label: "District map", short: "Map", view: <p>map</p> }]} />);
    expect(tab("District map").querySelector(".sm\\:hidden")?.textContent).toBe("Map");
  });

  it("renders nothing without views", () => {
    const { container } = render(<ProductDemo views={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("frame media", () => {
  it("offers a recorded clip in a still frame only when one exists", () => {
    const { rerender } = render(<FrameMedia video={null}><p>live</p></FrameMedia>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<FrameMedia video={{ src: "/tour.mp4", label: "Watch the tour" }}><p>live</p></FrameMedia>);
    fireEvent.click(screen.getByRole("button", { name: "Watch the tour" }));
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/tour.mp4");
  });
});
