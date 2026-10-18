import { FileCheck2 } from "lucide-react";
import { SERIF } from "@/app/landing-shared";
import { type Charter, type Coverage, coverageCaption, percentLabel, publishedShare } from "./directory-view";

/**
 * The directory's coverage at a glance: the share with published fees as one large figure, a bar
 * that fills to it, and the counts behind it. Set on the navy hero, so its colors are fixed.
 */
export function CoverageMeter({
  coverage,
  charter,
  stateName,
  className = "",
}: {
  coverage: Coverage;
  charter: Charter;
  stateName?: string;
  className?: string;
}) {
  const share = publishedShare(coverage);
  const label = percentLabel(share);
  return (
    <figure className={`min-w-0 ${className}`}>
      <div className="flex items-end gap-3">
        <FileCheck2 aria-hidden="true" className="mb-2 size-7 shrink-0 text-[#e9b8a4] sm:size-8" strokeWidth={1.6} />
        <p className="text-[56px] font-medium leading-none tracking-[-0.02em] text-white [font-variant-numeric:tabular-nums] sm:text-[72px]" style={SERIF}>
          {label}
        </p>
      </div>
      <div
        role="meter"
        aria-label="Share with published fees"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-valuetext={label}
        className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/20"
      >
        <div className="h-full rounded-full bg-brick" style={{ width: `${Math.max(share > 0 ? 1 : 0, share * 100)}%` }} />
      </div>
      <figcaption className="mt-3 text-[15px] leading-snug text-[#e0e9ee] sm:text-[16px]">
        {coverageCaption(coverage, charter, stateName)}
      </figcaption>
    </figure>
  );
}
