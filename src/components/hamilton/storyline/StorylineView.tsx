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
import { ANSWER_TYPE, AnswerLead, InterpretationBox, KeyFigures, SERIF, SectionHeading } from "@/components/hamilton/memo/memo";
import { sourceDateWithAge } from "@/components/hamilton/memo/exhibit-view";
import { LensSwitch } from "./LensSwitch";
import { StoryExhibitView } from "./story-exhibits";
import { OptionLetter, OptionScaleChart, OptionStanding, optionPoints, optionScale } from "./option-compare";
import type { StorylineMemo } from "@/lib/hamilton/workspace/storyline-types";
import type { HamiltonIdentitySnapshot } from "@/lib/hamilton/account-context";
import { splitIntoSentences } from "@/lib/hamilton/citation-gate";
import type { Storyline } from "./types";
import { DatasetNote } from "@/components/hamilton/DatasetNote";
import type { StampedFigure } from "@/lib/dataset-note";
import { blockAnchor, blockTitle } from "@/lib/hamilton/workspace/workbench";
import type { OwnFeeRow } from "@/lib/hamilton/workspace/types";
import { DashboardCard, KpiCard } from "@/components/hamilton/dashboard";
import { EvidencePanel, type EvidenceSource } from "@/components/hamilton/analyze/EvidencePanel";
import { ExhibitTabs } from "./ExhibitTabs";

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

/** The storyline's section headings are the shared answer heading. */
const Kicker = SectionHeading;

