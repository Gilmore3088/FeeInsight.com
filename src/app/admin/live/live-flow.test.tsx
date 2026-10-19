import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

import { countsAge, LiveFlow, POLL_MS, POLL_TIMEOUT_MS } from "./live-flow";

const waiting = { magellan: 1, rosetta: 2, knox: 3, darwin: 4, gutenberg: 5, published: 4200, total: 8000, computedAt: "2026-10-19T02:00:00.000Z" };
const initial = { moves: [], now: [], generatedAt: "2026-10-19T02:03:00.000Z", waiting };

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("Live page polling (#2016)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...initial, generatedAt: "2026-10-19T02:04:00.000Z", waiting: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls every 30 s, not every 10 s", async () => {
    render(<LiveFlow initial={initial} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS - 1); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(POLL_MS).toBe(30_000);
  });

  it("never starts a poll while one is in flight, and gives up on one after 15 s", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    render(<LiveFlow initial={initial} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS - 1); });
    expect(signals[0].aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(signals[0].aborted).toBe(true);
    // The next poll waits a full interval after the abandoned one ended.
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS - 1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/last update failed/)).toBeTruthy();
  });

  it("does not poll a hidden tab, and polls at once when it is shown again", async () => {
    render(<LiveFlow initial={initial} />);
    act(() => setVisibility("hidden"));
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 4); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { setVisibility("visible"); await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the last queue counts, with their age, when a poll's counts were not ready", async () => {
    render(<LiveFlow initial={initial} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/queue counts from .*\(4 min old\)/)).toBeTruthy();
  });

  it("says how old the counts are in plain words", () => {
    expect(countsAge("2026-10-19T02:00:00.000Z", "2026-10-19T02:00:20.000Z")).toBe("under a minute old");
    expect(countsAge("2026-10-19T02:00:00.000Z", "2026-10-19T02:12:00.000Z")).toBe("12 min old");
    expect(countsAge("not a date", "2026-10-19T02:12:00.000Z")).toBe("age unknown");
  });
});
