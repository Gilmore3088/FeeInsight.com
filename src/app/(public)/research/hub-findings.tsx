import type { Finding } from "./findings";
import { PRODUCT_NAME } from "@/lib/constants";
import { HubSection } from "./district/[id]/district-hub";

/**
 * The research hub's findings as short reading units: a statement, one supporting sentence, and
 * the calculation behind "About this finding". Report pages keep the fuller KeyFindings grid.
 */
export function HubFindings({ findings, line, asOf }: { findings: Finding[]; line?: string | null; asOf: string | null }) {
  if (findings.length === 0) return null;
  return (
    <HubSection
      id="findings"
      title="Key findings"
      line={line ?? undefined}
      source={
        <>
          {PRODUCT_NAME}, verified published fee schedules, recomputed whenever the index refreshes. A finding appears only where the
          sample is large enough for a median.{asOf ? ` Data as of ${asOf}.` : ""}
        </>
      }
    >
      <div>
      <p id="findings-list-label" className="text-[13px] font-semibold text-ink sm:mx-0 sm:text-left">
        What the national benchmarks show, one value per institution
      </p>
      <ul aria-labelledby="findings-list-label" className="mt-3 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
        {findings.map((f) => (
          <li key={f.key} className="flex flex-col bg-white px-4 py-4 sm:px-5">
            <p className="text-[16px] font-semibold leading-snug text-ink">{f.headline}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{f.detail}</p>
            {f.about && (
              <details className="group mt-1">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-brick [&::-webkit-details-marker]:hidden">
                  About this finding
                  <span aria-hidden="true" className="transition-transform group-open:rotate-90">&rsaquo;</span>
                </summary>
                <p className="text-[12px] leading-relaxed text-ink-muted">{f.about}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
      </div>
    </HubSection>
  );
}
