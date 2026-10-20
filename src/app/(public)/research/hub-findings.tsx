import Link from "next/link";
import { evidenceHref, type Finding } from "./findings";
import { PRODUCT_NAME } from "@/lib/constants";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { HubSection } from "./district/[id]/district-hub";

/** The hub shows this many findings, broadest first. */
export const HUB_FINDINGS = 3;

function evidenceLabel(f: Finding): string {
  return f.fee_category ? `Every published ${getDisplayName(f.fee_category)} price` : "See the benchmark table";
}

/**
 * The research hub's three key findings, near the top: the figure, a one-line takeaway, the
 * supporting sentence, its source and date, and a link to the evidence. The calculation sits
 * behind "How this is calculated". A finding the data can't support isn't computed, so the
 * section can show fewer than three.
 */
export function HubFindings({ findings, asOf }: { findings: Finding[]; asOf: string | null }) {
  const shown = findings.slice(0, HUB_FINDINGS);
  if (shown.length === 0) return null;
  return (
    <HubSection
      id="findings"
      title="Key findings"
      source={
        <>
          {PRODUCT_NAME}, verified published fee schedules, one value per institution, recomputed whenever the index refreshes.
          {asOf ? ` Data as of ${asOf}.` : ""}
        </>
      }
    >
      <ol aria-label="Key findings" className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-3">
        {shown.map((f) => (
          <li key={f.key} className="flex flex-col bg-white px-5 py-5">
            <p className="text-[2rem] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink">{f.figure}</p>
            <p className="mt-3 text-[16px] font-semibold leading-snug text-ink">{f.headline}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{f.detail}</p>
            <div className="mt-auto pt-3">
              {f.about && (
                <details className="group">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">
                    How this is calculated
                    <span aria-hidden="true" className="transition-transform group-open:rotate-90">&rsaquo;</span>
                  </summary>
                  <p className="pb-2 text-[12px] leading-relaxed text-ink-muted">{f.about}</p>
                </details>
              )}
              <Link href={evidenceHref(f)} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-brick hover:underline">
                {evidenceLabel(f)} &rarr;
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </HubSection>
  );
}
