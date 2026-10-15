import { coverageSegments, type SegmentKey } from "./directory-view";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";

const SEGMENT_CLASS: Record<SegmentKey, string> = {
  published: "bg-brick",
  review: "bg-amber-300",
  missing: "bg-border",
};

const COUNT = new Intl.NumberFormat("en-US");

/**
 * One state's (or every state's) institutions as a single bar: published fees, under review,
 * no schedule found. Used by the map's panel and by the picked-state header.
 */
export function CoverageBar({
  summary,
  showKey = true,
}: {
  summary: InstitutionStateDirectorySummary;
  showKey?: boolean;
}) {
  const segments = coverageSegments(summary);
  const total = Math.max(summary.institution_count, 1);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-paper ring-1 ring-border" aria-hidden="true">
        {segments.map((s) =>
          s.count > 0 ? (
            <span key={s.key} className={SEGMENT_CLASS[s.key]} style={{ width: `${(s.count / total) * 100}%` }} />
          ) : null,
        )}
      </div>
      {showKey && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
          {segments.map((s) => (
            <div key={s.key} className="min-w-0">
              <dt className="flex items-start gap-1.5 leading-tight text-ink-muted">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEGMENT_CLASS[s.key]}`} aria-hidden="true" />
                <span>{s.label}</span>
              </dt>
              <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">{COUNT.format(s.count)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
