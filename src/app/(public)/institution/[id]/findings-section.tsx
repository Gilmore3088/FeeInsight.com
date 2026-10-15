import { ExternalLink } from "lucide-react";
import type { Finding } from "./findings";
import { MarketRange, rangeDomain, type Position } from "./market-position";

const FIGURE_TONE: Record<Position, string> = {
  below: "text-below-market",
  within: "text-ink",
  above: "text-above-market",
};

/** The page's lead: three sourced findings, each one difference, its comparison group and its source. */
export function FindingsSection({ findings, asOf }: { findings: Finding[]; asOf: string | null }) {
  if (findings.length === 0) return null;
  return (
    <section aria-labelledby="findings-heading" className="space-y-3">
      <h2 id="findings-heading" className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {findings.length === 1 ? "What stands out" : `${findings.length} things that stand out`}
      </h2>
      <ol className="grid gap-3 lg:grid-cols-3">
        {findings.map((finding) => (
          <li key={finding.key} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-medium text-ink-muted">{finding.label}</p>
              <p className={`shrink-0 font-mono text-[26px] font-semibold leading-none tabular-nums ${FIGURE_TONE[finding.tone]}`}>
                {finding.figure}
              </p>
            </div>
            <p className="mt-2 text-[15px] leading-snug text-ink">{finding.text}</p>
            {finding.bar && (
              <div className="mt-3">
                <MarketRange
                  label={finding.bar.label}
                  band={finding.bar.band}
                  amount={finding.bar.amount}
                  domainMax={rangeDomain(finding.bar.amount, [finding.bar.band])}
                />
              </div>
            )}
            <p className="mt-auto pt-3 text-[12px] text-ink-muted">
              Compared with {finding.comparedWith}
              {asOf ? `, ${asOf}` : ""}
              {finding.sourceUrl && (
                <>
                  {" · "}
                  <a
                    href={finding.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
                  >
                    Its schedule
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </>
              )}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
