/**
 * A Hamilton answer told as a consulting storyline: the governing thought, the figures that
 * carry it, situation and complication, numbered exhibits under titles that state their point,
 * the board and market readings of the same facts, options with their consequences (never a
 * pick), and what would change the conclusion.
 */
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { Fact } from "@/lib/hamilton/workspace/types";
import { SourceChip } from "@/components/hamilton/memo/exhibit-view";
import { withFiguresBold } from "@/components/hamilton/memo/answer-memo";
import { SERIF } from "@/components/hamilton/memo/memo";
import { LensSwitch } from "./LensSwitch";
import { StoryExhibitView } from "./story-exhibits";
import type { StorylineMemo } from "@/lib/hamilton/workspace/storyline-types";
import type { Storyline } from "./types";

/** Hamilton's written memo over the storyline: still being written, written, or not written and why. */
export type MemoState =
  | { state: "writing" }
  | { state: "written"; memo: StorylineMemo }
  | { state: "none"; reason: string };

function Line({ fact, showSource = true }: { fact: Fact; showSource?: boolean }) {
  return (
    <>
      {withFiguresBold(fact.text)} {showSource ? <SourceChip source={fact.source} n={fact.sampleSize} /> : null}
    </>
  );
}

const sourceKey = (f: Fact) => [f.source.label, f.source.asOf ?? "", f.sampleSize ?? ""].join("|");

/** A run of lines from one source carries its chip once, on the first line, so the page reads as prose. */
export function sourceShownAt(facts: readonly Fact[]): boolean[] {
  return facts.map((f, i) => i === 0 || sourceKey(f) !== sourceKey(facts[i - 1]));
}

function Kicker({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-warm-600">{children}</h3>;
}

function LensList({ facts, empty }: { facts: Fact[]; empty: string }) {
  if (facts.length === 0) return <p className="text-sm text-warm-600">{empty}</p>;
  const shown = sourceShownAt(facts);
  return (
    <ul className="flex flex-col gap-2.5">
      {facts.map((f, i) => (
        <li key={i} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-[15px] leading-relaxed text-warm-800">
          <span aria-hidden className="mt-2.5 h-1.5 w-1.5 rounded-full bg-terra" />
          <span>
            <Line fact={f} showSource={shown[i]} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function MemoNote({ text }: { text: string }) {
  return (
    <p className="max-w-[68ch] whitespace-pre-line text-[17px] leading-relaxed text-warm-800 [font-variant-numeric:tabular-nums]" style={SERIF}>
      {withFiguresBold(text)}
    </p>
  );
}

export function StorylineView({ story, nextSteps, memo }: { story: Storyline; nextSteps?: ReactNode; memo?: MemoState }) {
  const written = memo?.state === "written" ? memo.memo : null;
  const figures = story.keyFigures.slice(0, 4);
  const cols = figures.length >= 4 ? "sm:grid-cols-4" : figures.length === 3 ? "sm:grid-cols-3" : figures.length === 2 ? "sm:grid-cols-2" : "";
  return (
    <article className="flex flex-col gap-9">
      <div className="border-l-2 border-terra pl-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-terra-text">The answer</p>
        <p className="mt-1 text-2xl leading-snug text-warm-900 sm:text-[1.85rem]" style={SERIF}>
          {story.governingThought}
        </p>
        {written ? (
          <div className="mt-3 flex flex-col gap-1.5">
            <MemoNote text={written.summary} />
            <p className="text-xs text-warm-600">
              Written by Hamilton from the exhibits below; {written.figureCheck.checked.toLocaleString("en-US")} figures checked against them.
            </p>
          </div>
        ) : memo?.state === "writing" ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-warm-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Hamilton is writing this up. It takes up to a minute; the exhibits below are ready now.
          </p>
        ) : memo?.state === "none" ? (
          <p className="mt-3 text-xs text-warm-600">{memo.reason}</p>
        ) : null}
      </div>

      {figures.length > 0 ? (
        <dl className={`grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-warm-300 bg-warm-300 ${cols}`}>
          {figures.map((f) => (
            <div key={f.label} className="flex flex-col bg-white px-5 py-4">
              <dd
                className={`${f.value.length > 8 ? "text-2xl" : "text-3xl"} text-warm-900 [font-variant-numeric:tabular-nums]`}
                style={SERIF}
              >
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
          finance={
            <div className="flex flex-col gap-4">
              {written?.board ? <MemoNote text={written.board} /> : null}
              <LensList facts={story.lenses.finance} empty="Nothing on file for the board view yet." />
            </div>
          }
          market={
            <div className="flex flex-col gap-4">
              {written?.market ? <MemoNote text={written.market} /> : null}
              <LensList facts={story.lenses.market} empty="Nothing on file for the market view yet." />
            </div>
          }
        />
      </section>

      {written && written.questions.length > 0 ? (
        <section>
          <Kicker>Before deciding</Kicker>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-relaxed text-warm-800 marker:text-terra-text">
            {written.questions.map((q, i) => (
              <li key={i}>{withFiguresBold(q)}</li>
            ))}
          </ol>
        </section>
      ) : null}

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
                  {o.consequences.map((c, i, all) => (
                    <li key={i}>
                      <Line fact={c} showSource={sourceShownAt(all)[i]} />
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
