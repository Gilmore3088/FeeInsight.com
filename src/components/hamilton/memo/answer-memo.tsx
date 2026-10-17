/**
 * An Ask answer laid out as a consulting memo, not a copy of My fees: the governing thought,
 * the three figures that carry it, the exhibit under a title that states its point, numbered
 * takeaways with their numbers set in bold, what would change the picture, and where to go next.
 * Same engine data as AnswerView; only the layout differs.
 */
import type { ReactNode } from "react";
import type { Exhibit, Fact } from "@/lib/hamilton/workspace/types";
import { ANSWER_EVIDENCE_LABELS, ExhibitView, SourceChip, type AnswerSpec } from "./exhibit-view";
import { ANSWER_TYPE, AnswerLead, KeyFigures, More, SectionHeading, fmtMoney } from "./memo";

export interface KeyFigure {
  value: string;
  label: string;
}

/** The figures an exhibit carries, read from its data rather than from prose. */
export function keyFiguresFor(exhibit: Exhibit | null): KeyFigure[] {
  if (!exhibit) return [];
  if (exhibit.kind === "fee_position") {
    const { band } = exhibit;
    const out: KeyFigure[] = [];
    if (exhibit.own != null) out.push({ value: fmtMoney(exhibit.own), label: exhibit.ownLabel });
    out.push({ value: fmtMoney(band.median), label: `Median, ${band.label} (n=${band.n.toLocaleString("en-US")})` });
    out.push({ value: `${fmtMoney(band.p25)} to ${fmtMoney(band.p75)}`, label: "Middle half of the market" });
    return out;
  }
  if (exhibit.kind === "competitor_range") {
    if (exhibit.items.length === 0) return [];
    const amounts = exhibit.items.map((i) => i.amount);
    const lo = Math.min(...amounts);
    const hi = Math.max(...amounts);
    const out: KeyFigure[] = [];
    if (exhibit.own != null) out.push({ value: fmtMoney(exhibit.own), label: exhibit.ownLabel });
    out.push({ value: `${fmtMoney(lo)} to ${fmtMoney(hi)}`, label: `Range across ${exhibit.items.length} named institutions` });
    if (exhibit.own != null) {
      const own = exhibit.own;
      const less = amounts.filter((a) => a < own - 0.005).length;
      out.push({ value: `${less} of ${amounts.length}`, label: `Charge less than ${exhibit.ownLabel}` });
    }
    return out;
  }
  if (exhibit.kind !== "trend") return [];
  const series = exhibit.series[0];
  if (!series || series.points.length === 0) return [];
  const fmt = (v: number) => (exhibit.unit === "percent" ? `${v.toFixed(1)}%` : fmtMoney(v));
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const out: KeyFigure[] = [{ value: fmt(last.value), label: `${series.label}, latest` }];
  if (series.points.length > 1 && first.value !== 0) {
    const pct = ((last.value - first.value) / Math.abs(first.value)) * 100;
    out.push({ value: `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`, label: `Change since ${first.date.slice(0, 7)}` });
  }
  return out;
}

// "$10B+" and "$209 thousand" stay whole, so a size or amount is never half bold.
const NUMBER_TOKEN = /(\$[\d,]+(?:\.\d+)?(?:[KMBT]\+?|\+| (?:thousand|million|billion|trillion)\b)?|\d+(?:\.\d+)?%|\d[\d,]* of \d[\d,]*)/g;

/** A sentence with its figures set in bold, so a skim reads the numbers. */
export function withFiguresBold(text: string): ReactNode[] {
  return text.split(NUMBER_TOKEN).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-warm-900">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

function Takeaways({ facts, start = 1 }: { facts: readonly Fact[]; start?: number }) {
  return (
    <ol className="flex flex-col divide-y divide-warm-200 border-y border-warm-200">
      {facts.map((f, i) => (
        <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-3">
          <span className={`text-sm font-semibold text-terra-text ${ANSWER_TYPE.num}`}>{String(i + start).padStart(2, "0")}</span>
          <span className={`${ANSWER_TYPE.body} text-warm-800`}>
            {withFiguresBold(f.text)} <SourceChip source={f.source} n={f.sampleSize} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function DriverCards({ facts }: { facts: readonly Fact[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {facts.map((d, i) => (
        <li key={i} className={`rounded-lg border border-warm-300 bg-warm-50 p-4 ${ANSWER_TYPE.body} text-warm-800`}>
          {withFiguresBold(d.text)}
          <span className="mt-2 block">
            <SourceChip source={d.source} n={d.sampleSize} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AnswerMemo({ answer, nextSteps }: { answer: AnswerSpec; nextSteps?: ReactNode }) {
  const figures = keyFiguresFor(answer.exhibit);
  const lead = answer.claims.slice(0, 3);
  const rest = answer.claims.slice(3);
  return (
    <article className="flex flex-col gap-7">
      <AnswerLead>{answer.headline}</AnswerLead>

      <KeyFigures figures={figures.map((f) => ({ value: f.value, label: f.label, title: f.label }))} />

      {answer.exhibit ? <ExhibitView exhibit={answer.exhibit} number={1} /> : null}

      {lead.length > 0 ? (
        <section>
          <SectionHeading>What the data says</SectionHeading>
          <Takeaways facts={lead} />
          {rest.length > 0 ? (
            <div className="mt-3">
              <More label={`${rest.length} more ${rest.length === 1 ? "finding" : "findings"}`}>
                <Takeaways facts={rest} start={lead.length + 1} />
              </More>
            </div>
          ) : null}
        </section>
      ) : null}

      {answer.drivers.length > 0 ? (
        <section>
          <SectionHeading>What would change the picture</SectionHeading>
          <DriverCards facts={answer.drivers.slice(0, 2)} />
          {answer.drivers.length > 2 ? (
            <div className="mt-3">
              <More label={`${answer.drivers.length - 2} more`}>
                <DriverCards facts={answer.drivers.slice(2)} />
              </More>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-warm-200 pt-4">
        <p className={ANSWER_TYPE.caption}>
          Evidence: <span className="font-medium text-warm-800">{ANSWER_EVIDENCE_LABELS[answer.evidenceLevel]}</span>
        </p>
        {nextSteps ? <div className="flex flex-wrap gap-2">{nextSteps}</div> : null}
      </div>
    </article>
  );
}
