import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeeAnimation } from "./fee-animation";
import { ATM_FEES_SCENE } from "./scenes/atm-fees";
import { sceneLengthMs, stepStarts } from "./timeline";

const ACTIONS = [
  { label: "Check your bank's fee", href: "/check" },
  { label: "Find an in-network ATM", href: "#find-cash" },
];

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const caption = () => screen.getByTestId("fee-animation-caption").textContent;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("FeeAnimation: ATM pilot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("follows James's sequence word for word and second for second", () => {
    expect(ATM_FEES_SCENE.title).toBe("One withdrawal. Two possible fees.");
    expect(ATM_FEES_SCENE.steps.map((s) => s.caption)).toEqual([
      "One withdrawal...",
      "The ATM operator may charge you.",
      "Your bank may charge you, too.",
      "Check both before you withdraw.",
    ]);
    expect(stepStarts(ATM_FEES_SCENE)).toEqual([0, 5000, 12000, 19000]);
    expect(sceneLengthMs(ATM_FEES_SCENE)).toBe(25000);
    expect(ATM_FEES_SCENE.charges.map((c) => c.amount)).toEqual([3, 3]);
  });

  it("opens on the still end-state poster with a 25-second play button", () => {
    render(<FeeAnimation scene={ATM_FEES_SCENE} actions={ACTIONS} />);
    expect(screen.getByRole("button", { name: "Watch: 25 seconds" })).toBeInTheDocument();
    expect(caption()).toBe(ATM_FEES_SCENE.takeaway);
    expect(screen.getByText("Illustrative amounts")).toBeInTheDocument();
    // The poster is the finished diagram: both charges and the total are drawn.
    expect(screen.getAllByText("+$3")).toHaveLength(2);
    expect(screen.getByText("$6")).toBeInTheDocument();
    expect(screen.queryByTestId("fee-animation-end")).toBeNull();
    // Nothing plays until the reader asks.
    advance(30000);
    expect(caption()).toBe(ATM_FEES_SCENE.takeaway);
  });

  it("keeps captions in a live region, in a box sized by every caption", () => {
    render(<FeeAnimation scene={ATM_FEES_SCENE} actions={ACTIONS} />);
    const region = screen.getByTestId("fee-animation-caption");
    expect(region).toHaveAttribute("aria-live", "polite");
    const sizers = Array.from(region.parentElement!.querySelectorAll('p[aria-hidden="true"]')).map((p) => p.textContent);
    expect(sizers).toEqual([ATM_FEES_SCENE.takeaway, ...ATM_FEES_SCENE.steps.map((s) => s.caption)]);
  });

  it("ties the poster's play button to the scene title", () => {
    render(<FeeAnimation scene={ATM_FEES_SCENE} actions={ACTIONS} />);
    const button = screen.getByRole("button", { name: "Watch: 25 seconds" });
    expect(button).toHaveAccessibleDescription("One withdrawal. Two possible fees.");
  });

  it("moves focus from Replay to the remaining button when the scene ends", () => {
    render(<FeeAnimation scene={ATM_FEES_SCENE} actions={ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch: 25 seconds" }));
    screen.getByRole("button", { name: "Replay" }).focus();
    advance(25000);
    const replay = screen.getByRole("button", { name: "Replay" });
    expect(document.activeElement).toBe(replay);
  });

  it("advances the steps over time and ends on the two actions", () => {
    render(<FeeAnimation scene={ATM_FEES_SCENE} actions={ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch: 25 seconds" }));
    expect(caption()).toBe("One withdrawal...");
    expect(screen.queryByText("+$3")).toBeNull();

    advance(4900);
    expect(caption()).toBe("One withdrawal...");
    advance(100);
    expect(caption()).toBe("The ATM operator may charge you.");
    // The charge counts up to its amount.
    advance(2000);
    expect(screen.getByText("+$3")).toBeInTheDocument();

    advance(5000);
    expect(caption()).toBe("Your bank may charge you, too.");
    advance(7000);
    expect(caption()).toBe("Check both before you withdraw.");
    expect(screen.queryByTestId("fee-animation-end")).toBeNull();
    advance(3000);
    expect(screen.getByText("$6")).toBeInTheDocument();

    advance(3000);
    const end = screen.getByTestId("fee-animation-end");
    expect(within(end).getByRole("link", { name: "Check your bank's fee" })).toHaveAttribute("href", "/check");
    expect(within(end).getByRole("link", { name: "Find an in-network ATM" })).toHaveAttribute("href", "#find-cash");
    expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
  });

  it("pauses, resumes and replays from the start", () => {
    render(<FeeAnimation scene={ATM_FEES_SCENE} actions={ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch: 25 seconds" }));
    advance(6000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    advance(20000);
    expect(caption()).toBe("The ATM operator may charge you.");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    advance(6000);
    expect(caption()).toBe("Your bank may charge you, too.");
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(caption()).toBe("One withdrawal...");
  });

  it("keeps focus on the play button as it becomes pause and replay", () => {
    render(<FeeAnimation scene={ATM_FEES_SCENE} actions={ACTIONS} />);
    const button = screen.getByRole("button", { name: "Watch: 25 seconds" });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Pause" })).toBe(button);
    advance(25000);
    expect(screen.getByRole("button", { name: "Replay" })).toBe(button);
    expect(document.activeElement).toBe(button);
  });

  it("steps through still frames under reduced motion", () => {
    mockReducedMotion(true);
    render(<FeeAnimation scene={ATM_FEES_SCENE} actions={ACTIONS} />);
    expect(screen.queryByRole("button", { name: "Watch: 25 seconds" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See it step by step" }));
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(caption()).toBe("One withdrawal...");
    const previous = screen.getByRole("button", { name: "Previous" });
    expect(previous).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(previous);
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();

    // No clock runs: time passing changes nothing.
    advance(30000);
    expect(caption()).toBe("One withdrawal...");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(caption()).toBe("The ATM operator may charge you.");
    expect(screen.getByText("+$3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
    expect(caption()).toBe("Check both before you withdraw.");
    expect(screen.getByTestId("fee-animation-end")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(caption()).toBe("Your bank may charge you, too.");
    expect(screen.queryByTestId("fee-animation-end")).toBeNull();
  });
});
