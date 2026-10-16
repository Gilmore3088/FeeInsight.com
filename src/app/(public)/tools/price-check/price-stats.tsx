import type { ReactNode } from "react";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, medianHasUnstatedAudience } from "@/components/unstated-audience";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted";

type Median = { median_amount: number | null; unstated_audience_institution_count?: number };

/**
 * The price check's headline figures. Each median carries the asterisk when a fee with no
 * stated audience is behind it (#1132), with the footnote once under the figures.
 */
export function PriceStats({
  state,
  count,
  stateMedian,
  nationalMedian,
  lowerShare,
  zero,
  money,
}: {
  state: string;
  count: number;
  stateMedian: Median & { median_amount: number };
  nationalMedian: Median | null;
  lowerShare: number;
  zero: number;
  money: (value: number) => string;
}) {
  const stateMark = medianHasUnstatedAudience(stateMedian);
  const nationalMark = medianHasUnstatedAudience(nationalMedian);
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
        <Stat label="Institutions counted" value={String(count)} />
        <Stat label={`${state} median`} value={<>{money(stateMedian.median_amount)}<UnstatedAudienceMark show={stateMark} /></>} />
        {nationalMedian?.median_amount != null ? (
          <Stat
            label="National median"
            value={<>{money(nationalMedian.median_amount)}<UnstatedAudienceMark show={nationalMark} /></>}
          />
        ) : (
          <Stat label="Charge less" value={`${lowerShare}%`} />
        )}
        <Stat label="Charge $0" value={String(zero)} />
      </dl>
      <UnstatedAudienceFootnote show={stateMark || nationalMark} className="mt-3" />
    </>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/80 bg-white/70 px-4 py-3">
      <dt className={EYEBROW}>{label}</dt>
      <dd className="mt-1 text-[1.25rem] tabular-nums text-ink">{value}</dd>
    </div>
  );
}
