import type { IndicatorSeries, StateEconomicContext } from "@/lib/data-store/economic-context";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { SectionHeading } from "../../research-hero";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

const THEME_LABELS: Record<string, string> = {
  growth: "Growth",
  employment: "Jobs",
  prices: "Prices",
  lending_conditions: "Lending",
};

const TOPIC_LABELS: Record<string, string> = {
  overdraft: "Overdraft & NSF",
  fees_pricing: "Fees & pricing",
  rulemaking_compliance: "Rulemaking",
  consumer_lending: "Consumer lending",
};

function monthLabel(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function dayLabel(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Percent change from a year ago, or null when the series has no year-ago point. */
export function yoyPct(series: IndicatorSeries | null): number | null {
  if (!series?.year_ago || series.year_ago.value === 0) return null;
  return ((series.latest.value - series.year_ago.value) / series.year_ago.value) * 100;
}

/** Percent change over the 12 months ending `date`, from a series' history; null without both points. */
export function yoyAt(series: IndicatorSeries | null, date: string): number | null {
  if (!series) return null;
  const end = series.history.find((p) => p.date === date);
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const begin = series.history.find((p) => p.date === start.toISOString().slice(0, 10));
  if (!end || !begin || begin.value === 0) return null;
  return ((end.value - begin.value) / begin.value) * 100;
}

/** Monthly data more than this many months old is labeled as the latest published, not current. */
const STALE_MONTHS = 4;

export function isStale(date: string, now: Date = new Date()): boolean {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const months = (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
  return months > STALE_MONTHS;
}

function signed(value: number, digits = 1, suffix = "%"): string {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return `0${suffix}`;
  return `${value > 0 ? "+" : "−"}${fixed}${suffix}`;
}

/** First `count` sentences of a passage, and the remainder (empty when nothing was left out). */
export function leadSentences(text: string, count: number): { lead: string; rest: string } {
  const sentences = text.trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
  return { lead: sentences.slice(0, count).join(" "), rest: sentences.slice(count).join(" ") };
}

function Sparkline({ series }: { series: IndicatorSeries }) {
  const values = series.history.map((p) => p.value);
  if (values.length < 3) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-3 h-8 w-full" aria-hidden="true">
      <polyline points={points} fill="none" stroke="#C44B2E" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

interface Tile {
  key: string;
  label: string;
  value: string;
  change: string | null;
  note: string;
  series: IndicatorSeries;
}

function buildTiles(stateName: string, ctx: StateEconomicContext): Tile[] {
  const tiles: Tile[] = [];
  const ur = ctx.state_unemployment;
  if (ur) {
    tiles.push({
      key: "ur",
      label: `${stateName} unemployment rate`,
      value: `${ur.latest.value.toFixed(1)}%`,
      change: ur.year_ago ? `${signed(ur.latest.value - ur.year_ago.value, 1, " pts")} vs a year ago` : null,
      note: `${monthLabel(ur.latest.date)} · BLS via FRED`,
      series: ur,
    });
  }
  const jobs = ctx.state_payrolls;
  const jobsYoy = yoyPct(jobs);
  if (jobs) {
    tiles.push({
      key: "jobs",
      label: `${stateName} payroll jobs`,
      value: jobsYoy != null ? signed(jobsYoy) : `${Math.round(jobs.latest.value).toLocaleString()}k`,
      change: jobsYoy != null ? `${Math.round(jobs.latest.value).toLocaleString()}k jobs, change vs a year ago` : null,
      note: `${monthLabel(jobs.latest.date)} · BLS via FRED`,
      series: jobs,
    });
  }
  const bank = ctx.cpi_bank_services;
  const bankYoy = yoyPct(bank);
  if (bank && bankYoy != null) {
    // Compare over the same 12 months, so a lagging series is never set against a newer one.
    const allYoy = yoyAt(ctx.cpi_all_items, bank.latest.date);
    tiles.push({
      key: "bank-cpi",
      label: "Prices for bank services",
      value: signed(bankYoy),
      change: allYoy != null
        ? `vs ${signed(allYoy)} for all consumer prices, 12 months to ${monthLabel(bank.latest.date)}`
        : `12 months to ${monthLabel(bank.latest.date)}`,
      note: `${monthLabel(bank.latest.date)} · BLS consumer price index`,
      series: bank,
    });
  }
  const ff = ctx.fed_funds;
  if (ff) {
    tiles.push({
      key: "fedfunds",
      label: "Fed funds rate",
      value: `${ff.latest.value.toFixed(2)}%`,
      change: ff.year_ago ? `${signed(ff.latest.value - ff.year_ago.value, 2, " pts")} vs a year ago` : null,
      note: `${monthLabel(ff.latest.date)} · Federal Reserve via FRED`,
      series: ff,
    });
  }
  return tiles;
}

function sentimentClass(sentiment: string): string {
  if (sentiment === "positive") return "bg-[#4F6B3A]/10 text-[#4F6B3A]";
  if (sentiment === "negative") return "bg-[#C44B2E]/10 text-[#A93D25]";
  return "bg-[#F1EBE1] text-[#6B6255]";
}

function Passage({ text, sentences }: { text: string; sentences: number }) {
  const { lead, rest } = leadSentences(text, sentences);
  if (!rest) return <p className="mt-2 text-[14px] leading-relaxed text-[#3D3830]">{lead}</p>;
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer list-none text-[14px] leading-relaxed text-[#3D3830] [&::-webkit-details-marker]:hidden">
        {lead}{" "}
        <span className="whitespace-nowrap text-[12px] font-semibold text-[#A93D25] group-open:hidden print:hidden">Read more</span>
      </summary>
      <p className="mt-2 text-[14px] leading-relaxed text-[#3D3830]">{rest}</p>
    </details>
  );
}

export function EconomyExhibit({ stateName, district, ctx }: { stateName: string; district: number | undefined; ctx: StateEconomicContext }) {
  const tiles = buildTiles(stateName, ctx);
  const bb = ctx.beige_book;
  if (tiles.length === 0 && !bb && ctx.regulatory.length === 0) return null;
  const districtName = district ? DISTRICT_NAMES[district] : null;

  return (
    <section id="economy" className="scroll-mt-28 print:break-inside-avoid">
      <SectionHeading eyebrow="Exhibit 4 · Economy & regulation" title={`The backdrop for ${stateName} pricing`}>
        The local economy, what the {districtName ? `${districtName} Fed` : "Federal Reserve"} is hearing from businesses
        and lenders, and the latest regulator actions that touch fees.
      </SectionHeading>

      {tiles.length > 0 && (
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.key} className="flex flex-col rounded-2xl border border-[#E8DFD1] bg-white p-5">
              <p className="text-[12px] font-semibold text-[#5A5347]">{t.label}</p>
              <p className="mt-2 text-[2.25rem] font-semibold leading-none tabular-nums text-[#1A1815]" style={SERIF}>
                {t.value}
              </p>
              {t.change && <p className="mt-2 text-[12px] text-[#5A5347]">{t.change}</p>}
              <Sparkline series={t.series} />
              <p className="mt-auto pt-2 text-[10px] uppercase tracking-wider text-[#8A8072]">
                {isStale(t.series.latest.date) ? `Latest published ${t.note}` : t.note}
              </p>
            </div>
          ))}
        </div>
      )}

      {(bb || ctx.regulatory.length > 0) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {bb && (
            <div className="rounded-2xl border border-[#E8DFD1] bg-white p-5 sm:p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">
                {districtName} Fed Beige Book · {monthLabel(bb.release_date)}
              </p>
              {bb.themes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {bb.themes.map((t) => (
                    <span key={t.category} title={t.summary} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${sentimentClass(t.sentiment)}`}>
                      {THEME_LABELS[t.category] ?? t.category}: {t.sentiment}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-4 text-[12px] font-semibold text-[#1A1815]">Economic activity</p>
              <Passage text={bb.summary} sentences={3} />
              {bb.banking && (
                <>
                  <p className="mt-4 text-[12px] font-semibold text-[#1A1815]">{bb.banking.section_name}</p>
                  <Passage text={bb.banking.text} sentences={2} />
                </>
              )}
              {bb.source_url && (
                <a href={bb.source_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-[12px] font-semibold text-[#A93D25] hover:underline print:hidden">
                  Read the full district report at federalreserve.gov &rarr;
                </a>
              )}
            </div>
          )}
          {ctx.regulatory.length > 0 && (
            <div className="rounded-2xl border border-[#E8DFD1] bg-white p-5 sm:p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Regulatory watch</p>
              <ul className="mt-2 divide-y divide-[#F1EBE1]">
                {ctx.regulatory.map((item) => (
                  <li key={item.link} className="py-3">
                    <p className="flex flex-wrap items-center gap-x-2 text-[10px] font-semibold uppercase tracking-wider text-[#8A8072]">
                      <span className="rounded bg-[#1A1815] px-1.5 py-0.5 text-white">{item.source}</span>
                      <span>{TOPIC_LABELS[item.topic] ?? item.topic}</span>
                      {item.published_at && <span>· {dayLabel(item.published_at)}</span>}
                    </p>
                    <a href={item.link} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[13px] font-medium leading-snug text-[#1A1815] hover:text-[#A93D25]">
                      {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-[#E8DFD1] pt-2 text-[11px] leading-snug text-[#8A8072]">
        <span className="font-semibold text-[#6B6255]">Source:</span> Bureau of Labor Statistics and Federal Reserve series via
        FRED; Federal Reserve Beige Book; FDIC, OCC, CFPB and Federal Reserve press releases. Shown as published; we add no
        estimates.
      </p>
    </section>
  );
}
