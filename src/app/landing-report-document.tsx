import { FileText, ExternalLink } from "lucide-react";

export const SAMPLE_REPORT_PDF = "/reports/sample-competitive-fee-position.pdf";

/** The actual downloadable document, not a screenshot or an invented report cover. */
export function LandingReportDocument({ compact = false }: { compact?: boolean }) {
  return <div className="min-w-0 overflow-hidden rounded-xl border border-[#E0D7C9] bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E0D7C9] px-4 py-3">
      <span className="inline-flex items-center gap-2 text-sm font-semibold"><FileText size={18} className="text-[#A93D25]" aria-hidden />Competitive Fee Position Report</span>
      <span className="text-xs text-[#6B6255]">Sample · Oct 3, 2026 · 10 pages</span>
    </div>
    <iframe src={`${SAMPLE_REPORT_PDF}#toolbar=1&navpanes=0`} title="Read the actual sample Competitive Fee Position Report PDF" loading="lazy" className={`block w-full border-0 ${compact ? "h-[420px]" : "h-[640px] sm:h-[760px]"}`} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E0D7C9] px-4 py-3 text-xs text-[#6B6255]">
      <span>Illustrative sample institution and historical figures. Dates and scope are in the report.</span>
      <a href={SAMPLE_REPORT_PDF} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-[#A93D25]">Open the PDF <ExternalLink size={14} aria-hidden /></a>
    </div>
  </div>;
}