function FactList({ facts, notes, empty }: { facts: Fact[]; notes: SourceNotes; empty?: string }) {
  if (facts.length === 0) return empty ? <p className="text-sm text-warm-600">{empty}</p> : null;
  return (
    <ul className="flex max-w-[65ch] flex-col gap-2">
      {facts.map((f, i) => (
        <li key={i} className={`grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2 ${ANSWER_TYPE.body} text-warm-800`}>
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

function SourceList({ notes }: { notes: SourceNotes }) {
  if (notes.list.length === 0) return null;
  return (
    <section id={blockAnchor("evidence")} className="border-t border-warm-300 pt-6">
      <Kicker>{blockTitle("evidence")}</Kicker>
      <p className="mb-2 text-sm text-warm-700">The sources behind each numbered note above.</p>
      <ol className="grid gap-x-6 gap-y-1 text-[13px] leading-snug text-warm-600 sm:grid-cols-2">
        {notes.list.map((s, i) => {
          // One sample size reads as n=; several different ones would only clutter the note.
          const detail = [sourceDateWithAge(s.asOf), s.n.length === 1 ? `n=${s.n[0].toLocaleString("en-US")}` : null]
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

/** Drops the memo sentences that are Hamilton's reading only; they are shown under their own label. */
function withoutInterpretation(text: string, reading: ReadonlySet<string>): string {
  if (reading.size === 0) return text;
  return splitIntoSentences(text).map((s) => s.text).filter((t) => !reading.has(t.trim())).join(" ");
}

/**
 * Every answer reads in the same blocks (#1895): Summary, Key figures, Charts, Evidence,
 * Limitations and Next steps; the page shows the context the answer used above them. Hamilton's commentary,
 * the two readings, and the options sit between the charts and the evidence they rest on.
 */
export function StorylineView(props: StorylineViewProps) {
  if (props.layout === "dashboard") return <StorylineDashboard {...props} />;
  return <StorylineMemoView {...props} />;
}

export interface StorylineViewProps {
  story: Storyline;
  nextSteps?: ReactNode;
  limitations?: readonly string[];
  memo?: MemoState;
  identityContext?: HamiltonIdentitySnapshot | null;
  stamps?: readonly StampedFigure[] | null;
  /**
   * "memo" (default) reads top to bottom; "dashboard" (Ask, Nov 2026) sets the same blocks as
   * cards: the summary with stat tiles, the exhibits under tabs, the actions, and the numbered
   * sources in an evidence panel beside the answer.
   */
  layout?: "memo" | "dashboard";
  /** Published fee rows the answer quotes, with where each is printed; listed as sources too. */
  ownRows?: { institutionName: string; rows: readonly OwnFeeRow[] } | null;
}

function StorylineMemoView({ story, nextSteps, memo, identityContext, stamps, limitations = [] }: {
  story: Storyline;
  nextSteps?: ReactNode;
  /** The method's assumptions and limits, shown with what would change the conclusion. */
  limitations?: readonly string[];
  memo?: MemoState;
  identityContext?: HamiltonIdentitySnapshot | null;
  /** The stamps of the reads behind the figures (#1924): the answer's own, or a saved answer's as saved. */
  stamps?: readonly StampedFigure[] | null;
}) {
  const memoWritten = memo?.state === "written" ? memo.memo : null;
  const reading = memoWritten?.narrativeBinding?.interpretation ?? [];
  const readingSet = new Set(reading.map((t) => t.trim()));
  const written = memoWritten
    ? {
        ...memoWritten,
        summary: withoutInterpretation(memoWritten.summary, readingSet),
        board: withoutInterpretation(memoWritten.board, readingSet),
        market: withoutInterpretation(memoWritten.market, readingSet),
      }
    : null;
  const notes = buildSourceNotes(story);
  const figures = story.keyFigures.slice(0, 4);
  return (
    <article className="flex flex-col gap-10 [&_.rd-exhibit]:mt-0">
      <AnswerLead
        after={
          memo?.state === "writing" ? (
            <p role="status" className="mt-3 flex items-center gap-2 text-sm text-warm-600">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Hamilton is writing this up. It takes up to a minute; the exhibits below are ready now.
            </p>
          ) : memo?.state === "none" ? (
            <p className="mt-3 text-xs text-warm-600">{memo.reason}</p>
          ) : null
        }
      >
        {story.governingThought}
      </AnswerLead>

      {figures.length > 0 || (stamps && stamps.length > 0) ? (
        <section aria-labelledby={blockAnchor("key_figures")} className="flex flex-col gap-3">
          <h3 id={blockAnchor("key_figures")} className={ANSWER_TYPE.kicker}>{blockTitle("key_figures")}</h3>
          <KeyFigures
            figures={figures.map((f) => ({
              value: f.value,
              title: f.label,
              label: (
                <>
                  {f.label}
                  <Note n={notes.noteFor(f.source)} />
                </>
              ),
            }))}
          />
          {/* Where the medians and counts came from (#1924); nothing without a stamp. */}
          <DatasetNote figures={stamps ?? []} />
        </section>
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

      {story.exhibits.length > 0 ? (
        <section aria-labelledby={blockAnchor("charts")} className="flex flex-col gap-10 border-t border-warm-300 pt-6">
          <h3 id={blockAnchor("charts")} className={ANSWER_TYPE.kicker}>{blockTitle("charts")}</h3>
          {story.exhibits.map((item, i) => (
            <StoryExhibitView key={item.id} item={item} number={item.number ?? i + 1} researchInstitutionName={identityContext?.researchInstitutionName} />
          ))}
        </section>
      ) : null}

      {/* The figures and exhibits lead; Hamilton's written reading of them follows. */}
      {written ? (
        <section className="flex flex-col gap-1.5 border-t border-warm-300 pt-6">
          <Kicker>Hamilton&apos;s commentary</Kicker>
          {written.summary ? <MemoNote text={written.summary} size="lead" /> : null}
          {reading.length > 0 ? (
            <div className="mt-3">
              <InterpretationBox sentences={reading} />
            </div>
          ) : null}
          <p className="text-xs text-warm-600">
            {reading.length > 0
              ? `Written by Hamilton from the exhibits above. ${written.figureCheck.checked.toLocaleString("en-US")} figures checked against them; the sentences under Hamilton's reading are not.`
              : `Written by Hamilton from the exhibits above; ${written.figureCheck.checked.toLocaleString("en-US")} figures checked against them.`}
          </p>
        </section>
      ) : null}

      {/* A list answer carries no readings (#2033). */}
      {story.kind === "list" ? null : <section className="border-t border-warm-300 pt-6">
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
      </section>}

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

      <SourceList notes={notes} />

      {story.watch.length > 0 || limitations.length > 0 ? (
        <section id={blockAnchor("limitations")} className="flex scroll-mt-24 flex-col gap-4 border-t border-warm-300 pt-6">
          <Kicker>{blockTitle("limitations")}</Kicker>
          {story.watch.length > 0 ? (
            <div>
              <h4 className="mb-2 text-sm font-medium text-warm-700">What would change this</h4>
              <FactList facts={story.watch} notes={notes} />
            </div>
          ) : null}
          {limitations.length > 0 ? (
            <div>
              <h4 className="mb-2 text-sm font-medium text-warm-700">Method and assumptions</h4>
              <ul className="flex max-w-[65ch] list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-warm-800">
                {limitations.slice(0, 3).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {/* The first three carry the peer rule; the rest stay one click away. */}
              {limitations.length > 3 ? (
                <details className="mt-2 max-w-[65ch] text-sm text-warm-800">
                  <summary className="cursor-pointer text-sm font-medium text-terra-text">Show all {limitations.length} assumptions</summary>
                  <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
                    {limitations.slice(3).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {nextSteps ? (
        <section aria-labelledby={blockAnchor("next_steps")} className="border-t border-warm-300 pt-6">
          <h3 id={blockAnchor("next_steps")} className={`mb-3 ${ANSWER_TYPE.section}`} style={SERIF}>{blockTitle("next_steps")}</h3>
          <div className="flex flex-wrap gap-2">{nextSteps}</div>
        </section>
      ) : null}
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

/** "$35", "$2.49": a published row's amount as the answer prints fees. */
function rowAmount(amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  return Number.isInteger(amount) ? `$${amount.toLocaleString("en-US")}` : `$${amount.toFixed(2)}`;
}

/** The answer's sources, numbered as its notes are, plus the published fee rows it quotes. */
export function storyEvidence(notes: SourceNotes, ownRows?: StorylineViewProps["ownRows"]): EvidenceSource[] {
  const listed: EvidenceSource[] = notes.list.map((s, i) => ({
    n: i + 1,
    label: s.label,
    details: [
      sourceDateWithAge(s.asOf),
      s.n.length === 1 ? `${s.n[0].toLocaleString("en-US")} institutions behind the figure` : null,
    ].filter((line): line is string => Boolean(line)),
    url: s.url ?? null,
  }));
  for (const row of ownRows?.rows ?? []) {
    const published = row.publishedAt ? sourceDateWithAge(row.publishedAt.slice(0, 10)) : null;
    listed.push({
      n: listed.length + 1,
      label: `${ownRows!.institutionName}: ${row.feeName}`,
      amount: rowAmount(row.amount),
      details: [published ? `Published ${published}` : "Publish date not recorded"],
      location: row.sourceLocation ?? null,
      url: row.documentUrl ?? row.sourceUrl ?? null,
    });
  }
  return listed;
}

/** The storyline as dashboard cards (Ask.dc.html): the same words and figures as the memo. */
function StorylineDashboard({ story, nextSteps, memo, identityContext, stamps, limitations = [], ownRows }: StorylineViewProps) {
  const memoWritten = memo?.state === "written" ? memo.memo : null;
  const reading = memoWritten?.narrativeBinding?.interpretation ?? [];
  const readingSet = new Set(reading.map((t) => t.trim()));
  const written = memoWritten
    ? {
        ...memoWritten,
        summary: withoutInterpretation(memoWritten.summary, readingSet),
        board: withoutInterpretation(memoWritten.board, readingSet),
        market: withoutInterpretation(memoWritten.market, readingSet),
      }
    : null;
  const notes = buildSourceNotes(story);
  const figures = story.keyFigures.slice(0, 4);
  const sources = storyEvidence(notes, ownRows);
  return (
    <div className="ha-answer">
      <div className="ha-main">
        <section className="hd-card" aria-labelledby={blockAnchor("summary")}>
          <h2 id={blockAnchor("summary")} className="hd-label" style={{ margin: 0 }}>{blockTitle("summary")}</h2>
          <div className="ha-lead-row">
            <span className="ha-lead-mark" aria-hidden="true">H</span>
            <p className="ha-lead">{story.governingThought}</p>
          </div>
          {memo?.state === "writing" ? (
            <p role="status" className="flex items-center gap-2 text-sm text-warm-600">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Hamilton is writing this up. It takes up to a minute; the charts are ready now.
            </p>
          ) : memo?.state === "none" ? (
            <p className="hd-card-note">{memo.reason}</p>
          ) : null}
          {figures.length > 0 ? (
            <>
              <h3 id={blockAnchor("key_figures")} className="hd-label" style={{ margin: 0 }}>{blockTitle("key_figures")}</h3>
              <div className="ha-tiles">
                {figures.map((f) => (
                  <KpiCard
                    key={f.label}
                    label={f.label}
                    value={f.value}
                    sub={`Source ${notes.noteFor(f.source)}${f.n ? ` · ${f.n.toLocaleString("en-US")} institutions` : ""}`}
                  />
                ))}
              </div>
            </>
          ) : null}
          <DatasetNote figures={stamps ?? []} />
        </section>

        {story.exhibits.length > 0 || nextSteps ? (
          <section className="hd-card" aria-labelledby={story.exhibits.length > 0 ? blockAnchor("charts") : blockAnchor("next_steps")}>
            {story.exhibits.length > 0 ? (
              <>
                <h2 id={blockAnchor("charts")} className="hd-label" style={{ margin: 0 }}>{blockTitle("charts")}</h2>
                <ExhibitTabs items={story.exhibits} researchInstitutionName={identityContext?.researchInstitutionName} />
              </>
            ) : null}
            {nextSteps ? (
              <div>
                <h3 id={blockAnchor("next_steps")} className="hd-label" style={{ margin: "4px 0 8px" }}>{blockTitle("next_steps")}</h3>
                {nextSteps}
              </div>
            ) : null}
          </section>
        ) : null}

        {story.situation.length > 0 || story.complication.length > 0 ? (
          <section className="hd-card">
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              <div>
                <Kicker>Where things stand</Kicker>
                <FactList facts={story.situation} notes={notes} />
              </div>
              <div>
                <Kicker>What has changed</Kicker>
                <FactList facts={story.complication} notes={notes} empty="Nothing material has moved in the period on file." />
              </div>
            </div>
          </section>
        ) : null}

        {written ? (
          <DashboardCard
            title="Hamilton's commentary"
            footnote="Written by Hamilton from the exhibits above."
            footnoteDetails={reading.length > 0
              ? `${written.figureCheck.checked.toLocaleString("en-US")} figures checked against them; the sentences under Hamilton's reading are not.`
              : `${written.figureCheck.checked.toLocaleString("en-US")} figures checked against them.`}
          >
            {written.summary ? <MemoNote text={written.summary} size="lead" /> : null}
            {reading.length > 0 ? <InterpretationBox sentences={reading} /> : null}
          </DashboardCard>
        ) : null}

        {story.kind === "list" ? null : (
          <DashboardCard title="What it means for you">
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
          </DashboardCard>
        )}

        {written && written.questions.length > 0 ? (
          <DashboardCard title="Before deciding">
            <ol className="flex max-w-[65ch] list-decimal flex-col gap-2 pl-5 text-base leading-relaxed text-warm-800 marker:font-semibold marker:text-terra-text">
              {written.questions.map((q, i) => <li key={i}>{withFiguresBold(q)}</li>)}
            </ol>
          </DashboardCard>
        ) : null}

        {story.options && story.options.length > 0 ? (
          <DashboardCard title="Options and what each would mean" footnote="Hamilton sets out the options; the choice is your team's.">
            <OptionsSideBySide story={story} notes={notes} researchInstitutionName={identityContext?.researchInstitutionName} />
          </DashboardCard>
        ) : null}

        {story.watch.length > 0 || limitations.length > 0 ? (
          <section id={blockAnchor("limitations")} className="hd-card scroll-mt-24" aria-labelledby={`${blockAnchor("limitations")}-h`}>
            <h2 id={`${blockAnchor("limitations")}-h`} className="hd-label" style={{ margin: 0 }}>{blockTitle("limitations")}</h2>
            {story.watch.length > 0 ? (
              <>
                <h3 className="hd-card-title">What would change this</h3>
                <ul className="ha-changes">
                  {story.watch.map((f, i) => <li key={i}><span><Line fact={f} notes={notes} /></span></li>)}
                </ul>
              </>
            ) : null}
            {limitations.length > 0 ? (
              <details className="hd-more">
                <summary>About these figures: method and {limitations.length} assumptions</summary>
                <ul className="mt-1 flex max-w-[65ch] list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-warm-800">
                  {limitations.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}
      </div>
      <div id={blockAnchor("evidence")} className="scroll-mt-24">
        <EvidencePanel sources={sources} title={blockTitle("evidence")} intro="The sources behind each numbered note." />
      </div>
    </div>
  );
}
