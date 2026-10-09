import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatAmount } from "@/lib/format";
import { PreviewFrame } from "./preview-frame";

const DISPLAY = { fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" };
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One published fee change, compared with the same schedule's earlier copy (fee_change_records). */
export interface MonitorChange {
  id: number;
  institution: string;
  feeLabel: string;
  oldAmount: number | null;
  newAmount: number | null;
  changedAt: string;
}

/** The newest Regulatory Wire item, in one line. */
export interface MonitorWireItem {
  source: string;
  title: string;
  detail: string | null;
}

/**
 * The Monitor example: the newest like-for-like published fee changes and the newest
 * Regulatory Wire item, both read live. With no changes on record it says so.
 */
export function MonitorPreview({ changes, wire }: { changes: MonitorChange[]; wire: MonitorWireItem | null }) {
  return (
    <PreviewFrame label="Hamilton · Monitor" aside="Live data">
      <div className="px-4 pb-1 pt-4 sm:px-5">
        <p className="text-lg leading-snug text-[#1A1815] font-semibold tracking-tight" style={DISPLAY}>
          Published fee changes
        </p>
      </div>
      {changes.length > 0 ? (
        <ul className="divide-y divide-[#E8E1D6]">
          {changes.map((change) => (
            <li key={change.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-[#1A1815]">{change.institution}</p>
                <p className="text-sm text-[#3D3833]">
                  {change.feeLabel} · <span className="tabular-nums">{DATE.format(new Date(change.changedAt))}</span>
                </p>
              </div>
              <p className="text-right text-[15px] tabular-nums text-[#1A1815]">
                <span className="text-[#6B6255] line-through decoration-[#6B6255]/60">{formatAmount(change.oldAmount)}</span>{" "}
                <ArrowRight aria-hidden className="inline h-3.5 w-3.5 align-[-2px] text-[#6B6255]" />
                <span className="sr-only">to</span> <span className="font-semibold">{formatAmount(change.newAmount)}</span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-[#3D3833] sm:px-5">No changes recorded yet. Pro lists them as schedules are re-read.</p>
      )}
      {wire && (
        <div className="mx-4 mb-4 mt-2 rounded-lg bg-[#FAF7F2] px-3 py-2.5 ring-1 ring-[#E8E1D6] sm:mx-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6B6255]">On the Regulatory Wire</p>
          <p className="mt-1 text-sm font-semibold text-[#1A1815]">{wire.title}</p>
          <p className="text-xs text-[#6B6255]">
            {wire.source}
            {wire.detail ? ` · ${wire.detail}` : ""}
          </p>
        </div>
      )}
      <p className="mt-auto border-t border-[#E8E1D6]/80 bg-white/50 px-4 py-2.5 text-xs leading-relaxed text-[#6B6255] sm:px-5">
        Changes compare a schedule with its own earlier copy. In Pro, watch the institutions you pick.
      </p>
    </PreviewFrame>
  );
}

const SAMPLE_HREF = "/reports/sample-competitive-fee-position";

/** The Report example: the real sample report's cover and findings pages. */
export function ReportPreview() {
  return (
    <PreviewFrame label="Hamilton · Reports" aside="Sample report">
      <div className="relative min-h-[19rem] flex-1 overflow-hidden bg-[#F3EEE6] sm:min-h-[21rem]">
        <Image
          src="/reports/sample-preview/page-1.webp"
          alt="Cover of the sample Competitive Fee Position report, prepared for Sample Community Bank"
          width={850}
          height={1100}
          sizes="(min-width: 1024px) 260px, 45vw"
          className="absolute left-[6%] top-6 w-[46%] -rotate-2 rounded-sm shadow-[0_10px_30px_-12px_rgba(26,24,21,0.45)] ring-1 ring-[#E8E1D6]"
        />
        <Image
          src="/reports/sample-preview/page-2.webp"
          alt="Summary of findings page from the sample report"
          width={850}
          height={1100}
          sizes="(min-width: 1024px) 280px, 50vw"
          className="absolute right-[6%] top-10 w-[50%] rotate-1 rounded-sm shadow-[0_14px_36px_-12px_rgba(26,24,21,0.5)] ring-1 ring-[#E8E1D6]"
        />
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[#E8E1D6]/80 bg-white/50 px-4 py-2.5 text-xs text-[#6B6255] sm:px-5">
        <span>A Competitive Fee Position report, as delivered.</span>
        <Link href={SAMPLE_HREF} className="inline-flex min-h-11 items-center font-medium text-[#A93D25] underline underline-offset-2">
          Open the sample report
        </Link>
      </div>
    </PreviewFrame>
  );
}
