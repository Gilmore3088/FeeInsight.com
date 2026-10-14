import { AppIcon, Logo } from "@/brand/components";
import { formatFee, type NationalFee } from "../home-data";
import { positionWords, type SampleLine, type SampleStory } from "../sample-story";
import { Reveal } from "./reveal";

/**
 * The five sizzle scenes, all drawn from the live sample report's real institution. Each takes
 * the scene clock `t` (ms since the scene began) and fits its frame at every width: long text
 * is clamped, and parts that would crowd a phone are left out there.
 */

const CARD = "rounded-lg border border-border bg-surface-0";

/** Schedule lines often carry dot or underscore leaders between a fee and its price; show one gap instead. */
export function tidyScheduleLine(line: string): string {
  return line.replace(/\s*[._·…]{3,}\s*/g, " … ").replace(/\s{2,}/g, " ").trim();
}

export function OldWayScene({ sample, t }: { sample: SampleStory; t: number }) {
  const tiles = sample.competitors.filter((c) => c.sourceLine).slice(0, 4);
  const rows = sample.competitors.slice(0, 4);
  return (
    <div className="grid h-full gap-4 md:grid-cols-[1.1fr_1fr]">
      <div className="grid content-start gap-3 sm:grid-cols-2">
        {tiles.map((c, i) => (
          <Reveal key={c.name} at={i * 900} t={t} className={i > 1 ? "hidden sm:block" : ""}>
            <div className={`${CARD} p-3`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold text-ink">{c.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-muted">PDF</span>
              </div>
              <p className="mt-1.5 line-clamp-2 break-words font-mono text-[11px] leading-snug text-ink-muted">{tidyScheduleLine(c.sourceLine ?? "")}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <div className="hidden min-w-0 flex-col gap-3 md:flex">
        <Reveal at={3600} t={t}>
          <div className={`${CARD} overflow-hidden font-mono text-[12px]`}>
            <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border bg-surface-200 px-3 py-1.5 text-ink-muted">
              <span>Competitor</span>
              <span className="truncate">{sample.story.label}</span>
            </div>
            {rows.map((c) => (
              <div key={c.name} className="grid grid-cols-[1fr_auto] gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                <span className="truncate text-ink">{c.name}</span>
                <span className="tabular-nums text-ink">{formatFee(c.amount)}</span>
              </div>
            ))}
          </div>
        </Reveal>
        <div className="flex gap-3">
          <Reveal at={5400} t={t} className="flex-1">
            <div className={`${CARD} px-3 py-2.5 text-[13px] font-semibold text-ink`}>Board deck</div>
          </Reveal>
          <Reveal at={6300} t={t} className="flex-1">
            <div className={`${CARD} px-3 py-2.5 text-[13px] font-semibold text-ink`}>Consultant invoice</div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

function FeeLineCard({ line }: { line: SampleLine }) {
  return (
    <div className={`${CARD} px-4 py-2.5`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[14px] font-semibold text-ink">{line.label}</span>
        <span className="shrink-0 font-mono text-[18px] font-semibold tabular-nums text-ink">{formatFee(line.amount)}</span>
      </div>
      <p className="mt-0.5 truncate text-[12px] text-ink-muted">
        &ldquo;{tidyScheduleLine(line.sourceLine)}&rdquo; · {line.readOn ? `read ${line.readOn}` : "from its published schedule"}
      </p>
    </div>
  );
}

export function IndexScene({ sample, t, footnote }: { sample: SampleStory; t: number; footnote: string }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <Reveal at={0} t={t}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Logo mark="bank-fee-index-wordmark" height={22} />
          <span className="text-[13px] text-ink-muted">
            {sample.name}, {sample.place}
          </span>
        </div>
      </Reveal>
      {sample.lines.map((line, i) => (
        <Reveal key={line.key} at={700 + i * 1100} t={t} className={i > 1 ? "hidden sm:block" : ""}>
          <FeeLineCard line={line} />
        </Reveal>
      ))}
      <Reveal at={4300} t={t}>
        <p className="text-[12px] text-ink-muted">{footnote}</p>
      </Reveal>
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

function SpreadRow({ label, spread, scale, you, word }: {
  label: string;
  spread: Spread;
  scale: (v: number) => number;
  you: number;
  word: string;
}) {
  const left = (v: number) => `${scale(v)}%`;
  return (
    <div className="grid gap-1.5 border-b border-border pb-3">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="truncate text-ink">{label}</span>
        <span className="shrink-0 font-semibold text-ink">{word}</span>
      </div>
      <div className="relative h-6" aria-hidden="true">
        <span className="absolute top-1/2 h-px -translate-y-1/2 bg-control-border" style={{ left: left(spread.min), width: `${scale(spread.max) - scale(spread.min)}%` }} />
        <span className="absolute top-1 h-4 rounded-sm bg-brick-tint" style={{ left: left(spread.q1), width: `${Math.max(1, scale(spread.q3) - scale(spread.q1))}%` }} />
        <span className="absolute top-0 h-6 w-0.5 -translate-x-1/2 bg-ink" style={{ left: left(spread.median) }} />
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-0 bg-brick" style={{ left: left(you) }} />
      </div>
    </div>
  );
}

export function MarketsScene({ sample, nation, t }: { sample: SampleStory; nation: NationalFee | undefined; t: number }) {
  const line = sample.story;
  const spreads: Spread[] = [];
  if (line.market) spreads.push(line.market);
  if (nation) spreads.push(nation);
  const lo = Math.min(line.amount, ...spreads.map((s) => s.min));
  const hi = Math.max(line.amount, ...spreads.map((s) => s.max));
  const scale = (v: number) => 3 + ((v - lo) / (hi - lo || 1)) * 94;
  return (
    <div className="flex h-full flex-col gap-4">
      <Reveal at={0} t={t}>
        <p className="text-[13px] text-ink-muted">
          <span className="font-semibold text-ink">{line.label}</span> at {sample.name}:{" "}
          <span className="font-mono font-semibold text-ink">{formatFee(line.amount)}</span>
          <span className="ml-2 inline-flex items-center gap-1 align-middle text-[12px]">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-brick" aria-hidden="true" /> this bank
          </span>
        </p>
      </Reveal>
      {line.market ? (
        <Reveal at={900} t={t}>
          <SpreadRow label={`Its market, ${line.market.n} institutions`} spread={line.market} scale={scale} you={line.amount} word={positionWords(line.position)} />
        </Reveal>
      ) : null}
      {nation ? (
        <Reveal at={2200} t={t}>
          <SpreadRow label="The nation" spread={nation} scale={scale} you={line.amount} word={`Median ${formatFee(nation.median)}`} />
        </Reveal>
      ) : null}
      <Reveal at={3600} t={t}>
        <div className="grid gap-2 sm:grid-cols-2">
          {sample.competitors.map((c, i) => (
            <div key={c.name} className={`${CARD} flex items-baseline justify-between gap-3 px-3 py-2 text-[13px] ${i > 1 ? "hidden sm:flex" : ""}`}>
              <span className="truncate text-ink">{c.name}</span>
              <span className="shrink-0 font-mono tabular-nums text-ink">{formatFee(c.amount)}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

export function AskScene({ sample, t }: { sample: SampleStory; t: number }) {
  const line = sample.story;
  const question = `How does our ${line.label.toLowerCase()} fee compare in our market?`;
  const answer = sample.findings[0] ?? `${sample.name} charges ${formatFee(line.amount)} for ${line.label.toLowerCase()}.`;
  const added = t >= 5200;
  return (
    <div className="flex h-full flex-col gap-4">
      <Reveal at={0} t={t} className="self-end">
        <div className="max-w-[34rem] rounded-lg bg-ink px-4 py-2.5 text-[14px] text-on-ink">{question}</div>
      </Reveal>
      <Reveal at={1500} t={t}>
        <div className="flex items-start gap-3">
          <AppIcon brand="hamilton" size={32} title="Hamilton" />
          <div className={`${CARD} grid min-w-0 max-w-[40rem] gap-2 px-4 py-3`}>
            <p className="text-[15px] leading-relaxed text-ink">{answer}</p>
            <p className="line-clamp-2 break-words text-[12px] text-ink-muted">
              Source: {sample.name} fee schedule, &ldquo;{tidyScheduleLine(line.sourceLine)}&rdquo;
            </p>
          </div>
        </div>
      </Reveal>
      <Reveal at={3800} t={t} className="pl-11">
        <span
          className={`inline-block rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors duration-500 ${
            added ? "bg-ink text-on-ink" : "border border-control-border bg-surface-0 text-ink"
          }`}
        >
          {added ? "✓ Added to report" : "+ Add to report"}
        </span>
      </Reveal>
    </div>
  );
}

const DELIVERABLES = ["CEO one-pager", "Board memo", "Pricing committee packet"] as const;

export function ReportScene({ sample, t }: { sample: SampleStory; t: number }) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-[1.6fr_1fr]">
      <Reveal at={0} t={t}>
        <article className={`${CARD} flex flex-col gap-2 bg-paper p-5`}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Competitive Fee Position Report</span>
          <h4 className="text-[22px] font-extrabold leading-tight tracking-tight text-ink">{sample.name}</h4>
          <span className="text-[12px] text-ink-muted">{sample.place} · its fees against its local market</span>
          <ol className="mt-1 grid gap-2">
            {sample.findings.map((finding, i) => (
              <Reveal key={finding} at={1000 + i * 1200} t={t} className={i > 1 ? "hidden sm:block" : ""}>
                <li className="line-clamp-3 border-l-2 border-brick pl-3 text-[13px] leading-snug text-ink">{finding}</li>
              </Reveal>
            ))}
          </ol>
        </article>
      </Reveal>
      <div className="hidden flex-col justify-center gap-2 md:flex">
        <Reveal at={4800} t={t}>
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Turn this into</span>
        </Reveal>
        {DELIVERABLES.map((name, i) => (
          <Reveal key={name} at={5400 + i * 500} t={t}>
            <span className={`${CARD} block px-3 py-2.5 text-[13px] font-semibold text-ink`}>{name}</span>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
