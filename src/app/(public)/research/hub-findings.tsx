import type { Finding } from "./findings";
import { SectionHeading } from "./research-hero";
import { ExhibitSource } from "./exhibits";

/**
 * The research hub's findings as short reading units: a statement, one supporting sentence, and
 * the calculation behind "About this finding". Report pages keep the fuller KeyFindings grid.
 */
export function HubFindings({ findings, asOf }: { findings: Finding[]; asOf: string | null }) {
  if (findings.length === 0) return null;
  return (
    <section id="findings" className="scroll-mt-28">
      <SectionHeading eyebrow="Findings" title="What the published fees show" />
      <ol className="mt-5 max-w-4xl divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
        {findings.map((f) => (
          <li key={f.key} className="px-5 py-5 sm:px-6">
            <p className="text-[17px] font-semibold leading-snug text-ink sm:text-[19px]">{f.headline}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{f.detail}</p>
            {f.about && (
              <details className="group mt-2">
                <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-brick [&::-webkit-details-marker]:hidden">
                  About this finding
                  <span aria-hidden="true" className="transition-transform group-open:rotate-90">&rsaquo;</span>
                </summary>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{f.about}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
      <ExhibitSource asOf={asOf}>Recomputed whenever the index refreshes. A finding appears only where the sample is large enough for a median.</ExhibitSource>
    </section>
  );
}
