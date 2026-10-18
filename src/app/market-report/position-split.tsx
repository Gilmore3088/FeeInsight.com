"use client";

import { ArrowDown, ArrowUp, Equal, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import { useCountUp } from "@/app/landing-motion";
import "@/app/landing-motion.css";

type Part = "above" | "inside" | "below";

const PARTS: Record<Part, { label: string; Icon: LucideIcon; text: string; chip: string; bar: string }> = {
  above: { label: "above", Icon: ArrowUp, text: "text-brick", chip: "bg-brick-tint text-brick", bar: "bg-brick" },
  inside: { label: "inside", Icon: Equal, text: "text-ink", chip: "bg-surface-200 text-ink", bar: "bg-ink-soft" },
  below: { label: "below", Icon: ArrowDown, text: "text-below-market", chip: "bg-below-market/10 text-below-market", bar: "bg-below-market" },
};

function Figure({ part, n }: { part: Part; n: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useCountUp(n, ref);
  const { label, Icon, text, chip } = PARTS[part];
  return (
    <div className="min-w-0">
      <span ref={ref} className={`block font-mono text-[44px] font-semibold leading-none tabular-nums tracking-[-0.03em] sm:text-[56px] ${text}`}>
        {shown}
      </span>
      <span className="mt-2 flex items-center gap-1.5 text-[14px] font-medium text-ink sm:text-[15px]">
        <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full ${chip}`}>
          <Icon className="size-3.5" strokeWidth={2.5} />
        </span>
        {label}
      </span>
    </div>
  );
}

/**
 * The report's opening figure (James, Oct 18): how many compared fees sit above, inside and below
 * the local middle 50%, as three counted figures over one stacked bar. Drawn only; the sentence
 * that says the same goes beside it for screen readers (`summary`).
 */
export function PositionSplit({ above, inside, below, summary }: { above: number; inside: number; below: number; summary: string }) {
  const total = above + inside + below;
  const parts: [Part, number][] = [
    ["above", above],
    ["inside", inside],
    ["below", below],
  ];
  return (
    <figure className="mx-auto mt-6 max-w-[34rem] text-left sm:mx-0" data-position-split="">
      <div aria-hidden="true">
        <div className="grid grid-cols-3 gap-4 sm:gap-8">
          {parts.map(([part, n]) => (
            <Figure key={part} part={part} n={n} />
          ))}
        </div>
        <div className="fi-grow-x mt-5 flex h-2.5 gap-[3px] overflow-hidden rounded-full [print-color-adjust:exact]">
          {parts.map(([part, n]) =>
            n > 0 ? <span key={part} className={PARTS[part].bar} style={{ flexGrow: n, flexBasis: 0 }} /> : null,
          )}
        </div>
      </div>
      <figcaption className="mt-2.5 text-[13px] text-ink-soft">
        <span className="sr-only">{summary}</span>
        <span aria-hidden="true">the local middle 50%, across {total} compared {total === 1 ? "fee" : "fees"}</span>
      </figcaption>
    </figure>
  );
}
