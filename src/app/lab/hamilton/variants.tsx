/**
 * Lab only (James, Oct 17 05:05): five ways to show Hamilton on the homepage, each drawn with
 * Hamilton's own Pro components from real data. Nothing here is written for the page: the
 * exhibits come from a saved Hamilton answer, the scorecard from today's live briefing.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/brand/components";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { ProductFrame } from "@/components/marketing/product-frame";
import { StoryExhibitView } from "@/components/hamilton/storyline/story-exhibits";
import { StorylineView } from "@/components/hamilton/storyline/StorylineView";
import { ThisMonthOverview } from "@/components/hamilton/benchmark/ThisMonthOverview";
import { FeeScorecard } from "@/components/hamilton/benchmark/FeeScorecard";
import { LocalCompetitors } from "@/components/hamilton/benchmark/LocalCompetitors";
import { buildBriefingOverview } from "@/lib/hamilton/briefing-observations";
import { COMPETITOR_MOVE_WINDOW_DAYS } from "@/lib/hamilton/workspace/research";
import type { Storyline, StoryExhibit } from "@/lib/hamilton/workspace/storyline-types";
import type { Briefing } from "@/lib/hamilton/workspace/types";
import { DISPLAY_H2, SAMPLE_REPORT_HREF, SANS, SECTION_INNER } from "../../landing-shared";
import { ExhibitTabs } from "./exhibit-tabs";
import { SERIF } from "@/components/hamilton/memo/memo";

export interface SavedAnswer {
  question: string;
  askedOn: string;
  institutionName: string;
  story: Storyline;
}

export interface LiveBriefing {
  briefing: Briefing;
  mixedBasis: string[];
}

function longDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The homepage section around each option: the brief's heading, lines and two buttons. */
export function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="hamilton-heading" className="border-t border-border bg-paper">
      <div className={`${SECTION_INNER} py-16 sm:py-20`}>
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="hamilton-heading" className="flex justify-center">
            <Logo mark="hamilton-wordmark" height={30} title="" />
            <span className="sr-only">Hamilton</span>
          </h2>
          <p className={`mt-5 ${DISPLAY_H2}`} style={SANS}>
            Your fees. Your competitors. Your next committee report.
          </p>
          <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            Hamilton brings your institution&apos;s fees, peer comparisons and supporting evidence into one workspace.
          </p>
        </div>
        <div className="mt-10 sm:mt-12">{children}</div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href={PRO_PLANS_NAV.href} className="fi-btn fi-btn-primary min-h-11 justify-center whitespace-nowrap">
            {PRO_PLANS_NAV.label}
          </Link>
          <Link href={SAMPLE_REPORT_HREF} className="fi-btn fi-btn-secondary min-h-11 justify-center whitespace-nowrap">
            Open the sample report
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The question as it was typed into Hamilton, above the answer. */
function AskBar({ answer }: { answer: SavedAnswer }) {
  return (
    <div className="border-b border-border bg-surface-0 px-4 py-3 sm:px-6">
      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Asked about {answer.institutionName}</p>
      <p className="mt-1 text-[15px] leading-snug text-ink">{answer.question}</p>
    </div>
  );
}

function frameLabel(answer: SavedAnswer) {
  return { label: "Hamilton · Ask", aside: <span className="hidden sm:inline">Saved answer · {longDate(answer.askedOn)}</span> };
}

function exhibit(answer: SavedAnswer, kind: string): StoryExhibit | null {
  return answer.story.exhibits.find((e) => e.exhibit.kind === kind) ?? null;
}

