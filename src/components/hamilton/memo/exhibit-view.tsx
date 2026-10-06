/**
 * Draws the Hamilton engine's answer the same way on every screen: the headline, the Consultant's
 * sourced claims, the Economist's drivers, the one exhibit and the one clarifying question.
 * The engine returns data only (`HamiltonAnswer`, `Exhibit`); every chart decision lives here.
 */
import type { ReactNode } from "react";
import { Callout, QuestionCard, SERIF, fmtMoney, labelRows } from "./memo";

// Mirrors engine 1.4.0 (src/lib/hamilton/workspace/types.ts, PR 238). Import from there once it merges.
interface SourceRef {
  label: string;
  url?: string | null;
  asOf?: string | null;
}
interface Fact {
  text: string;
  source: SourceRef;
  sampleSize?: number;
}
interface ExhibitMarker {
  label: string;
  scope: string;
  value: number;
  n: number;
}
export type ExhibitSpec =
  | {
      kind: "fee_position";
      title: string;
      unit: "dollars";
      own: number | null;
      ownLabel: string;
      band: { label: string; p25: number; median: number; p75: number; n: number };
      markers: ExhibitMarker[];
      sources: SourceRef[];
      note?: string;
    }
  | {
      kind: "trend";
      title: string;
      unit: "dollars" | "percent";
      series: { label: string; points: { date: string; value: number }[] }[];
      sources: SourceRef[];
      note?: string;
    }
  | {
      kind: "competitor_range";
      title: string;
      unit: "dollars";
      own: number | null;
      ownLabel: string;
      items: { name: string; amount: number; url: string | null }[];
      sources: SourceRef[];
      note?: string;
    };
export interface AnswerSpec {
  feeCategory: string;
  headline: string;
  claims: Fact[];
  drivers: Fact[];
  exhibit: ExhibitSpec | null;
  question: { prompt: string; inputKind: "number" | "percent" | "file" | "text"; fieldKey: string } | null;
  evidenceLevel: "market" | "working_estimate" | "institution";
}

export const EVIDENCE_LABELS: Record<AnswerSpec["evidenceLevel"], string> = {
  market: "Market data only",
  working_estimate: "Working estimate from your filings",
  institution: "Your own figures",
};

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** A source as the reader sees it: name, date and, for a market figure, how many institutions. */
export function SourceChip({ source, n }: { source: SourceRef; n?: number }) {
  const date = shortDate(source.asOf);
  const text = [source.label, date, n != null ? `n=${n.toLocaleString("en-US")}` : null].filter(Boolean).join(" · ");
  const cls = "inline-block rounded border border-warm-200 bg-white px-1.5 py-0.5 text-[11px] leading-tight text-warm-600";
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer" className={`${cls} hover:border-terra hover:text-terra-text`}>
      {text}
    </a>
  ) : (
    <span className={cls}>{text}</span>
  );
}

function sourceLine(sources: readonly SourceRef[]): ReactNode {
  return sources.map((s, i) => (
    <span key={`${s.label}-${i}`}>
      {i > 0 ? "; " : ""}
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-warm-300 hover:text-terra-text">
          {s.label}
        </a>
      ) : (
        s.label
      )}
      {s.asOf ? `, ${shortDate(s.asOf)}` : ""}
    </span>
  ));
}

function ExhibitFrame({ title, sources, note, children }: { title: string; sources: readonly SourceRef[]; note?: string; children: ReactNode }) {
  return (
    <figure className="rounded-lg border border-warm-300 bg-warm-50 p-5 break-inside-avoid">
      <figcaption className="mb-4 text-base text-warm-900" style={SERIF}>
        {title}
      </figcaption>
      {children}
      {note ? <p className="mt-3 text-xs leading-relaxed text-warm-700">{note}</p> : null}
      {sources.length > 0 ? <p className="mt-3 border-t border-warm-200 pt-2 text-xs text-warm-600">Source: {sourceLine(sources)}</p> : null}
    </figure>
  );
}

/** One axis for a set of dollar values, padded so the ends never sit on the edge. */
export function axisFor(values: readonly number[]): { lo: number; hi: number; at: (v: number) => number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, 1);
  const lo = Math.max(0, Math.floor(min - pad));
  const hi = Math.ceil(max + pad);
  return { lo, hi, at: (v) => ((v - lo) / (hi - lo || 1)) * 100 };
}

