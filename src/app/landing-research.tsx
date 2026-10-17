"use client";

import {
  Building2,
  CircleCheck,
  CreditCard,
  FileChartColumn,
  Files,
  Landmark,
  MapPin,
  MessagesSquare,
  Network,
  Percent,
  ScrollText,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SlideControls } from "./landing-controls";
import { useAutoAdvance } from "./landing-motion";

type SourceKey = "fees" | "financials" | "branches" | "income" | "geography" | "cfpb" | "payments" | "rules" | "fred" | "regional";

/** The ten source families (James accepted the list, Oct 17: "we are building towards it"). */
export const SOURCES: { key: SourceKey; icon: LucideIcon; name: string; detail: string }[] = [
  { key: "fees", icon: Files, name: "Published fees", detail: "Published bank and credit union fee schedules, each with its source document." },
  { key: "financials", icon: Landmark, name: "Financial filings", detail: "Bank and credit union financials, fee income detail and SEC filings." },
  { key: "branches", icon: Network, name: "Branches & mergers", detail: "Summary of Deposits, credit union branches, merger and charter history." },
  { key: "income", icon: UsersRound, name: "Local income", detail: "Household income from the Census ACS and IRS ZIP-level data." },
  { key: "geography", icon: MapPin, name: "Market geography", detail: "USDA urban and rural county classifications." },
  { key: "cfpb", icon: MessagesSquare, name: "Complaints", detail: "CFPB consumer complaints, where an institution can be matched." },
  { key: "payments", icon: CreditCard, name: "Payment services", detail: "Zelle participant data for payment-service availability." },
  { key: "rules", icon: ScrollText, name: "Rules & actions", detail: "Federal and state rules, fee bills, regulator announcements and actions." },
  { key: "fred", icon: Percent, name: "Rates & credit", detail: "National FRED series for interest-rate and credit context." },
  { key: "regional", icon: Building2, name: "Regional Fed", detail: "Beige Book, FOMC and regional Federal Reserve publications." },
];

/** Five questions, each lighting the source families its answer draws on. */
export const RESEARCH_EXAMPLES: { question: string; sources: SourceKey[]; title: string }[] = [
  { question: "Make me a board report.", sources: ["fees", "financials", "branches", "cfpb", "rules"], title: "Board report" },
  { question: "What’s happening in our local market?", sources: ["fees", "branches", "income", "payments", "geography"], title: "Local market brief" },
  { question: "What’s happening across our region?", sources: ["financials", "income", "geography", "fred", "regional"], title: "Regional outlook" },
  { question: "Which fees should we review next?", sources: ["fees", "financials", "cfpb", "rules", "fred"], title: "Pricing study" },
  { question: "How do we compare with credit union peers?", sources: ["fees", "financials", "branches", "income"], title: "Peer comparison" },
];

/** One example's run, as in James's example: sources light at 1.9 s, the answer shows at 4.7 s, next at 10.8 s. */
const SELECT_AT = 1900;
const ANSWER_AT = 4700;
const SLIDE_MS = 10800;
const DOTS_FROM = 2450;
const DOTS_UNTIL = 7600;

interface Line {
  key: SourceKey;
  d: string;
}

/**
 * "The research, already connected." Ten source tiles; Hamilton's panel cycles five questions,
 * and for each one the tiles it draws on light up and connector lines run from them to the
 * answer. The first question renders complete on the server, so the panel is never empty.
 * Lines and dots stop off screen, in a hidden tab, when paused, and with reduced motion
 * (where the lines are drawn still and nothing advances).
 */
