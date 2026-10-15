"use client";

import { useState } from "react";
import Link from "next/link";
import { DistributionChart } from "@/components/public/distribution-chart";
import { formatAmount } from "@/lib/format";
import { UnstatedAudienceMark } from "@/components/unstated-audience";

/** One headline fee as the explorer draws it: the national spread, one value per institution. */
export interface ExplorerFee {
  key: string;
  label: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
  institutions: number;
  zeroCount: number;
  /** One value per institution, the same population as the median. */
  values: number[];
  /** The median rests on a row with no stated audience: it carries the asterisk. */
  unstated?: boolean;
}

/** The hero exhibit: pick a headline fee and see how every institution's price spreads around the median. */
export function FeeIndexExplorer({ fees }: { fees: ExplorerFee[] }) {
  const [active, setActive] = useState(fees[0]?.key ?? "");
  const fee = fees.find((f) => f.key === active) ?? fees[0];
  if (!fee) return null;
  return (
    <figure className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-2 sm:p-6">
      <div role="group" aria-label="Fee" className="flex flex-wrap gap-1.5">
        {fees.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={f.key === fee.key}
            onClick={() => setActive(f.key)}
            className={`min-h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
              f.key === fee.key ? "bg-ink text-on-ink" : "text-ink-soft hover:bg-paper hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <figcaption className="mt-4" aria-live="polite">
        <p className="text-[13px] text-ink-muted">{fee.label}, U.S. median</p>
        <p className="font-mono text-[40px] font-semibold leading-none tabular-nums text-ink">
          {formatAmount(fee.median)}
          <UnstatedAudienceMark show={Boolean(fee.unstated)} />
        </p>
        <p className="mt-2 text-[13px] text-ink-muted">
          {fee.p25 != null && fee.p75 != null && (
            <>
              The middle half of institutions charge {formatAmount(fee.p25)} to {formatAmount(fee.p75)}.{" "}
            </>
          )}
          {fee.institutions.toLocaleString()} institutions
          {fee.zeroCount > 0 ? `; ${fee.zeroCount.toLocaleString()} charge nothing` : ""}.
        </p>
      </figcaption>
      <div className="mt-4">
        <DistributionChart values={fee.values} median={fee.median} bucketCount={16} />
      </div>
      <p className="mt-2 text-[12px]">
        <Link href={`/fees/${fee.key}`} className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
          See every figure for this fee
        </Link>
      </p>
    </figure>
  );
}