function FeePosition({ x }: { x: Extract<ExhibitSpec, { kind: "fee_position" }> }) {
  const values = [x.band.p25, x.band.p75, x.band.median, ...x.markers.map((m) => m.value), ...(x.own != null ? [x.own] : [])];
  const axis = axisFor(values);
  const markers = [...x.markers].sort((a, b) => a.value - b.value);
  const rows = labelRows(markers.map((m) => axis.at(m.value)), 16);
  const rowCount = Math.max(1, ...rows.map((r) => r + 1));
  return (
    <div>
      <div className="relative" style={{ height: `${3.5 + rowCount * 1.6}rem` }}>
        {x.own != null ? (
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-terra-text [font-variant-numeric:tabular-nums]"
            style={{ left: `${axis.at(x.own)}%` }}
          >
            {x.ownLabel} {fmtMoney(x.own)}
          </span>
        ) : null}
        <span className="absolute inset-x-0 top-8 h-2 rounded-full bg-warm-200" />
        <span
          className="absolute top-7 h-4 rounded bg-terra/25 ring-1 ring-terra/40"
          style={{ left: `${axis.at(x.band.p25)}%`, width: `${axis.at(x.band.p75) - axis.at(x.band.p25)}%` }}
          title={`${x.band.label}, middle half: ${fmtMoney(x.band.p25)} to ${fmtMoney(x.band.p75)}`}
        />
        <span className="absolute top-6 h-6 w-0.5 -translate-x-1/2 bg-warm-800" style={{ left: `${axis.at(x.band.median)}%` }} title={`${x.band.label} median ${fmtMoney(x.band.median)}`} />
        {markers.map((m, i) => (
          <span key={`${m.scope}-${m.label}`}>
            <span className="absolute top-[2.4rem] h-3 w-px -translate-x-1/2 bg-warm-600" style={{ left: `${axis.at(m.value)}%` }} />
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-warm-700 [font-variant-numeric:tabular-nums]"
              style={{ left: `${axis.at(m.value)}%`, top: `${3.3 + rows[i] * 1.6}rem` }}
            >
              {m.label} {fmtMoney(m.value)}
            </span>
          </span>
        ))}
        {x.own != null ? (
          <span
            className="absolute top-[1.65rem] h-5 w-5 -translate-x-1/2 rounded-full border-[3px] border-white bg-terra shadow"
            style={{ left: `${axis.at(x.own)}%` }}
            title={`${x.ownLabel} ${fmtMoney(x.own)}`}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-[11px] text-warm-600 [font-variant-numeric:tabular-nums]">
        <span>{fmtMoney(axis.lo)}</span>
        <span>{fmtMoney(axis.hi)}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-warm-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm bg-terra/25 ring-1 ring-terra/40" />
          {x.band.label}, middle half: {fmtMoney(x.band.p25)} to {fmtMoney(x.band.p75)} ({x.band.n} institutions)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-warm-800" />
          Median {fmtMoney(x.band.median)}
        </span>
        {x.own != null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-terra" />
            {x.ownLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CompetitorRange({ x }: { x: Extract<ExhibitSpec, { kind: "competitor_range" }> }) {
  const axis = axisFor([...x.items.map((i) => i.amount), ...(x.own != null ? [x.own] : [])]);
  return (
    <div className="flex flex-col gap-1">
      {x.items.map((item) => (
        <div key={item.name} className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-3 text-sm">
          <span className="truncate text-warm-800" title={item.name}>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-terra-text hover:underline">
                {item.name}
              </a>
            ) : (
              item.name
            )}
          </span>
          <span className="relative h-5">
            <span className="absolute inset-x-0 top-1/2 h-px bg-warm-200" />
            {x.own != null ? <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-terra/70" style={{ left: `${axis.at(x.own)}%` }} /> : null}
            <span
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${x.own != null && item.amount > x.own ? "bg-warm-800" : x.own != null && item.amount < x.own ? "bg-warm-500" : "bg-terra"}`}
              style={{ left: `${axis.at(item.amount)}%` }}
            />
          </span>
          <span className="text-right text-warm-900 [font-variant-numeric:tabular-nums]">{fmtMoney(item.amount)}</span>
        </div>
      ))}
      <div className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] gap-3 text-[11px] text-warm-600 [font-variant-numeric:tabular-nums]">
        <span />
        <span className="flex justify-between">
          <span>{fmtMoney(axis.lo)}</span>
          <span>{fmtMoney(axis.hi)}</span>
        </span>
        <span />
      </div>
      {x.own != null ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-warm-700">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-terra/70" />
            {x.ownLabel}: {fmtMoney(x.own)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-warm-500" />
            Charges less
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-warm-800" />
            Charges more
          </span>
        </p>
      ) : null}
    </div>
  );
}

function fmtTrendValue(v: number, unit: "dollars" | "percent"): string {
  if (unit === "percent") return `${v.toFixed(1)}%`;
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

function Trend({ x }: { x: Extract<ExhibitSpec, { kind: "trend" }> }) {
  const W = 600;
  const H = 190;
  const pad = { l: 8, r: 64, t: 12, b: 24 };
  const dates = [...new Set(x.series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const vals = x.series.flatMap((s) => s.points.map((p) => p.value));
  if (dates.length < 2 || vals.length === 0) return <p className="text-sm text-warm-700">Not enough points on file to draw a trend.</p>;
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals) * 1.08 || 1;
  const px = (d: string) => pad.l + (dates.indexOf(d) / (dates.length - 1)) * (W - pad.l - pad.r);
  const py = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const strokes = ["var(--color-terra, #C44B2E)", "#6b6255", "#a39a8c"];
  const label = (d: string) => shortDate(d) ?? d;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label={x.title}>
        {[0, 0.5, 1].map((f) => {
          const v = lo + (hi - lo) * f;
          return (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={py(v)} y2={py(v)} stroke="#e8dfd1" />
              <text x={W - pad.r + 6} y={py(v) + 4} fontSize="11" fill="#8a8073">
                {fmtTrendValue(v, x.unit)}
              </text>
            </g>
          );
        })}
        {x.series.map((s, i) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={strokes[i % strokes.length]}
            strokeWidth={i === 0 ? 2.5 : 1.75}
            strokeDasharray={i === 0 ? undefined : "5 4"}
            points={s.points.map((p) => `${px(p.date)},${py(p.value)}`).join(" ")}
          />
        ))}
        <text x={pad.l} y={H - 6} fontSize="11" fill="#8a8073">
          {label(dates[0])}
        </text>
        <text x={W - pad.r} y={H - 6} fontSize="11" fill="#8a8073" textAnchor="end">
          {label(dates[dates.length - 1])}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-warm-700">
        {x.series.map((s, i) => {
          const last = s.points[s.points.length - 1];
          return (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-5" style={{ background: strokes[i % strokes.length] }} />
              {s.label}
              {last ? <span className="text-warm-900 [font-variant-numeric:tabular-nums]">{fmtTrendValue(last.value, x.unit)}</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The engine's one exhibit, drawn the same on Research, Model, Reports and Ask. */
export function ExhibitView({ exhibit }: { exhibit: ExhibitSpec }) {
  return (
    <ExhibitFrame title={exhibit.title} sources={exhibit.sources} note={exhibit.note}>
      {exhibit.kind === "fee_position" ? (
        <FeePosition x={exhibit} />
      ) : exhibit.kind === "competitor_range" ? (
        exhibit.items.length > 0 ? (
          <CompetitorRange x={exhibit} />
        ) : (
          <p className="text-sm text-warm-700">No named competitor publishes this fee yet.</p>
        )
      ) : (
        <Trend x={exhibit} />
      )}
    </ExhibitFrame>
  );
}

function FactList({ facts }: { facts: readonly Fact[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {facts.map((f, i) => (
        <li key={i} className="text-[15px] leading-relaxed text-warm-800">
          {f.text} <SourceChip source={f.source} n={f.sampleSize} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One Hamilton answer in the four roles: the Writer's headline, the Consultant's claims, the
 * Economist's drivers and question, and the Data Engineer's exhibit, with its evidence level.
 */
export function AnswerView({
  answer,
  questionAction,
  questionKeep = {},
}: {
  answer: AnswerSpec;
  /** Where the question card submits; omit to show the question without a form. */
  questionAction?: string;
  questionKeep?: Record<string, string | null | undefined>;
}) {
  const q = answer.question;
  return (
    <article className="flex flex-col gap-5">
      <p className="text-xl leading-snug text-warm-900 sm:text-2xl" style={SERIF}>
        {answer.headline}
      </p>
      {answer.claims.length > 0 ? <FactList facts={answer.claims} /> : null}
      {answer.exhibit ? <ExhibitView exhibit={answer.exhibit} /> : null}
      {answer.drivers.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">What moves this</h3>
          <FactList facts={answer.drivers} />
        </section>
      ) : null}
      {q && q.inputKind !== "file" ? (
        questionAction ? (
          <QuestionCard
            prompt={q.prompt}
            why="Hamilton keeps your answer with your institution's figures and uses it from then on."
            name={q.fieldKey}
            inputKind={q.inputKind}
            action={questionAction}
            keep={questionKeep}
          />
        ) : (
          <Callout>
            <span className="font-medium text-warm-900">Hamilton has one question: </span>
            {q.prompt}
          </Callout>
        )
      ) : null}
      <p className="text-xs text-warm-600">
        Evidence: <span className="font-medium text-warm-800">{EVIDENCE_LABELS[answer.evidenceLevel]}</span>
      </p>
    </article>
  );
}
