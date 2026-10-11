/**
 * A Hamilton answer told as a consulting storyline: the governing thought, the figures that
 * carry it, situation and complication, numbered exhibits under titles that state their point,
 * the board and market readings of the same facts, options with their consequences (never a
 * pick), and what would change the conclusion.
 */
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { Fact, SourceRef } from "@/lib/hamilton/workspace/types";
import { withFiguresBold } from "@/components/hamilton/memo/answer-memo";
import { SERIF } from "@/components/hamilton/memo/memo";
import { LensSwitch } from "./LensSwitch";
import { StoryExhibitView } from "./story-exhibits";
import { OptionLetter, OptionScaleChart, OptionStanding, optionPoints, optionScale } from "./option-compare";
import type { StorylineMemo } from "@/lib/hamilton/workspace/storyline-types";
import type { HamiltonIdentitySnapshot } from "@/lib/hamilton/account-context";
import type { Storyline } from "./types";

/** Hamilton's written memo over the storyline: still being written, written, or not written and why. */
export type MemoState =
  | { state: "writing" }
  | { state: "written"; memo: StorylineMemo }
  | { state: "none"; reason: string };

/**
 * Sources as numbered notes, the way a consulting deck cites them: a small superscript beside
 * each line and one list at the foot of the answer, instead of a source chip on every line.
 */
export interface SourceNotes {
  noteFor: (source: SourceRef) => number;
  list: { label: string; asOf: string | null; url?: string; n: number[] }[];
}

export function buildSourceNotes(story: Storyline): SourceNotes {
  const index = new Map<string, number>();
  const list: SourceNotes["list"] = [];
  const key = (s: SourceRef) => `${s.label}|${s.asOf ?? ""}`;
  const add = (s: SourceRef, n?: number) => {
    let i = index.get(key(s));
    if (i === undefined) {
      i = list.length;
      index.set(key(s), i);
      list.push({ label: s.label, asOf: s.asOf ?? null, url: s.url, n: [] });
    }
    if (n != null && !list[i].n.includes(n)) list[i].n.push(n);
  };
  for (const f of story.keyFigures) add(f.source, f.n);
  const facts = [
    ...story.situation,
    ...story.complication,
    ...story.lenses.finance,
    ...story.lenses.market,
    ...(story.options ?? []).flatMap((o) => o.consequences),
    ...story.watch,
  ];
  for (const f of facts) add(f.source, f.sampleSize);
  return { noteFor: (s) => (index.get(key(s)) ?? 0) + 1, list };
}

function Note({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 text-[10px] font-semibold text-terra-text [font-variant-numeric:tabular-nums]">
      <a href={`#story-source-${n}`} className="no-underline">
        {n}
      </a>
    </sup>
  );
}

function Line({ fact, notes }: { fact: Fact; notes: SourceNotes }) {
  return (
    <>
      {withFiguresBold(fact.text)}
      <Note n={notes.noteFor(fact.source)} />
    </>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 text-xl leading-snug text-warm-900" style={SERIF}>
      {children}
    </h3>
  );
}

