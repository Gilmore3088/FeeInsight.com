"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { trackEvent } from "@/lib/analytics";

/** The four parts of Pro, in James's words (9 Oct 2026): long copy on desktop, short on phones. */
export const PILLARS = [
  {
    key: "benchmark",
    title: "Benchmark",
    body: "Compare published fees against the institutions that matter to you.",
    short: "Compare your published fees with relevant peers.",
  },
  {
    key: "analyze",
    title: "Analyze",
    body: "Explore fee structures and test illustrative pricing scenarios with Hamilton.",
    short: "Explore fee structures and illustrative scenarios.",
  },
  {
    key: "monitor",
    title: "Monitor",
    body: "Follow competitor fee changes and relevant regulatory developments.",
    short: "Track competitor fee changes and regulatory developments.",
  },
  {
    key: "report",
    title: "Report",
    body: "Generate source-backed research for management and pricing committees.",
    short: "Prepare source-backed research for internal decisions.",
  },
] as const;

/** How long each example stays up while the page cycles on its own. */
export const CYCLE_MS = 7000;
const STAGE_ID = "pro-showcase";

interface ShowcaseState {
  active: number;
  /** True while the examples advance on their own (stops for good once a reader picks one). */
  cycling: boolean;
  /** Held while the reader hovers or focuses the example; the turn restarts after. */
  paused: boolean;
  /** Bumped on every change so the progress bar restarts. */
  turn: number;
  choose: (index: number) => void;
  setPaused: (paused: boolean) => void;
}

const ShowcaseContext = createContext<ShowcaseState | null>(null);

export function useShowcase(): ShowcaseState {
  const state = useContext(ShowcaseContext);
  if (!state) throw new Error("useShowcase needs a ShowcaseProvider");
  return state;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(REDUCED_MOTION).matches === true;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** The reader's reduced-motion setting; the server render assumes it is on (nothing moves). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => true);
}

/**
 * The hero image shows one example per capability and steps through them; the capability
 * list further down says which one is showing and opens any of them. Cycling never starts
 * under reduced motion or once an institution is picked (its own fees are the point then),
 * pauses while the reader hovers or focuses the example, and stops once they choose one.
 */
export function ShowcaseProvider({ autoCycle, entry, children }: { autoCycle: boolean; entry: string; children: ReactNode }) {
  const [active, setActive] = useState(0);
  const [turn, setTurn] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const cycling = autoCycle && !reduced && !stopped;

  useEffect(() => {
    if (!cycling || paused) return;
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % PILLARS.length);
      setTurn((t) => t + 1);
    }, CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [cycling, paused, turn]);

  const choose = useCallback(
    (index: number) => {
      setStopped(true);
      setActive(index);
      setTurn((t) => t + 1);
      trackEvent("subscribe_example_viewed", { example: PILLARS[index].key, entry });
    },
    [entry],
  );

  return (
    <ShowcaseContext.Provider value={{ active, cycling, paused, turn, choose, setPaused }}>
      {children}
    </ShowcaseContext.Provider>
  );
}

