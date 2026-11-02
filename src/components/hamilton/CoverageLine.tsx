import { coverageSummary, coverageWords, type InstitutionCoverage } from "@/lib/hamilton/coverage-line";

/**
 * The coverage and freshness line under the command center's header (#1891, V5 §4A): how many of
 * the institution's fees are on file, its schedule's date, when they were last verified, the peer
 * set and its size, and the headline fee types with no published fee. The board brief's PDF cover
 * prints the same words (PdfDocument), and so does the brief on screen (ReportOutput). `coverage`
 * null means the read failed; the line says so.
 */
export function CoverageLine({ coverage, peerLabelShown = false, compact = false, className = "" }: {
  coverage: InstitutionCoverage | null;
  /** One short line, with every sentence and the source folded in a collapsed details element. */
  compact?: boolean;
  /** True where the page names the peer set just above (a brief's "Peer baseline" line). */
  peerLabelShown?: boolean;
  className?: string;
}) {
  if (!coverage) {
    return (
      <p role="status" className={`max-w-3xl text-sm text-warm-600 ${className}`.trim()}>
        Coverage for this institution could not be read just now.
      </p>
    );
  }
  const words = coverageWords(coverage, { peerLabelShown });
  if (compact) {
    return (
      <section aria-label="Coverage and freshness" className={`max-w-full text-sm text-warm-700 [font-variant-numeric:tabular-nums] ${className}`.trim()}>
        <details>
          <summary className="w-fit cursor-pointer py-1">
            <span className="font-semibold text-warm-900">Coverage: </span>
            {coverageSummary(coverage)} <span className="text-terra-text underline">Details</span>
          </summary>
          <div className="mt-1 max-w-3xl rounded-md border border-warm-300 bg-warm-50 px-4 py-3">
            <p className="text-pretty text-sm leading-relaxed text-warm-900">{words.sentences.join(" ")}</p>
            <p className="mt-1 text-xs leading-snug text-warm-600">Source: {words.source}</p>
          </div>
        </details>
      </section>
    );
  }
  return (
    <section aria-label="Coverage and freshness" className={`w-fit max-w-full rounded-md border border-warm-300 bg-warm-50 px-4 py-3 ${className}`.trim()}>
      <p className="text-pretty text-sm leading-relaxed text-warm-900 [font-variant-numeric:tabular-nums]">
        <span className="font-semibold">Coverage. </span>
        {words.sentences.join(" ")}
      </p>
      <p className="mt-1 text-xs leading-snug text-warm-600">Source: {words.source}</p>
    </section>
  );
}