function FactList({ facts, notes, empty }: { facts: Fact[]; notes: SourceNotes; empty?: string }) {
  if (facts.length === 0) return empty ? <p className="text-sm text-warm-600">{empty}</p> : null;
  return (
    <ul className="flex max-w-[65ch] flex-col gap-2">
      {facts.map((f, i) => (
        <li key={i} className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2 text-base leading-relaxed text-warm-800">
          <span aria-hidden className="mt-[0.65rem] h-1.5 w-1.5 rounded-full bg-terra" />
          <span>
            <Line fact={f} notes={notes} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Hamilton's written paragraph for a view, set apart from the bullet facts under it. */
function MemoNote({ text, size = "base" }: { text: string; size?: "base" | "lead" }) {
  return (
    <p
      className={`max-w-[62ch] whitespace-pre-line text-warm-800 [font-variant-numeric:tabular-nums] ${size === "lead" ? "text-base leading-relaxed" : "border-l-2 border-warm-300 pl-4 text-base leading-relaxed"}`}
      style={size === "lead" ? SERIF : undefined}
    >
      {withFiguresBold(text)}
    </p>
  );
}

function monthOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function SourceList({ notes }: { notes: SourceNotes }) {
  if (notes.list.length === 0) return null;
  return (
    <section className="border-t border-warm-200 pt-4">
      <h3 className="mb-2 text-sm font-medium text-warm-700">Sources</h3>
      <ol className="grid gap-x-6 gap-y-1 text-[13px] leading-snug text-warm-600 sm:grid-cols-2">
        {notes.list.map((s, i) => {
          // One sample size reads as n=; several different ones would only clutter the note.
          const detail = [monthOf(s.asOf), s.n.length === 1 ? `n=${s.n[0].toLocaleString("en-US")}` : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={i} id={`story-source-${i + 1}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)]">
              <span className="font-semibold text-terra-text [font-variant-numeric:tabular-nums]">{i + 1}</span>
              <span>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-warm-300 hover:text-terra-text">
                    {s.label}
                  </a>
                ) : (
                  s.label
                )}
                {detail ? <span className="text-warm-500"> · {detail}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function StorylineView({ story, nextSteps, memo, identityContext }: { story: Storyline; nextSteps?: ReactNode; memo?: MemoState; identityContext?: HamiltonIdentitySnapshot | null }) {
  const written = memo?.state === "written" ? memo.memo : null;
  const notes = buildSourceNotes(story);
  const figures = story.keyFigures.slice(0, 4);
  const cols = figures.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : figures.length === 3 ? "sm:grid-cols-3" : figures.length === 2 ? "grid-cols-2" : "grid-cols-1";
  return (
    <article className="flex flex-col gap-10 [&_.rd]:mx-0 [&_.rd]:max-w-none [&_.rd-exhibit]:mt-0 [&_.rd-exhibit_h2]:text-xl [&_.rd-exhibit_h2]:leading-snug">
      <div className="border-l-2 border-terra pl-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-terra-text">The answer</p>
        <p className="mt-1 text-[1.375rem] leading-snug text-warm-900 sm:text-2xl" style={SERIF}>
          {story.governingThought}
        </p>
        {written ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <MemoNote text={written.summary} size="lead" />
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
        <dl className={`grid gap-px overflow-hidden rounded-lg border border-warm-300 bg-warm-300 ${cols}`}>
          {figures.map((f) => (
            <div key={f.label} className="flex flex-col bg-white px-5 py-4">
              {/* The label comes first for screen readers; the figure still shows on top. */}
              <dt className="order-2 mt-1 line-clamp-3 text-[13px] leading-snug text-warm-600" title={f.label}>
                {f.label}
                <Note n={notes.noteFor(f.source)} />
              </dt>
              <dd
                className={`order-1 ${f.value.length > 8 ? "text-xl" : "text-2xl"} text-warm-900 [font-variant-numeric:tabular-nums]`}
                style={SERIF}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {story.situation.length > 0 || story.complication.length > 0 ? (
        <div className="grid gap-x-8 gap-y-6 border-t border-warm-300 pt-6 md:grid-cols-2">
          <section>
            <Kicker>Where things stand</Kicker>
            <FactList facts={story.situation} notes={notes} />
          </section>
          <section>
            <Kicker>What has changed</Kicker>
            <FactList facts={story.complication} notes={notes} empty="Nothing material has moved in the period on file." />
          </section>
        </div>
      ) : null}

      {story.exhibits.map((item, i) => (
        <StoryExhibitView key={item.id} item={item} number={item.number ?? i + 1} researchInstitutionName={identityContext?.researchInstitutionName} />
      ))}

      <section className="border-t border-warm-300 pt-6">
        <Kicker>What it means for you</Kicker>
        <LensSwitch
          initial={story.defaultView ?? "finance"}
          finance={
            <div className="flex flex-col gap-4">
              {written?.board ? <MemoNote text={written.board} /> : null}
              <FactList facts={story.lenses.finance} notes={notes} empty="Nothing on file for the board view yet." />
            </div>
          }
          market={
            <div className="flex flex-col gap-4">
              {written?.market ? <MemoNote text={written.market} /> : null}
              <FactList facts={story.lenses.market} notes={notes} empty="Nothing on file for the market view yet." />
            </div>
          }
        />
      </section>

      {written && written.questions.length > 0 ? (
        <section className="border-t border-warm-300 pt-6">
          <Kicker>Before deciding</Kicker>
          <ol className="flex max-w-[65ch] list-decimal flex-col gap-2 pl-5 text-base leading-relaxed text-warm-800 marker:font-semibold marker:text-terra-text">
            {written.questions.map((q, i) => (
              <li key={i}>{withFiguresBold(q)}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {story.options && story.options.length > 0 ? (
        <section className="border-t border-warm-300 pt-6">
          <Kicker>Options and what each would mean</Kicker>
          <OptionsSideBySide story={story} notes={notes} researchInstitutionName={identityContext?.researchInstitutionName} />
          <p className="mt-2 text-[13px] text-warm-600">Hamilton sets out the options; the choice is your team&apos;s.</p>
        </section>
      ) : null}

      {story.watch.length > 0 ? (
        <section className="border-t border-warm-300 pt-6">
          <Kicker>What would change this</Kicker>
          <FactList facts={story.watch} notes={notes} />
        </section>
      ) : null}

      {nextSteps ? <div className="flex flex-wrap gap-2">{nextSteps}</div> : null}

      <SourceList notes={notes} />
    </article>
  );
}

/** The options lettered in the engine's order, priced on one scale, each card saying where it would sit. */
function OptionsSideBySide({ story, notes, researchInstitutionName }: { story: Storyline; notes: SourceNotes; researchInstitutionName?: string | null }) {
  const points = optionPoints(story.options ?? []);
  const scale = optionScale(story);
  return (
    <div className="flex flex-col gap-3">
      <OptionScaleChart points={points} scale={scale} researchInstitutionName={researchInstitutionName} />
      <div className={`grid gap-3 ${points.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        {points.map(({ letter, option, price }) => (
          <div key={option.label} className="flex flex-col gap-3 rounded-lg border border-warm-300 bg-white p-4">
            <div className="flex items-start gap-2">
              <OptionLetter letter={letter} />
              <p className="text-lg leading-snug text-warm-900" style={SERIF}>
                {option.label}
              </p>
            </div>
            <OptionStanding price={price} scale={scale} />
            <ul className="flex flex-col divide-y divide-warm-100 text-sm leading-snug text-warm-800">
              {option.consequences.map((c, i) => (
                <li key={i} className="py-1.5 first:pt-0 last:pb-0">
                  <Line fact={c} notes={notes} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