/** The hero image: every example sits in the same cell so the frame never changes height. */
export function ShowcaseStage({ panels }: { panels: ReactNode[] }) {
  const { active, setPaused, choose } = useShowcase();
  return (
    <div>
    <div
      id={STAGE_ID}
      className="grid scroll-mt-24"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {panels.map((panel, i) => (
        <div
          key={PILLARS[i].key}
          id={`pro-example-${PILLARS[i].key}`}
          role="region"
          aria-label={`${PILLARS[i].title} example`}
          aria-hidden={i !== active}
          inert={i !== active}
          className={`[grid-area:1/1] transition-opacity duration-500 motion-reduce:transition-none ${
            i === active ? "opacity-100" : "pointer-events-none invisible opacity-0"
          }`}
        >
          {panel}
        </div>
      ))}
    </div>
    <div className="mt-1 flex items-center justify-center gap-1" role="group" aria-label="Examples">
      {PILLARS.map((pillar, i) => (
        <button
          key={pillar.key}
          type="button"
          onClick={() => choose(i)}
          aria-label={`${pillar.title} example`}
          aria-pressed={i === active}
          className="group flex h-11 w-9 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-[#1A1815]"
        >
          <span
            aria-hidden
            className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${
              i === active ? "w-5 bg-[#1A1815]" : "w-2 bg-[#CFC5B7] group-hover:bg-[#6B6255]"
            }`}
          />
        </button>
      ))}
      <span className="ml-1 text-xs text-[#6B6255]">{PILLARS[active].title}</span>
    </div>
    </div>
  );
}

/** The same list with nothing to open, for when the examples couldn't be read. */
function StaticPillars() {
  return (
    <ul className="divide-y divide-[#E3DACC] sm:grid sm:grid-cols-2 sm:gap-x-10 sm:gap-y-8 sm:divide-y-0 lg:grid-cols-4">
      {PILLARS.map((pillar) => (
        <li key={pillar.key} className="py-4 first:pt-0 last:pb-0 sm:py-0">
          <h3 className="text-base font-semibold text-[#1A1815] sm:text-lg">{pillar.title}</h3>
          <p className="mt-1 text-[15px] leading-relaxed text-[#3D3833] sm:mt-2">
            <span className="sm:hidden">{pillar.short}</span>
            <span className="hidden sm:inline">{pillar.body}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Full while an example is chosen; fills over one turn while the page cycles. */
function FillBar({ filling }: { filling: boolean }) {
  const [started, setStarted] = useState(!filling);
  useEffect(() => {
    if (!filling) return;
    const frame = window.requestAnimationFrame(() => setStarted(true));
    return () => window.cancelAnimationFrame(frame);
  }, [filling]);
  const full = !filling || started;
  return (
    <span
      className="block h-full bg-[#1A1815] ease-linear"
      style={{
        width: full ? "100%" : "0%",
        transitionProperty: "width",
        transitionDuration: filling ? `${CYCLE_MS}ms` : "0ms",
      }}
    />
  );
}

/**
 * The four capabilities, laid out as before (James, 9 Oct 2026: "I like the current"). Each
 * one opens its example in the hero image; the one showing is marked, with a thin bar that
 * fills while the page is cycling.
 */
export function ShowcasePillars({ interactive = true }: { interactive?: boolean }) {
  const { active, cycling, paused, turn, choose } = useShowcase();
  if (!interactive) return <StaticPillars />;
  const open = (index: number) => {
    choose(index);
    const stage = document.getElementById(STAGE_ID);
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      stage.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    }
  };
  return (
    <ul className="divide-y divide-[#E3DACC] sm:grid sm:grid-cols-2 sm:gap-x-10 sm:gap-y-8 sm:divide-y-0 lg:grid-cols-4">
      {PILLARS.map((pillar, i) => {
        const on = i === active;
        return (
          <li key={pillar.key} className="py-1 first:pt-0 last:pb-0 sm:py-0">
            <button
              type="button"
              onClick={() => open(i)}
              aria-controls={`pro-example-${pillar.key}`}
              aria-pressed={on}
              className="group block w-full rounded-md py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1815] sm:py-0"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-base font-semibold text-[#1A1815] sm:text-lg">{pillar.title}</span>
                <span
                  className={`text-xs font-medium ${on ? "text-[#1A1815]" : "text-[#6B6255] group-hover:text-[#1A1815]"}`}
                >
                  {on ? "Showing above" : "See example"}
                </span>
              </span>
              <span className="mt-1 block text-[15px] leading-relaxed text-[#3D3833] sm:mt-2">
                <span className="sm:hidden">{pillar.short}</span>
                <span className="hidden sm:inline">{pillar.body}</span>
              </span>
              <span aria-hidden className="mt-3 block h-0.5 overflow-hidden rounded-full bg-[#E3DACC]">
                {on && <FillBar key={`${turn}-${paused}`} filling={cycling && !paused} />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
