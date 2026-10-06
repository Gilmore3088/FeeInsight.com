import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import { SERIF } from "@/components/hamilton/memo/memo";
import { ReportSection } from "./ReportSection";
import { StatCalloutBox } from "./StatCalloutBox";
import { REPORT_SECTION_HEADINGS, evidencePolicyLabel, reportTypeLabel } from "./report-labels";

interface ReportOutputProps {
  report: ReportSummaryResponse;
  reportType: string;
  artifactMetadata?: ReportArtifactMetadata | null;
}

const body = "text-base leading-relaxed text-pretty text-warm-800";

export function ReportOutput({ report, reportType, artifactMetadata }: ReportOutputProps) {
  const typeLabel = reportTypeLabel(reportType);
  const h = REPORT_SECTION_HEADINGS;

  return (
    <article className="rounded-lg border border-warm-300 bg-warm-50 px-5 pb-4 sm:px-8">
      <header className="border-b border-warm-300 pb-6 pt-7">
        <p className="text-sm font-medium text-terra-text">{typeLabel}</p>
        <h2 className="mt-1.5 text-3xl leading-tight text-warm-900" style={SERIF}>
          {report.title}
        </h2>
        <p className="mt-2 text-xs text-warm-600">This report can&apos;t be edited here. Download the PDF to keep or share a copy.</p>

        {artifactMetadata && (
          <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-700">
            <span className="font-medium text-warm-900">{evidencePolicyLabel(artifactMetadata.evidencePolicy)}</span>
            <span aria-hidden="true">·</span>
            <span>Peer group: {artifactMetadata.peerBaselineLabel ?? "Not recorded"}</span>
            <span aria-hidden="true">·</span>
            <span className="[font-variant-numeric:tabular-nums]">
              {artifactMetadata.selectedFeeDeltaCount} {artifactMetadata.selectedFeeDeltaCount === 1 ? "fee" : "fees"} compared with peers
            </span>
          </p>
        )}
      </header>

      <div className="max-w-3xl">
        <ReportSection heading={h.summary}>
          {report.executiveSummary.map((paragraph, i) => (
            <p key={i} className={`${body} mb-4 last:mb-0`}>
              {paragraph}
            </p>
          ))}
        </ReportSection>

        {/* Findings the reader carried in from Position, Ask and Test */}
        {report.addedFindings && report.addedFindings.length > 0 && (
          <ReportSection heading={h.addedFindings}>
            <ul className="space-y-4">
              {report.addedFindings.map((finding, i) => (
                <li key={i} className="border-l-2 border-terra pl-4">
                  <p className="text-base font-medium text-pretty text-warm-900">{finding.title}</p>
                  {finding.detail && <p className="mt-1 text-sm leading-relaxed text-pretty text-warm-700">{finding.detail}</p>}
                  <p className="mt-1 text-xs text-warm-600">From {finding.source}</p>
                </li>
              ))}
            </ul>
          </ReportSection>
        )}

        {/* Today vs tested price — only if scenario data present */}
        {report.snapshot.length > 0 && (
          <ReportSection heading={h.snapshot}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {report.snapshot.map((item, i) => (
                <StatCalloutBox key={i} label={item.label} current={item.current} proposed={item.proposed} />
              ))}
            </div>
          </ReportSection>
        )}

        <ReportSection heading={h.rationale}>
          <p className={body}>{report.strategicRationale}</p>
        </ReportSection>

        {report.tradeoffs.length > 0 && (
          <ReportSection heading={h.tradeoffs}>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {report.tradeoffs.map((item, i) => (
                <div key={i} className="min-w-0 rounded-lg border border-warm-300 bg-warm-100 p-4">
                  <dt className="mb-1 text-sm text-pretty text-warm-700">{item.label}</dt>
                  <dd className="text-lg text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </ReportSection>
        )}

        <ReportSection heading={h.position}>
          <p className={body}>{report.recommendation}</p>
          <p className="mt-3 text-xs text-warm-600">Hamilton lays out the evidence; the decision rests with management.</p>
        </ReportSection>

        {report.implementationNotes.length > 0 && (
          <ReportSection heading={h.implementation}>
            <ul className="list-disc space-y-2 pl-5 marker:text-terra">
              {report.implementationNotes.map((note, i) => (
                <li key={i} className="text-base leading-relaxed text-pretty text-warm-800">
                  {note}
                </li>
              ))}
            </ul>
          </ReportSection>
        )}
      </div>
    </article>
  );
}
