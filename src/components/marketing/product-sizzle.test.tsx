// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAPTER_MS, MAX_LOOPS, ProductSizzle } from "./product-sizzle";
import { FrameMedia } from "./frame-media";

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  }));
}

const CHAPTERS = ["one", "two", "three", "four"].map((key) => ({
  key,
  label: key.toUpperCase(),
  caption: `Caption ${key}`,
  scene: <p>{key} scene</p>,
}));

function renderSizzle(props: Partial<Parameters<typeof ProductSizzle>[0]> = {}) {
  return render(<ProductSizzle label="Hamilton" chapters={CHAPTERS} {...props} />);
}

const shown = () => document.querySelector('[id^="sizzle-"][aria-hidden="false"]')?.id;
const frame = () => document.querySelector(".fi-sizzle") as HTMLElement;
const caption = () => document.querySelector("[data-caption]")?.textContent;
const segments = () => [...document.querySelectorAll<HTMLElement>("[data-segment]")];
const states = () => segments().map((s) => s.dataset.segment);
const segment = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}, part`) });
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const stage = () => document.querySelector("[data-stage]") as HTMLElement;

// jsdom has no PointerEvent; this one carries pointerType, as a browser's does.
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "mouse";
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  stubReducedMotion(false);
  // jsdom has no IntersectionObserver, so the frame counts as in view and playback starts.
  vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("product demo", () => {
  it("plays from the first chapter, advances, and rests on the last after its loops", () => {
    renderSizzle();
    expect(shown()).toBe("sizzle-one");
    expect(frame().dataset.motion).toBe("on");
    tick(CHAPTER_MS);
    expect(shown()).toBe("sizzle-two");
    for (let i = 1; i < CHAPTERS.length * MAX_LOOPS; i += 1) tick(CHAPTER_MS);
    expect(shown()).toBe("sizzle-four");
    expect(frame().dataset.mode).toBe("rest");
    expect(states()).toEqual(["done", "done", "done", "current"]);
    for (let i = 0; i < 3; i += 1) tick(CHAPTER_MS);
    expect(shown()).toBe("sizzle-four");
    fireEvent.click(screen.getByRole("button", { name: "Replay the product demo" }));
    expect(shown()).toBe("sizzle-one");
    expect(frame().dataset.mode).toBe("playing");
  });

  it("draws one progress segment per chapter, labelled, filling as the run moves on", () => {
    renderSizzle();
    const group = screen.getByRole("group", { name: "Demo progress" });
    expect(segments()).toHaveLength(4);
    expect(segment("TWO").getAttribute("aria-label")).toBe("TWO, part 2 of 4");
    // A segment is a bar, not a labelled pill: it has no visible text.
    for (const s of segments()) expect(s.textContent).toBe("");
    expect(states()).toEqual(["current", "todo", "todo", "todo"]);
    expect(segment("ONE").getAttribute("aria-current")).toBe("step");
    expect(group.querySelector('[style*="fi-progress-fill"]')).toBeTruthy();
    tick(CHAPTER_MS);
    tick(CHAPTER_MS);
    expect(states()).toEqual(["done", "done", "current", "todo"]);
    expect(segment("THREE").getAttribute("aria-current")).toBe("step");
  });

  it("names what is happening in the title bar, chapter by chapter", () => {
    renderSizzle();
    expect(caption()).toBe("Caption one");
    tick(CHAPTER_MS);
    expect(caption()).toBe("Caption two");
    expect(document.querySelector(".fi-window")?.textContent).toContain("Hamilton · ");
  });

  it("jumps to a chapter from its segment and plays on from there", () => {
    renderSizzle();
    fireEvent.click(segment("THREE"));
    expect(shown()).toBe("sizzle-three");
    expect(caption()).toBe("Caption three");
    expect(frame().dataset.mode).toBe("playing");
    tick(CHAPTER_MS);
    expect(shown()).toBe("sizzle-four");
  });

  it("gives a chapter chosen mid-chapter its full run", () => {
    renderSizzle();
    tick(5000);
    fireEvent.click(segment("THREE"));
    tick(1500);
    expect(shown()).toBe("sizzle-three");
    tick(CHAPTER_MS - 1500 - 1);
    expect(shown()).toBe("sizzle-three");
    tick(2);
    expect(shown()).toBe("sizzle-four");
  });

  it("gives a replayed run its full first chapter", () => {
    renderSizzle();
    for (let i = 0; i < CHAPTERS.length * MAX_LOOPS; i += 1) tick(CHAPTER_MS);
    expect(frame().dataset.mode).toBe("rest");
    fireEvent.click(screen.getByRole("button", { name: "Replay the product demo" }));
    tick(CHAPTER_MS - 1);
    expect(shown()).toBe("sizzle-one");
    tick(2);
    expect(shown()).toBe("sizzle-two");
  });

  it("pauses and carries on from where it stopped", () => {
    renderSizzle();
    tick(CHAPTER_MS / 2);
    fireEvent.click(screen.getByRole("button", { name: "Pause the product demo" }));
    expect(frame().dataset.paused).toBe("true");
    tick(CHAPTER_MS * 3);
    expect(shown()).toBe("sizzle-one");
    fireEvent.click(screen.getByRole("button", { name: "Play the product demo" }));
    tick(CHAPTER_MS / 2 - 1);
    expect(shown()).toBe("sizzle-one");
    tick(2);
    expect(shown()).toBe("sizzle-two");
  });

  it("holds while a mouse is over the scene, and a tap pauses and plays", () => {
    renderSizzle();
    tick(CHAPTER_MS / 2);
    fireEvent.pointerEnter(stage(), { pointerType: "mouse" });
    expect(frame().dataset.held).toBe("true");
    expect(frame().dataset.paused).toBe("true");
    tick(CHAPTER_MS * 2);
    expect(shown()).toBe("sizzle-one");
    fireEvent.pointerLeave(stage(), { pointerType: "mouse" });
    tick(CHAPTER_MS / 2 + 1);
    expect(shown()).toBe("sizzle-two");

    fireEvent.pointerUp(stage(), { pointerType: "touch" });
    expect(frame().dataset.mode).toBe("paused");
    tick(CHAPTER_MS * 2);
    expect(shown()).toBe("sizzle-two");
    fireEvent.pointerUp(stage(), { pointerType: "touch" });
    expect(frame().dataset.mode).toBe("playing");
  });

  it("holds while the keyboard is on the segments", () => {
    renderSizzle();
    act(() => segment("TWO").focus());
    expect(frame().dataset.held).toBe("true");
    tick(CHAPTER_MS * 2);
    expect(shown()).toBe("sizzle-one");
    act(() => segment("TWO").blur());
    expect(frame().dataset.held).toBe("false");
    // A click focuses the segment too, but jumps and plays on rather than holding.
    fireEvent.click(segment("THREE"));
    expect(shown()).toBe("sizzle-three");
  });

  it("shows each chapter's end state and moves nothing under reduced motion", () => {
    stubReducedMotion(true);
    renderSizzle();
    expect(shown()).toBe("sizzle-one");
    expect(frame().dataset.motion).toBe("off");
    tick(CHAPTER_MS * 5);
    expect(shown()).toBe("sizzle-one");
    expect(screen.queryByRole("button", { name: /Pause|Play|Replay/ })).toBeNull();
    expect(document.querySelector('[style*="fi-progress-fill"]')).toBeNull();
    fireEvent.click(segment("THREE"));
    expect(shown()).toBe("sizzle-three");
    expect(caption()).toBe("Caption three");
    expect(frame().dataset.motion).toBe("off");
    tick(CHAPTER_MS * 5);
    expect(shown()).toBe("sizzle-three");
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

  it("has no tab row and no separate tour block under the frame", () => {
    renderSizzle();
    expect(screen.queryByRole("group", { name: "Chapters" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(document.querySelector("[aria-pressed]")).toBeNull();
    expect(document.querySelector("[data-video-placeholder]")).toBeNull();
    expect(screen.queryByText(/coming soon/)).toBeNull();
    // Everything sits inside the one frame.
    expect(frame().children).toHaveLength(1);
    expect(frame().querySelector(".fi-window [data-segments]")).toBeTruthy();
  });

  it("plays a recorded tour in the same frame, with the same segments and caption", () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    renderSizzle({ video: { src: "/tour.mp4", label: "Watch the tour", chapters: [0, 5, 10, 15] } });
    const clip = document.querySelector("video") as HTMLVideoElement;
    expect(clip.getAttribute("src")).toBe("/tour.mp4");
    expect(clip.muted).toBe(true);
    expect(clip.closest("[data-stage]")).toBeTruthy();
    // The first chapter sits under the clip as its poster; the coded motion stays off.
    expect(shown()).toBe("sizzle-one");
    expect(frame().dataset.motion).toBe("off");
    expect(play).toHaveBeenCalled();
    Object.defineProperty(clip, "duration", { value: 20, configurable: true });
    clip.currentTime = 11;
    fireEvent.timeUpdate(clip);
    expect(shown()).toBe("sizzle-three");
    expect(caption()).toBe("Caption three");
    fireEvent.click(segment("TWO"));
    expect(clip.currentTime).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "Pause the product demo" }));
    expect(pause).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Watch the tour" })).toBeNull();
  });

  it("offers a recorded clip in a still frame only when one exists", () => {
    const { rerender } = render(<FrameMedia video={null}><p>live</p></FrameMedia>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<FrameMedia video={{ src: "/tour.mp4", label: "Watch the tour" }}><p>live</p></FrameMedia>);
    fireEvent.click(screen.getByRole("button", { name: "Watch the tour" }));
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/tour.mp4");
  });
});
