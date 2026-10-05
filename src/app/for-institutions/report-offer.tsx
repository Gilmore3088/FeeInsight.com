import { CheckCircle2 } from "lucide-react";
import { CONTACT_EMAIL } from "@/lib/constants";
import { RequestReportForm } from "./request-report-form";


const REPORT_CONTENTS = [
  "15 headline fees benchmarked against your true peer cohort (charter, asset tier, district)",
  "Named competitors on the same lines — no anonymous averages",
  "Outlier flags where you sit above or below the peer band",
  "A source citation for every figure: the disclosure, the page, the date collected",
  "PDF, board-ready, with your complete published schedule as an appendix",
];

export function ReportOfferSection() {
  return (
    <section id="report" className="scroll-mt-16 border-b border-warm-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-start">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
              Fee reports
            </p>
            <h2
              className="mt-3 text-warm-900 text-[28px] leading-tight"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              Free national and Fed district reports, in a minute
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-warm-700">
              Pick the national report or your Fed district and it opens right away: the median
              and typical range for the 15 headline fees, from each institution&apos;s own
              published schedule. When you want your own institution against named competitors,
              that is the paid institution report.
            </p>
            <p className="mt-6 text-[13px] font-semibold text-warm-900">The institution report adds</p>
            <ul className="mt-3 space-y-2.5">
              {REPORT_CONTENTS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[14px] text-warm-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-terra" />
                  {item}
                </li>
              ))}
            </ul>
            <ProofExcerpt />
          </div>
          <RequestReportForm contactEmail={CONTACT_EMAIL} />
        </div>
      </div>
    </section>
  );
}

// Real rows from the sample report (Reports/studio/sample/), data pulled Oct 3, 2026.
// Only the client bank is anonymized; peer medians are from 60 published schedules.
const PROOF_ROWS = [
  { fee: "Returned deposited item", you: "$18.00", peerMedian: "$5.00", flag: "Above peer range" },
  { fee: "Monthly maintenance, checking", you: "$10.00", peerMedian: "$7.50", flag: "Within range" },
];

/** Excerpt of the sample Competitive Fee Position Report. */
function ProofExcerpt() {
  return (
    <figure className="mt-8 overflow-hidden rounded-lg border border-warm-300 bg-warm-50">
      <figcaption className="flex items-center justify-between border-b border-warm-200 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600">
          From the sample report
        </span>
        <span className="text-[11px] text-warm-600">Sample Community Bank vs. 60 peer banks</span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-warm-200 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600">
              <th className="px-4 py-2 font-bold">Fee</th>
              <th className="px-3 py-2 text-right font-bold">You</th>
              <th className="px-3 py-2 text-right font-bold">Peer median</th>
              <th className="px-4 py-2 font-bold">Flag</th>
            </tr>
          </thead>
          <tbody>
            {PROOF_ROWS.map((row) => (
              <tr key={row.fee} className="border-b border-warm-200 last:border-b-0">
                <td className="px-4 py-2 text-warm-900">{row.fee}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-warm-900">{row.you}</td>
                <td className="px-3 py-2 text-right tabular-nums text-warm-700">{row.peerMedian}</td>
                <td className="px-4 py-2 text-warm-700">{row.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-warm-200 px-4 py-2 font-mono text-[11px] text-warm-600">
        Source: published fee schedules, Bank Fee Index · data pulled Oct 3, 2026
      </p>
    </figure>
  );
}
