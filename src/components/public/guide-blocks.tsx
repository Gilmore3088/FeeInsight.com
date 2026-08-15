import Link from "next/link";
import type { GuideBlock, GuideSection } from "@/lib/guides";
import { resolveTokens } from "@/lib/guides";
import type { DimensionBreakdown, FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";

/** Breakdowns a guide's comparison blocks need, keyed by fee category. */
export type GuideBreakdowns = Map<
  string,
  {
    charter: DimensionBreakdown[];
    asset_tier: DimensionBreakdown[];
    state: DimensionBreakdown[];
  }
>;

const DEFAULT_MIN_OBSERVATIONS = 8;

/**
 * Prose is escaped before token substitution and the resolver emits only <strong> and
 * <span>, so this is the single place guide text becomes markup.
 */
function Prose({
  text,
  summaries,
  className,
}: {
  text: string;
  summaries: FeeCategorySummary[];
  className?: string;
}) {
  const { html } = resolveTokens(text, summaries);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function ListBlock({
  block,
  summaries,
}: {
  block: Extract<GuideBlock, { type: "list" }>;
  summaries: FeeCategorySummary[];
}) {
  const items = block.items.map((item, i) => (
    <li key={i} className="flex gap-3">
      {block.ordered ? (
        <span className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#C44B2E]/8 text-[11px] font-semibold tabular-nums text-[#C44B2E]">
          {i + 1}
        </span>
      ) : (
        <span
          className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-[#C44B2E]/40"
          aria-hidden="true"
        />
      )}
      <Prose text={item} summaries={summaries} className="flex-1" />
    </li>
  ));

  return block.ordered ? (
    <ol className="mt-4 space-y-3 text-[15px] leading-[1.72] text-[#5A5347]">{items}</ol>
  ) : (
    <ul className="mt-4 space-y-3 text-[15px] leading-[1.72] text-[#5A5347]">{items}</ul>
  );
}

const CALLOUT_TONES = {
  tip: {
    border: "border-emerald-600/40",
    bg: "bg-emerald-50/40",
    label: "Worth knowing",
    labelClass: "text-emerald-700",
  },
  warning: {
    border: "border-[#C44B2E]/40",
    bg: "bg-[#C44B2E]/[0.04]",
    label: "Watch out",
    labelClass: "text-[#C44B2E]",
  },
  regulatory: {
    border: "border-[#1A1815]/30",
    bg: "bg-[#FAF7F2]",
    label: "Your rights",
    labelClass: "text-[#5A5347]",
  },
} as const;

function CalloutBlock({
  block,
  summaries,
}: {
  block: Extract<GuideBlock, { type: "callout" }>;
  summaries: FeeCategorySummary[];
}) {
  const tone = CALLOUT_TONES[block.tone];
  return (
    <aside
      className={`mt-5 rounded-r-lg border-l-2 ${tone.border} ${tone.bg} px-5 py-4`}
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-[0.13em] ${tone.labelClass}`}
      >
        {tone.label}
      </p>
      <p className="mt-2 text-[14.5px] leading-[1.7] text-[#5A5347]">
        <Prose text={block.text} summaries={summaries} />
      </p>
    </aside>
  );
}

function BenchmarkBlock({
  block,
  summaries,
}: {
  block: Extract<GuideBlock, { type: "benchmark" }>;
  summaries: FeeCategorySummary[];
}) {
  const name = getDisplayName(block.category);
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-[#E8DFD1]/80 bg-white/70">
      <table className="w-full min-w-[420px] text-left">
        <caption className="sr-only">
          Where your {name} fee sits against the national distribution
        </caption>
        <thead>
          <tr className="border-b border-[#E8DFD1]">
            <th
              scope="col"
              className="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A09788]"
            >
              If your bank charges
            </th>
            <th
              scope="col"
              className="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A09788]"
            >
              Where that puts you
            </th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b border-[#E8DFD1]/50 last:border-0">
              <td className="px-5 py-3 text-[14px] text-[#1A1815]">
                <Prose text={row.condition} summaries={summaries} />
              </td>
              <td className="px-5 py-3 text-[13.5px] text-[#7A7062]">
                <Prose text={row.meaning} summaries={summaries} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders a live breakdown instead of asserting a comparison in prose.
 *
 * Below `minObservations` the block renders nothing at all rather than a frame around
 * a median the sample cannot support.
 */
function ComparisonBlock({
  block,
  breakdowns,
}: {
  block: Extract<GuideBlock, { type: "comparison" }>;
  breakdowns: GuideBreakdowns;
}) {
  const forCategory = breakdowns.get(block.category);
  if (!forCategory) return null;

  const rows = forCategory[block.dimension === "charter" ? "charter" : block.dimension];
  const min = block.minObservations ?? DEFAULT_MIN_OBSERVATIONS;
  const usable = rows
    .filter((r) => r.count >= min && r.median_amount !== null)
    .slice(0, 8);

  if (usable.length < 2) return null;

  const widest = Math.max(...usable.map((r) => r.median_amount ?? 0));

  return (
    <figure className="mt-5 rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-5">
      <div className="space-y-3">
        {usable.map((row) => {
          const median = row.median_amount ?? 0;
          const pct = widest > 0 ? Math.max(4, (median / widest) * 100) : 0;
          return (
            <div key={row.dimension_value}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-[#1A1815]">
                  {row.dimension_value}
                </span>
                <span className="text-[13px] font-semibold tabular-nums text-[#1A1815]">
                  {formatAmount(median)}
                  <span className="ml-2 text-[11px] font-normal tabular-nums text-[#A09788]">
                    n={row.count.toLocaleString()}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#F0EAE0]">
                <div
                  className="h-full rounded-full bg-[#C44B2E]/50"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#A09788]">
        <span>
          {block.caption ?? `${getDisplayName(block.category)} median by group`}
        </span>
        <span className="h-3 w-px bg-[#D4C9BA]" aria-hidden="true" />
        <Link
          href={`/fees/${block.category}`}
          className="font-medium text-[#C44B2E]/70 transition-colors hover:text-[#C44B2E]"
        >
          Full breakdown
        </Link>
      </figcaption>
    </figure>
  );
}

export function GuideBlockRenderer({
  block,
  summaries,
  breakdowns,
}: {
  block: GuideBlock;
  summaries: FeeCategorySummary[];
  breakdowns: GuideBreakdowns;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="mt-4 text-[15.5px] leading-[1.82] text-[#5A5347] first:mt-0">
          <Prose text={block.text} summaries={summaries} />
        </p>
      );
    case "list":
      return <ListBlock block={block} summaries={summaries} />;
    case "callout":
      return <CalloutBlock block={block} summaries={summaries} />;
    case "benchmark":
      return <BenchmarkBlock block={block} summaries={summaries} />;
    case "comparison":
      return <ComparisonBlock block={block} breakdowns={breakdowns} />;
  }
}

export function GuideSectionRenderer({
  section,
  summaries,
  breakdowns,
  isLast,
}: {
  section: GuideSection;
  summaries: FeeCategorySummary[];
  breakdowns: GuideBreakdowns;
  isLast: boolean;
}) {
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-heading`}
      className="scroll-mt-24"
    >
      <h2
        id={`${section.id}-heading`}
        className="text-[21px] font-medium leading-snug tracking-[-0.01em] text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        {section.heading}
      </h2>
      {section.blocks.map((block, i) => (
        <GuideBlockRenderer
          key={i}
          block={block}
          summaries={summaries}
          breakdowns={breakdowns}
        />
      ))}
      {!isLast && (
        <div
          className="mt-10 h-px bg-gradient-to-r from-[#E8DFD1] via-[#E8DFD1]/40 to-transparent"
          aria-hidden="true"
        />
      )}
    </section>
  );
}
