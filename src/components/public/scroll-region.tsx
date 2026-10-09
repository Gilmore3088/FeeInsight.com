"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A box that pans its wide content (a data table) sideways inside itself, never the page.
 *
 * - The region is focusable (tabIndex 0) with an accessible name, so a keyboard user can
 *   Tab to it and scroll it with the arrow keys; the focus ring is drawn inset so a
 *   rounded, clipped card edge cannot hide it. The global `*:focus-visible` rule is
 *   unlayered, so the offset and radius here need Tailwind's important modifier.
 * - A written cue says the content scrolls, shown exactly while it is wider than the box.
 *   The server cannot know that, so the first paint uses `initialCueClass` (a width
 *   query that is right for typical content); once the page runs, the box is measured
 *   and re-measured on every resize, so a table that is wider than its minimum width
 *   (long names, a narrow column in a two-column layout) still gets its cue.
 *   The right-edge fade from `.table-scroll` stays as a second signal.
 */
export function ScrollRegion({
  label,
  children,
  initialCueClass = "",
  cueClassName = "",
  className = "",
}: {
  /** Names the region for screen readers, e.g. "Overdraft fee by Federal Reserve district". */
  label: string;
  children: ReactNode;
  /** Classes that show the cue before measurement, e.g. "@max-[560px]:block". */
  initialCueClass?: string;
  /** Look of the cue line. */
  cueClassName?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState<boolean | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const cueVisibility = overflows === null ? `hidden ${initialCueClass}` : overflows ? "block" : "hidden";

  return (
    <>
      <p aria-hidden="true" className={`${cueVisibility} ${cueClassName}`}>
        Scroll sideways to see every column &rarr;
      </p>
      <div
        ref={ref}
        role="region"
        aria-label={`${label} (scrolls sideways)`}
        tabIndex={0}
        className={`table-scroll focus-visible:rounded-xl! focus-visible:outline-offset-[-2px]! ${className}`}
      >
        {children}
      </div>
    </>
  );
}
