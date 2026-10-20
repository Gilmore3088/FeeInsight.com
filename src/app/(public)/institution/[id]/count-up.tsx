"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/app/landing-motion";
import { formatCompactDollars } from "@/lib/format";

export type CountUnit = "dollars" | "percent" | "count";

export function formatCount(unit: CountUnit, n: number): string {
  if (unit === "dollars") return formatCompactDollars(n);
  if (unit === "percent") return `${n.toFixed(1)}%`;
  return Math.round(n).toLocaleString("en-US");
}

/**
 * A card figure that counts up the first time it scrolls into view. The server renders the final
 * text, so the figure is right without script, in print and for screen readers; a figure already
 * on screen at load stays still, and reduced motion never animates.
 */
export function CountUp({ value, unit, duration = 700 }: { value: number; unit: CountUnit; duration?: number }) {
  const format = (n: number) => formatCount(unit, n);
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number>(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          setShown(value * (1 - (1 - t) ** 3));
          if (t < 1) frame = requestAnimationFrame(step);
        };
        setShown(0);
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, reduced, duration]);

  return (
    <span ref={ref} aria-label={format(value)}>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  );
}
