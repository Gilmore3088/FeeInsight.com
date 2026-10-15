// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAPTER_MS, MAX_LOOPS, ProductSizzle } from "./product-sizzle";
import { FrameMedia, FramePlaceholder } from "./frame-media";

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  }));
}

const CHAPTERS = ["one", "two", "three", "four"].map((key) => ({ key, label: key.toUpperCase(), scene: <p>{key} scene</p> }));

function renderSizzle() {
  render(<ProductSizzle label="Hamilton" chapters={CHAPTERS} />);
}

const shown = () => document.querySelector('[id^="sizzle-"][aria-hidden="false"]')?.id;
const frame = () => document.querySelector(".fi-sizzle") as HTMLElement;
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  stubReducedMotion(false);
  // jsdom has no IntersectionObserver, so the frame counts as in view and playback starts.
  vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("product sizzle", () => {
  it("plays from the first chapter, advances, and rests on the end frame after its loops", () => {
    renderSizzle();
    expect(shown()).toBe("sizzle-one");
    expect(frame().dataset.motion).toBe("on");
    tick(CHAPTER_MS);
    expect(shown()).toBe("sizzle-two");
    for (let i = 1; i < CHAPTERS.length * MAX_LOOPS; i += 1) tick(CHAPTER_MS);
    expect(shown()).toBe("sizzle-four");
    expect(frame().dataset.mode).toBe("rest");
    for (let i = 0; i < 3; i += 1) tick(CHAPTER_MS);
    expect(shown()).toBe("sizzle-four");
    expect(screen.getByRole("button", { name: "Replay the product tour" })).toBeTruthy();
  });

  it("shows the composed end frame and moves nothing under reduced motion", () => {
    stubReducedMotion(true);
    renderSizzle();
    expect(shown()).toBe("sizzle-four");
    expect(frame().dataset.motion).toBe("off");
    tick(CHAPTER_MS * 5);
    expect(shown()).toBe("sizzle-four");
    expect(screen.queryByRole("button", { name: /Pause|Play|Replay/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "TWO" }));
    expect(shown()).toBe("sizzle-two");
    expect(frame().dataset.motion).toBe("off");
  });

  it("stops advancing when reduced motion is turned on mid-run", () => {
    let reduced = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return reduced && query.includes("reduce");
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    renderSizzle();
    tick(CHAPTER_MS);
    expect(shown()).toBe("sizzle-two");
    reduced = true;
    act(() => listeners.forEach((fn) => fn()));
    expect(frame().dataset.motion).toBe("off");
    tick(CHAPTER_MS * 5);
    expect(shown()).toBe("sizzle-two");
  });

  it("jumps to a chapter tab and stops the run", () => {
    renderSizzle();
    fireEvent.click(screen.getByRole("button", { name: "THREE" }));
    expect(shown()).toBe("sizzle-three");
    tick(CHAPTER_MS * 3);
    expect(shown()).toBe("sizzle-three");
    expect(frame().dataset.mode).toBe("chosen");
  });

  it("pauses and carries on from where it stopped", () => {
    renderSizzle();
    tick(CHAPTER_MS / 2);
    fireEvent.click(screen.getByRole("button", { name: "Pause the product tour" }));
    expect(frame().dataset.paused).toBe("true");
    tick(CHAPTER_MS * 3);
    expect(shown()).toBe("sizzle-one");
    fireEvent.click(screen.getByRole("button", { name: "Play the product tour" }));
    tick(CHAPTER_MS / 2 - 1);
    expect(shown()).toBe("sizzle-one");
    tick(2);
    expect(shown()).toBe("sizzle-two");
  });

  it("offers a recorded tour only when one exists", () => {
    const { rerender } = render(<FrameMedia video={null}><p>live</p></FrameMedia>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<FrameMedia video={{ src: "/tour.mp4", label: "Watch the tour" }}><p>live</p></FrameMedia>);
    fireEvent.click(screen.getByRole("button", { name: "Watch the tour" }));
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/tour.mp4");
  });

  it("shows a still tour placeholder that is not a control", () => {
    render(<FramePlaceholder caption="Product tour · coming soon" />);
    expect(screen.getByText("Product tour · coming soon")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    const block = document.querySelector("[data-video-placeholder]");
    expect(block?.className).toContain("aspect-video");
    expect(block?.className).toContain("w-full");
    expect(block?.getAttribute("role")).toBeNull();
  });

  it("lays the chapter tabs out as one row of equal pills", () => {
    renderSizzle();
    const row = screen.getByRole("group", { name: "Chapters" });
    expect(row.className).toContain("flex");
    expect(row.className).not.toContain("grid");
    const pills = screen.getAllByRole("button", { name: /^(ONE|TWO|THREE|FOUR)$/ });
    expect(pills).toHaveLength(4);
    for (const pill of pills) expect(pill.className).toContain("w-[8.25rem]");
    expect(pills.filter((p) => p.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("puts the placeholder in its own band under the chapter tabs until a clip exists, then only the real button", () => {
    const { rerender } = render(<ProductSizzle label="Hamilton" chapters={CHAPTERS} placeholder="Product tour · coming soon" />);
    expect(document.querySelectorAll("[data-video-placeholder]").length).toBe(1);
    const row = screen.getByRole("group", { name: "Chapters" });
    expect(row.nextElementSibling?.hasAttribute("data-video-placeholder")).toBe(true);
    expect(row.contains(document.querySelector("[data-video-placeholder]"))).toBe(false);
    expect(screen.queryByRole("button", { name: /coming soon/ })).toBeNull();
    rerender(
      <ProductSizzle
        label="Hamilton"
        chapters={CHAPTERS}
        placeholder="Product tour · coming soon"
        video={{ src: "/tour.mp4", label: "Watch the tour" }}
      />,
    );
    expect(document.querySelector("[data-video-placeholder]")).toBeNull();
    expect(screen.getByRole("button", { name: "Watch the tour" })).toBeTruthy();
  });
});