export function ResearchStage() {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const output = useRef<HTMLDivElement>(null);
  const tiles = useRef<Map<SourceKey, HTMLLIElement>>(new Map());
  const clock = useAutoAdvance({
    count: RESEARCH_EXAMPLES.length,
    duration: SLIDE_MS,
    rootRef: root,
    initialElapsed: ANSWER_AT,
    holdOnInteract: false,
    threshold: 0.25,
    tick: true,
    settledElapsed: ANSWER_AT,
  });
  const example = RESEARCH_EXAMPLES[clock.index];
  // Stopped mid-example (paused, off screen, hidden tab), the example shows finished, never half-drawn.
  const t = clock.reduced ? ANSWER_AT : clock.playing ? clock.elapsed : Math.max(clock.elapsed, ANSWER_AT);
  const selected = t >= SELECT_AT;
  const answered = t >= ANSWER_AT;

  const [lines, setLines] = useState<Line[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const base = stage.current?.getBoundingClientRect();
    const dest = output.current?.getBoundingClientRect();
    if (!base || !dest) return;
    const grid = [...tiles.current.values()].map((el) => el.getBoundingClientRect());
    const gridBottom = Math.max(...grid.map((r) => r.bottom));
    // Stacked (phone): the answer sits under the tiles, so lines run down from each tile.
    const stacked = dest.top >= gridBottom - 1;
    const next: Line[] = [];
    for (const [key, el] of tiles.current) {
      const r = el.getBoundingClientRect();
      if (stacked) {
        const x = r.left - base.left + r.width / 2;
        const y = r.bottom - base.top - 3;
        const tx = dest.left - base.left + dest.width / 2;
        const ty = dest.top - base.top;
        const mid = (y + ty) / 2;
        next.push({ key, d: `M${x.toFixed(1)},${y.toFixed(1)} C${x.toFixed(1)},${mid.toFixed(1)} ${tx.toFixed(1)},${mid.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}` });
      } else {
        const x = r.right - base.left - 4;
        const y = r.top - base.top + r.height / 2;
        const tx = dest.left - base.left - 2;
        const ty = dest.top - base.top + dest.height / 2;
        const mid = x + (tx - x) * 0.62;
        next.push({ key, d: `M${x.toFixed(1)},${y.toFixed(1)} C${mid.toFixed(1)},${y.toFixed(1)} ${mid.toFixed(1)},${ty.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}` });
      }
    }
    setLines(next);
    setBox({ w: base.width, h: base.height });
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // Fires once on observe, then whenever the stage or the answer box changes size.
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    if (output.current) observer.observe(output.current);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [measure]);

  const lit = new Set<SourceKey>(selected ? example.sources : []);
  // Dots run along the lit lines from 2.45 s to 7.6 s of each example, never with reduced motion.
  const dots = !clock.reduced && t >= DOTS_FROM && t < DOTS_UNTIL;

  return (
    <div ref={root}>
      <div ref={stage} className="relative isolate grid gap-6 lg:grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)] lg:gap-[76px]" data-research-stage="">
        <svg
          className="fi-home-flow pointer-events-none absolute inset-0 -z-10 h-full w-full overflow-visible"
          viewBox={`0 0 ${box.w || 1} ${box.h || 1}`}
          aria-hidden="true"
          data-playing={clock.playing}
        >
          {lines.map((line) => {
            const on = lit.has(line.key);
            const order = example.sources.indexOf(line.key);
            return (
              <g key={line.key} data-on={on}>
                <path d={line.d} pathLength={1} fill="none" stroke="var(--color-brick)" strokeOpacity={on ? 0.4 : 0} strokeWidth={1} />
                {on && dots ? (
                  <circle r={2.2} className="fi-home-dot" fill="var(--color-brick)" style={{ offsetPath: `path('${line.d}')`, animationDelay: `${order * 0.26}s` }} />
                ) : null}
              </g>
            );
          })}
        </svg>
        <ul className="relative grid grid-cols-5 gap-1.5 sm:gap-2.5" aria-label="Ten source families Hamilton draws on">
          {SOURCES.map((s) => {
            const on = lit.has(s.key);
            return (
              <li
                key={s.key}
                ref={(el) => {
                  if (el) tiles.current.set(s.key, el);
                  else tiles.current.delete(s.key);
                }}
                className={`fi-home-source relative z-[1] flex min-h-[5.5rem] flex-col items-center justify-center rounded-[6px] border px-1 py-3 text-center sm:min-h-[6.5rem] sm:px-1.5 ${
                  on ? "border-brick/60 bg-brick-tint" : "border-border bg-surface-0"
                }`}
                data-source={s.key}
                data-lit={on}
              >
                {/* An unlit tile fades its icon, never its name, so every label stays readable. */}
                <s.icon
                  aria-hidden="true"
                  strokeWidth={1.5}
                  className={`fi-home-source mb-2 size-6 sm:size-7 ${on ? "text-brick" : selected ? "text-ink-muted opacity-30" : "text-ink-muted"}`}
                />
                <span className={`text-[10px] font-semibold leading-tight sm:text-[12px] ${on || !selected ? "text-ink" : "text-ink-soft"}`}>{s.name}</span>
                <span className="sr-only">. {s.detail}</span>
              </li>
            );
          })}
        </ul>
        <div
          className="relative flex min-w-0 flex-col lg:pl-1 lg:before:absolute lg:before:-left-[38px] lg:before:inset-y-0 lg:before:w-px lg:before:bg-border"
          role="region"
          aria-roledescription="carousel"
          aria-label="Hamilton connects sources to answers"
        >
          <p
            key={`q-${clock.index}`}
            className="fi-home-fade min-h-[4.6rem] text-[26px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:min-h-[5.4rem] sm:text-[30px]"
            aria-live={clock.manual ? "polite" : "off"}
            data-research-question=""
          >
            {example.question}
          </p>
          <div
            ref={output}
            className={`fi-home-output relative mt-3 flex min-h-[6.75rem] items-center gap-3.5 rounded-[6px] border border-border bg-surface-0 p-4 shadow-[3px_3px_0_rgb(9_39_71/0.02)] ${
              answered ? "opacity-100" : "translate-y-1 opacity-45"
            }`}
            data-research-output=""
            data-answered={answered}
          >
            <span className="hidden h-[3.6rem] w-11 shrink-0 items-center justify-center rounded-[4px] border border-border bg-paper sm:flex">
              <FileChartColumn aria-hidden="true" strokeWidth={1.4} className="size-6 text-brick" />
            </span>
            <span className="min-w-0">
              <span className="block text-[21px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[23px]">{example.title}</span>
            </span>
            <CircleCheck aria-hidden="true" className={`ml-auto size-5 shrink-0 text-brick transition-opacity duration-500 ${answered ? "opacity-100" : "opacity-0"}`} />
          </div>
          <div className="mt-4 lg:mt-auto lg:pt-4">
            <SlideControls clock={clock} count={RESEARCH_EXAMPLES.length} name="research examples" small />
          </div>
        </div>
      </div>
    </div>
  );
}
