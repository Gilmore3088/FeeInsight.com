import { ArrowDown, FileCheck, Layers, MessageSquareText, Scale } from "lucide-react";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { SITE_NAME } from "@/lib/constants";
import { HOME_WRAP, SERIF } from "./landing-shared";

/**
 * What a Hamilton investigation does, step by step, with no figures: the One question section below
 * shows it working on the demo bank's real data (James's review, Oct 19: one interactive demonstration).
 */
export const HAMILTON_STEPS = [
  { icon: MessageSquareText, name: "Ask", line: "A pricing question, in plain words" },
  { icon: Layers, name: "Gather", line: "Fees, Call Reports, market data and rules" },
  { icon: Scale, name: "Weigh", line: "What stands out, and what is still missing" },
  { icon: FileCheck, name: "Brief", line: "A committee brief, every figure sourced" },
] as const;

/**
 * The Hamilton introduction (James's review, Oct 19): a heading, one line and a glimpse of how an
 * investigation runs, leading into the One question demonstration below (#research). It repeats
 * none of the demo bank's figures; that section carries them. One primary action, the subscription.
 */
export function LandingHamilton() {
  return (
    <section id="hamilton" aria-labelledby="hamilton-title" className="scroll-mt-20 bg-paper py-10 sm:py-14">
      <div className={`${HOME_WRAP} grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14`}>
        <div className="fi-home-intro min-w-0">
          <h2 id="hamilton-title" className="fi-home-h2 !font-medium text-ink" style={SERIF}>
            {/* No nowrap: the longer first line could overflow a 320px phone; balance keeps both words paired. */}
            <span className="block">Make fee decisions</span> <span className="block">you can defend.</span>
          </h2>
          <p className="mt-4 max-w-[34rem] text-[17px] leading-[1.45] text-ink-soft sm:text-[19px]">
            Hamilton, the {SITE_NAME} Pro workspace, turns a pricing question into an answer your committee can check.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "home_hamilton" }}
              href={PRO_PLANS_NAV.href}
              className="fi-btn fi-btn-brick min-h-12 px-6 text-[15px]"
            >
              Get Hamilton for your institution
            </TrackLink>
            <a
              href="#research"
              className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-ink-soft underline decoration-ink-muted/40 underline-offset-4 hover:text-ink"
              data-demo-link=""
            >
              See it work
              <ArrowDown aria-hidden="true" className="size-3.5" />
            </a>
          </div>
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:gap-3" aria-label="How a Hamilton investigation runs" data-hamilton-steps="">
          {HAMILTON_STEPS.map((s, i) => (
            <li key={s.name} className="flex min-w-0 flex-col rounded-[8px] border border-border bg-surface-0 p-3 sm:p-4" data-hamilton-step={s.name.toLowerCase()}>
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="text-[12px] font-semibold tabular-nums text-brick">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <s.icon aria-hidden="true" strokeWidth={1.5} className="size-4 text-ink" />
              </span>
              <span className="mt-2 text-[16px] font-semibold leading-tight text-ink sm:text-[18px]">{s.name}</span>
              <span className="mt-1 text-[13px] leading-snug text-ink-soft">{s.line}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
