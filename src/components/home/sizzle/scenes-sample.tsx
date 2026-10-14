import { AppIcon, Logo } from "@/brand/components";
import { formatFee, type HomeData, type NationalFee } from "../home-data";
import { positionWords, type SampleLine, type SampleStory } from "../sample-story";
import { delay } from "./scene-parts";
import { YouDot } from "./scenes-data";
import styles from "./sizzle.module.css";

/**
 * The sizzle's live scenes, drawn from the public sample report's real institution: its own
 * published fees, the schedule lines that state them, its local market and the report's findings.
 */

function readOn(line: SampleLine): string {
  return line.readOn ? `read ${line.readOn}` : "from its published schedule";
}

/** Scene 3, live: the sample institution's own fees, each with the line of its schedule. */
export function SampleIndexScene({ data, sample }: { data: HomeData; sample: SampleStory }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className={`${styles.in} flex items-baseline justify-between gap-3`}>
        <Logo mark="bank-fee-index-wordmark" height={20} />
        <span className="truncate text-[11px] text-ink-muted">
          {sample.name}, {sample.place}
        </span>
      </div>
      <div className="grid gap-2">
        {sample.lines.map((line, i) => (
          <div key={line.key} className={`${styles.in} rounded-md border border-border bg-paper px-3 py-2`} style={delay(250 + i * 300)}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold text-ink">{line.label}</span>
              <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">{formatFee(line.amount)}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-ink-muted">
              <span className="border-b border-brick">&ldquo;{line.sourceLine}&rdquo;</span> · {readOn(line)}
            </p>
          </div>
        ))}
      </div>
      <p className={`${styles.fade} mt-auto text-[11px] text-ink-muted`} style={delay(1400)}>
        Bank Fee Index · {data.institutionsLabel} institutions · {data.freshnessLabel}
      </p>
    </div>
  );
}

interface Spread {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/** Scene 4, live: the sample's fee in its own market and in the nation, on one dollar axis. */
export function SampleMarketsScene({ sample, nation }: { sample: SampleStory; nation: NationalFee | undefined }) {
  const line = sample.story;
  const spreads: Spread[] = [];
  if (line.market) spreads.push(line.market);
  if (nation) spreads.push(nation);
  const lo = Math.min(line.amount, ...spreads.map((s) => s.min));
  const hi = Math.max(line.amount, ...spreads.map((s) => s.max));
  const pct = (v: number) => 4 + ((v - lo) / (hi - lo || 1)) * 92;
  return (
    <div className="flex h-full flex-col gap-2">
      <span className={`${styles.fade} text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted`}>
        {line.label} · {sample.name}
      </span>
      {line.market ? (
        <SpreadRow label={`Its market · ${line.market.n} institutions`} spread={line.market} pct={pct} you={line.amount} word={positionWords(line.position)} at={200} />
      ) : null}
      {nation ? <SpreadRow label="The nation" spread={nation} pct={pct} you={line.amount} word={`Median ${formatFee(nation.median)}`} at={700} /> : null}
      <div className={`${styles.in} mt-2 grid grid-cols-2 gap-1.5`} style={delay(1300)}>
        {sample.competitors.map((c) => (
          <div key={c.name} className="flex items-baseline justify-between gap-2 rounded-sm border border-border bg-paper px-2 py-1 text-[11px]">
            <span className="truncate text-ink">{c.name}</span>
            <span className="font-mono tabular-nums text-ink">{formatFee(c.amount)}</span>
          </div>
        ))}
      </div>
      <p className={`${styles.fade} mt-auto text-[10px] text-ink-muted`} style={delay(1700)}>
        Named competitors and the market come from the live sample report. State, Fed district and peer group are in Hamilton.
      </p>
    </div>
  );
}

function SpreadRow({ label, spread, pct, you, word, at }: {
  label: string;
  spread: Spread;
  pct: (v: number) => number;
  you: number;
  word: string;
  at: number;
}) {
  return (
    <div className={`${styles.in} grid grid-cols-[minmax(96px,150px)_1fr_minmax(70px,100px)] items-center gap-3 border-b border-border py-2`} style={delay(at)}>
      <span className="text-[12px] text-ink">{label}</span>
      <div className="relative h-5 w-full">
        <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 w-full" aria-hidden="true">
          <line x1={pct(spread.min)} x2={pct(spread.max)} y1={10} y2={10} stroke="var(--fi-control-border)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          <rect x={pct(spread.q1)} width={Math.max(0.5, pct(spread.q3) - pct(spread.q1))} y={4} height={12} fill="var(--fi-brick-tint)" />
          <line x1={pct(spread.median)} x2={pct(spread.median)} y1={2} y2={18} stroke="var(--fi-ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        <YouDot left={pct(you)} at={at + 300} />
      </div>
      <span className="text-right text-[11px] text-ink">{word}</span>
    </div>
  );
}

/** Scene 5, live: the question and an answer built from the sample report's own figures. */
export function SampleAskScene({ sample }: { sample: SampleStory }) {
  const line = sample.story;
  const question = `How does our ${line.label.toLowerCase()} fee compare in our market?`;
  const answer = sample.findings[0] ?? `${sample.name} charges ${formatFee(line.amount)} for ${line.label.toLowerCase()}.`;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 rounded-md border border-control-border bg-paper px-3 py-2 text-[13px] text-ink">
        <span className="shrink-0 text-ink-muted">Ask Hamilton</span>
        <span className={styles.type} style={delay(150, { "--dur": "1800ms", "--steps": question.length })}>
          {question}
        </span>
      </div>
      <div className={`${styles.in} flex items-start gap-2`} style={delay(1700)}>
        <AppIcon brand="hamilton" size={28} title="Hamilton" />
        <div className="grid max-w-[88%] gap-1.5 rounded-lg border border-border bg-paper px-3 py-2 text-[13px] text-ink">
          <p>{answer}</p>
          <span className="text-[10px] text-ink-muted">
            Source: {sample.name} fee schedule, &ldquo;{line.sourceLine}&rdquo;
          </span>
        </div>
      </div>
      <div className="relative ml-9 h-8">
        <span className={`${styles.in} absolute left-0 top-0`} style={delay(2300)}>
          <span className={`${styles.swapOut} block rounded-md border border-control-border bg-surface-0 px-3 py-1.5 text-[12px] font-semibold text-ink`} style={delay(2750)}>
            + Add to report
          </span>
        </span>
        <span className={`${styles.in} absolute left-0 top-0 rounded-md bg-ink px-3 py-1.5 text-[12px] font-semibold text-on-ink`} style={delay(2750)}>
          ✓ Added to report
        </span>
      </div>
    </div>
  );
}