function KeyFigures({ story }: { story: Storyline }) {
  const figures = story.keyFigures.slice(0, 4);
  if (figures.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-warm-300 bg-warm-300 lg:grid-cols-4">
      {figures.map((f) => (
        <div key={f.label} className="flex flex-col bg-white px-4 py-3 sm:px-5 sm:py-4">
          <dt className="order-2 mt-1 text-[13px] leading-snug text-warm-600">{f.label}</dt>
          <dd className={`order-1 ${f.value.length > 8 ? "text-xl" : "text-2xl"} text-warm-900 [font-variant-numeric:tabular-nums]`} style={SERIF}>
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Thought({ story }: { story: Storyline }) {
  return (
    <div className="border-l-2 border-terra pl-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-terra-text">The answer</p>
      <p className="mt-1 text-[1.25rem] leading-snug text-warm-900 sm:text-2xl" style={SERIF}>
        {story.governingThought}
      </p>
    </div>
  );
}

/** A: the answer as its exhibits only. Headline, four figures, three of Hamilton's own charts. */
export function ExhibitBoard({ answer }: { answer: SavedAnswer }) {
  const position = exhibit(answer, "fee_position");
  const market = exhibit(answer, "competitor_range");
  const money = exhibit(answer, "money_at_stake");
  const name = answer.institutionName;
  return (
    <ProductFrame {...frameLabel(answer)}>
      <AskBar answer={answer} />
      <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
        <Thought story={answer.story} />
        <KeyFigures story={answer.story} />
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-6">
            {position ? <StoryExhibitView item={position} number={1} researchInstitutionName={name} /> : null}
            {money ? <StoryExhibitView item={money} number={3} researchInstitutionName={name} /> : null}
          </div>
          <div className="min-w-0">{market ? <StoryExhibitView item={market} number={2} researchInstitutionName={name} /> : null}</div>
        </div>
      </div>
    </ProductFrame>
  );
}

const SHORT: Record<string, string> = {
  fee_position: "Against peers",
  competitor_range: "Local market",
  archetype_map: "Pricing groups",
  structure_matrix: "Fee structure",
  money_at_stake: "Fee income",
  trend: "Over time",
  segment_table: "Segment",
  change_timeline: "Changes",
};

/** B: one exhibit at a time. Every exhibit Hamilton drew, each behind a short tab. */
export function ExhibitStepper({ answer }: { answer: SavedAnswer }) {
  const items = answer.story.exhibits.map((e, i) => ({
    id: e.id,
    label: SHORT[e.exhibit.kind] ?? `Exhibit ${i + 1}`,
    panel: <StoryExhibitView item={e} number={i + 1} researchInstitutionName={answer.institutionName} />,
  }));
  return (
    <ProductFrame {...frameLabel(answer)}>
      <AskBar answer={answer} />
      <div className="px-4 pt-5 sm:px-6">
        <Thought story={answer.story} />
      </div>
      <ExhibitTabs items={items} />
    </ProductFrame>
  );
}

/** C: the answer screen exactly as Hamilton draws it, scrolling inside the window. */
export function FullAnswer({ answer }: { answer: SavedAnswer }) {
  return (
    <ProductFrame {...frameLabel(answer)}>
      <AskBar answer={answer} />
      <div className="max-h-[46rem] overflow-y-auto px-4 py-6 sm:px-8">
        <StorylineView story={answer.story} />
      </div>
    </ProductFrame>
  );
}

/** D: Hamilton's This month screen for one institution, computed live today. */
export function LiveMonth({ live, picker }: { live: LiveBriefing; picker?: ReactNode }) {
  const { briefing, mixedBasis } = live;
  const overview = buildBriefingOverview(briefing, briefing.stateCode ?? null, new Set(mixedBasis));
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <ProductFrame label={`Hamilton · This month · ${briefing.institutionName}`} aside={<span className="hidden sm:inline">{month}</span>}>
      {picker}
      <div className="flex flex-col gap-8 px-4 py-6 sm:px-6">
        <ThisMonthOverview
          institutionName={briefing.institutionName}
          peerLabel={briefing.peerLabel}
          overview={overview}
          windowDays={COMPETITOR_MOVE_WINDOW_DAYS}
          overdraftIncome={briefing.overdraftIncome ?? null}
        />
        {briefing.localMarket ? <LocalCompetitors market={briefing.localMarket} notCompared={mixedBasis} /> : null}
        {briefing.positions.length > 0 ? (
          <FeeScorecard rows={briefing.positions} institutionId={String(briefing.institutionId)} institutionName={briefing.institutionName} notCompared={mixedBasis} />
        ) : null}
      </div>
    </ProductFrame>
  );
}

/** E's control: the demo institutions, each opening D for that institution. */
export function InstitutionPicker({ options, selected, hrefFor }: { options: { id: number; name: string }[]; selected: number; hrefFor: (id: number) => string }) {
  return (
    <nav aria-label="Choose an institution" className="flex gap-2 overflow-x-auto border-b border-border bg-surface-0 px-4 py-3 sm:px-6">
      {options.map((o) => (
        <Link
          key={o.id}
          href={hrefFor(o.id)}
          scroll={false}
          aria-current={o.id === selected ? "true" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[14px] font-semibold ${
            o.id === selected ? "border-ink bg-ink text-white" : "border-border text-ink-soft hover:border-ink hover:text-ink"
          }`}
        >
          {o.name}
        </Link>
      ))}
    </nav>
  );
}
