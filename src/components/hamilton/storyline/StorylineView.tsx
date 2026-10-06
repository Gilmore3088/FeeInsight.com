/**
 * A Hamilton answer told as a consulting storyline: the governing thought, the figures that
 * carry it, situation and complication, numbered exhibits under titles that state their point,
 * the board and market readings of the same facts, options with their consequences (never a
 * pick), and what would change the conclusion.
 */
import type { ReactNode } from "react";
import type { Fact } from "@/lib/hamilton/workspace/types";
import { SourceChip } from "@/components/hamilton/memo/exhibit-view";
import { withFiguresBold } from "@/components/hamilton/memo/answer-memo";
import { SERIF } from "@/components/hamilton/memo/memo";
import { LensSwitch } from "./LensSwitch";
import { StoryExhibitView } from "./story-exhibits";
import type { Storyline } from "./types";

function Line({ fact }: { fact: Fact }) {
  return (
    <>
      {withFiguresBold(fact.text)} <SourceChip source={fact.source} n={fact.sampleSize} />
    </>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-warm-600">{children}</h3>;
}

function LensList({ facts, empty }: { facts: Fact[]; empty: string }) {
  if (facts.length === 0) return <p className="text-sm text-warm-600">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {facts.map((f, i) => (
        <li key={i} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-[15px] leading-relaxed text-warm-800">
          <span aria-hidden className="mt-2.5 h-1.5 w-1.5 rounded-full bg-terra" />
          <span>
            <Line fact={f} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StorylineView({ story, nextSteps }: { story: Storyline; nextSteps?: ReactNode }) {
  const figures = story.keyFigures.slice(0, 4);
  const cols = figures.length >= 4 ? "sm:grid-cols-4" : figures.length === 3 ? "sm:grid-cols-3" : figures.length === 2 ? "sm:grid-cols-2" : "";
  return (
    <article className="flex flex-col gap-9">
      <div className="border-l-2 border-terra pl-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-terra-text">The answer</p>
        <p className="mt-1 text-2xl leading-snug text-warm-900 sm:text-[1.85rem]" style={SERIF}>
          {story.governingThought}
        </p>
      </div>

      {figures.length > 0 ? (
        <dl className={`grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-warm-300 bg-warm-300 ${cols}`}>
          {figures.map((f) => (
            <div key={f.label} className="flex flex-col bg-white px-5 py-4">
              <dd className="text-3xl text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                {f.value}
              </dd>
              <dt className="mt-1 flex-1 text-xs leading-snug text-warm-600">{f.label}</dt>
              <span className="mt-2">
                <SourceChip source={f.source} n={f.n} />
              </span>
            </div>
          ))}
        </dl>
      ) : null}

      {story.situation.length > 0 || story.complication.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <Kicker>Where things stand</Kicker>
            <LensList facts={story.situation} empty="" />
          </section>
          <section>
            <Kicker>What has changed</Kicker>
            <LensList facts={story.complication} empty="Nothing material has moved in the period on file." />
          </section>
        </div>
      ) : null}

      {story.exhibits.map((item, i) => (
        <StoryExhibitView key={item.id} item={item} number={item.number ?? i + 1} />
      ))}

      <section>
        <Kicker>What it means for you</Kicker>
        <LensSwitch
          initial={story.defaultView ?? "finance"}
          finance={<LensList facts={story.lenses.finance} empty="Nothing on file for the board view yet." />}
          market={<LensList facts={story.lenses.market} empty="Nothing on file for the market view yet." />}
        />
      </section>

      {story.options && story.options.length > 0 ? (
        <section>
          <Kicker>Options and what each would mean</Kicker>
          <div className={`grid gap-3 ${story.options.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
            {story.options.map((o) => (
              <div key={o.label} className="flex flex-col gap-2 rounded-lg border border-warm-300 bg-warm-50 p-4">
                <p className="text-lg leading-snug text-warm-900" style={SERIF}>
                  {o.label}
                </p>
                <ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-warm-800">
                  {o.consequences.map((c, i) => (
                    <li key={i}>
                      <Line fact={c} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-warm-600">Hamilton sets out the options; the choice is your team&apos;s.</p>
        </section>
      ) : null}

      {story.watch.length > 0 ? (
        <section>
          <Kicker>What would change this</Kicker>
          <LensList facts={story.watch} empty="" />
        </section>
      ) : null}

      {nextSteps ? <div className="flex flex-wrap justify-end gap-2 border-t border-warm-200 pt-4">{nextSteps}</div> : null}
    </article>
  );
}
