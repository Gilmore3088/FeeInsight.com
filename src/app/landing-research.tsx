"use client";

import {
  Building2,
  CircleCheck,
  FileChartColumn,
  Files,
  Landmark,
  MessagesSquare,
  Network,
  Percent,
  ScrollText,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { SlideControls } from "./landing-controls";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";
import { useAutoAdvance } from "./landing-motion";

type SourceKey = "fees" | "financials" | "branches" | "income" | "cfpb" | "rules" | "fred" | "regional";

/**
 * The source families (James accepted the list, Oct 17: "we are building towards it"). Only
 * sources whose terms allow commercial use appear (James's licence rule, Oct 17): anything struck
 * or still unconfirmed in the data-sources outline stays off the page, and landing.test.tsx
 * checks the names.
 */
export const SOURCES: { key: SourceKey; icon: LucideIcon; name: string; provider: string; detail: string }[] = [
  { key: "fees", icon: Files, name: "Published fees", provider: "Bank & CU schedules", detail: "Published bank and credit union fee schedules, each with its source document." },
  { key: "financials", icon: Landmark, name: "Financial filings", provider: "FDIC · NCUA · SEC", detail: "Bank and credit union financials, fee income detail and SEC filings." },
  { key: "branches", icon: Network, name: "Branches & mergers", provider: "FDIC · NCUA", detail: "Summary of Deposits, credit union branches, merger and charter history." },
  { key: "income", icon: UsersRound, name: "Local income", provider: "Census · IRS", detail: "Household income from the Census ACS and IRS ZIP-level data." },
  { key: "cfpb", icon: MessagesSquare, name: "Complaints", provider: "CFPB", detail: "CFPB consumer complaints, where an institution can be matched." },
  { key: "rules", icon: ScrollText, name: "Rules & actions", provider: "Regulators · States", detail: "Federal and state rules, fee bills, regulator announcements and actions." },
  { key: "fred", icon: Percent, name: "Rates & credit", provider: "FRED", detail: "National FRED series for interest-rate and credit context." },
  { key: "regional", icon: Building2, name: "Regional Fed", provider: "Beige Book · FOMC", detail: "Beige Book, FOMC and regional Federal Reserve publications." },
];

/**
 * Five questions, each lighting the source families its answer draws on, with what that answer
 * covers and the sources it cites (James, Oct 18: "give the resulting answer real substance").
 * The excerpts describe the answer and carry no figures, since none here is read from live data.
 */
export const RESEARCH_EXAMPLES: { question: string; sources: SourceKey[]; title: string; excerpt: string; cites: string }[] = [
  {
    question: "Make me a board report.",
    sources: ["fees", "financials", "branches", "cfpb", "rules"],
    title: "Board report",
    excerpt: "Where each of your fees sits against your market, and which ones are worth a closer look. Every fee links to its schedule.",
    cites: "Fee schedules · FDIC · NCUA · CFPB",
  },
  {
    question: "What’s happening in our local market?",
    sources: ["fees", "branches", "income"],
    title: "Local market brief",
    excerpt: "Who competes in your counties, how their fees compare with yours, and the household income behind that market.",
    cites: "Fee schedules · FDIC Summary of Deposits · Census",
  },
  {
    question: "What’s happening across our region?",
    sources: ["fees", "financials", "income", "fred", "regional"],
    title: "Regional outlook",
    excerpt: "Fee levels across your Fed district, read against the latest Beige Book and national rate and credit series.",
    cites: "Fee schedules · Beige Book · FRED",
  },
  {
    question: "Which fees should we review next?",
    sources: ["fees", "financials", "cfpb", "rules", "fred"],
    title: "Pricing study",
    excerpt: "The fees furthest from your peers, with the complaints, rules and fee income behind each. You make the call.",
    cites: "Fee schedules · FFIEC Call Reports · CFPB",
  },
  {
    question: "How do we compare with credit union peers?",
    sources: ["fees", "financials", "branches", "income"],
    title: "Peer comparison",
    excerpt: "Your fees beside credit unions of your size in your market, fee by fee, each linked to its schedule.",
    cites: "Fee schedules · NCUA 5300",
  },
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
 * "Ask Hamilton. Every answer shows its sources." The source tiles; Hamilton's panel cycles five questions,
 * and for each one the tiles it draws on light up and, from lg up, connector lines run from them
 * to the answer. The first question renders complete on the server, so the panel is never empty.
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
    // Lines run across from each tile to the answer beside the grid. Below lg the answer is
    // stacked under the question, where lines would cross the text, so none are drawn there.
    const next: Line[] = [];
    for (const [key, el] of tiles.current) {
      const r = el.getBoundingClientRect();
      const x = r.right - base.left - 4;
      const y = r.top - base.top + r.height / 2;
      const tx = dest.left - base.left - 2;
      const ty = dest.top - base.top + dest.height / 2;
      const mid = x + (tx - x) * 0.62;
      next.push({ key, d: `M${x.toFixed(1)},${y.toFixed(1)} C${mid.toFixed(1)},${y.toFixed(1)} ${mid.toFixed(1)},${ty.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}` });
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
      <div
        ref={stage}
        className="relative isolate grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)] lg:gap-x-[76px] lg:gap-y-4"
        data-research-stage=""
        role="region"
        aria-roledescription="carousel"
        aria-label="Hamilton connects sources to answers"
      >
        <svg
          className="fi-home-flow pointer-events-none absolute inset-0 -z-10 h-full w-full overflow-visible max-lg:hidden"
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
        {/* A phone reads it in order (James, Oct 18): the ask, the question, the sources it lights,
            then the answer. From lg up the tiles fill the left column and the rest stacks beside them. */}
        <span aria-hidden="true" className="pointer-events-none max-lg:hidden lg:relative lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:before:absolute lg:before:-left-[38px] lg:before:inset-y-0 lg:before:w-px lg:before:bg-border" />
        <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:pl-1">
          <p className="text-[13px] font-medium text-ink-muted" aria-hidden="true">Hey Hamilton,</p>
          <p
            key={`q-${clock.index}`}
            className="fi-home-fade mt-1 min-h-[3.6rem] text-[26px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:min-h-[5.4rem] sm:text-[30px]"
            aria-live={clock.manual ? "polite" : "off"}
            data-research-question=""
          >
            {example.question}
          </p>
        </div>
        <ul className="relative grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2.5 lg:col-start-1 lg:row-span-4 lg:row-start-1 lg:self-start" aria-label="Source families Hamilton draws on">
          {SOURCES.map((s) => {
            const on = lit.has(s.key);
            return (
              <li
                key={s.key}
                ref={(el) => {
                  if (el) tiles.current.set(s.key, el);
                  else tiles.current.delete(s.key);
                }}
                className={`fi-home-source relative z-[1] flex min-h-[3.5rem] items-center gap-2.5 rounded-[6px] border px-2.5 py-2 text-left sm:min-h-[6.5rem] sm:flex-col sm:justify-center sm:gap-0 sm:px-1.5 sm:py-2.5 sm:text-center ${
                  on ? "border-brick/60 bg-brick-tint" : "border-border bg-surface-0"
                }`}
                data-source={s.key}
                data-lit={on}
              >
                {/* An unlit tile dims its icon a little, never its name or provider, so every label stays readable. */}
                <s.icon
                  aria-hidden="true"
                  strokeWidth={1.5}
                  className={`fi-home-source size-5 shrink-0 sm:mb-1.5 sm:size-7 ${on ? "text-brick" : selected ? "text-ink-muted opacity-60" : "text-ink-muted"}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[12px] font-semibold leading-tight text-ink">{s.name}</span>
                  <span className="mt-0.5 text-[11px] leading-tight text-ink-soft" data-source-provider="">{s.provider}</span>
                </span>
                <span className="sr-only">. {s.detail}</span>
              </li>
            );
          })}
        </ul>
        <div className="relative min-w-0 lg:col-start-2 lg:row-start-2 lg:pl-1">
          <div
            ref={output}
            className={`fi-home-output relative rounded-[6px] border border-border bg-surface-0 p-4 shadow-[3px_3px_0_rgb(9_39_71/0.02)] ${
              answered ? "opacity-100" : "translate-y-1 opacity-70"
            }`}
            data-research-output=""
            data-answered={answered}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-8 shrink-0 items-center justify-center rounded-[4px] border border-border bg-paper">
                <FileChartColumn aria-hidden="true" strokeWidth={1.4} className="size-5 text-brick" />
              </span>
              <span key={`t-${clock.index}`} className="fi-home-fade min-w-0 text-[20px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[22px]">
                {example.title}
              </span>
              <CircleCheck aria-hidden="true" className={`ml-auto size-5 shrink-0 text-brick transition-opacity duration-500 ${answered ? "opacity-100" : "opacity-0"}`} />
            </div>
            <p key={`e-${clock.index}`} className="fi-home-fade mt-2.5 min-h-[4.1rem] text-[14px] leading-snug text-ink-soft sm:min-h-[2.8rem]" data-research-excerpt="">
              {example.excerpt}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[12px]">
              <span className="text-ink-muted" data-research-cites="">Sources: {example.cites}</span>
              <TrackLink
                event="sample_report_click"
                eventProps={{ placement: "home_research" }}
                href={REPORT_SHOWCASE.sampleHref}
                className="font-medium text-brick underline decoration-brick/40 underline-offset-4 hover:decoration-brick"
              >
                See a sample report
              </TrackLink>
            </div>
          </div>
        </div>
        <div className="lg:col-start-2 lg:row-start-3 lg:pl-1">
          <SlideControls clock={clock} count={RESEARCH_EXAMPLES.length} name="research examples" small />
        </div>
        {/* The answer leads to the subscription (James, Oct 18). */}
        <div className="lg:col-start-2 lg:row-start-4 lg:self-end lg:pl-1">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_research" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-brick min-h-12 w-full justify-center px-6 text-[15px] sm:w-auto"
          >
            Get Hamilton for your institution
          </TrackLink>
        </div>
      </div>
    </div>
  );
}