/** Scenes 6 and 7, live: the sample report's cover and its own findings. */
export function SampleReportScene({ sample, settled }: { sample: SampleStory; settled: boolean }) {
  const at = (ms: number) => delay(settled ? 0 : ms);
  return (
    <article className={`${styles.in} flex h-full flex-col gap-2 rounded-md border border-border bg-paper p-4 shadow-fi-1`} style={at(0)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Competitive Fee Position Report</span>
      <h4 className="text-[18px] font-extrabold leading-tight tracking-tight text-ink">{sample.name}</h4>
      <span className="text-[11px] text-ink-muted">{sample.place} · its fees against its local market</span>
      <ol className="mt-1 grid gap-1.5">
        {sample.findings.map((finding, i) => (
          <li key={finding} className={`${styles.in} rounded-sm border-l-2 border-brick bg-surface-0 px-2 py-1.5 text-[12px] text-ink`} style={at(300 + i * 350)}>
            {finding}
          </li>
        ))}
      </ol>
      <span className={`${styles.fade} mt-auto border-t border-border pt-1.5 text-[10px] text-ink-muted`} style={at(1500)}>
        Every figure cites the institution&apos;s own published fee schedule.
      </span>
    </article>
  );
}

/** Scene 1, live: competitors' own schedule lines, opened one at a time. */
export function SampleCollectScene({ sample }: { sample: SampleStory }) {
  const tiles = sample.competitors.filter((c) => c.sourceLine).slice(0, 4);
  return (
    <div className="grid h-full grid-cols-2 content-start gap-3">
      {tiles.map((c, i) => (
        <div key={c.name} className={`${styles.in} flex flex-col gap-1.5 rounded-md border border-border bg-surface-0 p-3`} style={delay(i * 450)}>
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-ink">{c.name}</span>
            <span className="font-mono text-[9px] font-medium text-ink-muted">PDF</span>
          </span>
          <span className="line-clamp-2 font-mono text-[10px] leading-snug text-ink-muted">{c.sourceLine}</span>
        </div>
      ))}
    </div>
  );
}

/** Scene 2, live: the same figures typed into a spreadsheet by hand, then the deck and the invoice. */
export function SampleCostScene({ sample }: { sample: SampleStory }) {
  const rows = sample.competitors.slice(0, 5);
  return (
    <div className="grid h-full grid-cols-[1.5fr_1fr] gap-4">
      <div className="overflow-hidden rounded-md border border-border bg-surface-0 font-mono text-[11px]">
        <div className="grid grid-cols-[1fr_auto] border-b border-border bg-surface-200 px-2 py-1 text-ink-muted">
          <span>Competitor</span>
          <span>{sample.story.label}</span>
        </div>
        {rows.map((c, i) => (
          <div key={c.name} className={`${styles.in} grid grid-cols-[1fr_auto] gap-3 border-b border-border px-2 py-1 last:border-b-0`} style={delay(i * 220)}>
            <span className="truncate text-ink">{c.name}</span>
            <span className="tabular-nums text-ink">{formatFee(c.amount)}</span>
          </div>
        ))}
      </div>
      <div className="relative">
        <div className={`${styles.in} absolute inset-x-0 top-0 rounded-md border border-border bg-surface-0 p-3 text-[11px] font-semibold text-ink`} style={delay(700)}>
          Board deck
        </div>
        <div className={`${styles.in} absolute inset-x-3 top-12 rounded-md border border-border bg-surface-0 p-3 text-[11px] font-semibold text-ink shadow-fi-1`} style={delay(1100)}>
          Consultant invoice
        </div>
      </div>
    </div>
  );
}
