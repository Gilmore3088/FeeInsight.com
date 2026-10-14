import Image from "next/image";
import Link from "next/link";
import { PreviewFrame } from "./preview-frame";

const DISPLAY = { fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" };

/** The newest Regulatory Wire item, in one line. */
export interface MonitorWireItem {
  source: string;
  title: string;
  detail: string | null;
}

/**
 * The Monitor example: what Monitor does, and the newest Regulatory Wire item, read live. It
 * names no institution and shows no fee change: catalog changes are mostly fees being loaded
 * and re-read, not price moves (editorial policy; #1169).
 */
export function MonitorPreview({ wire }: { wire: MonitorWireItem | null }) {
  return (
    <PreviewFrame label="Hamilton · Monitor" aside="Live data">
      <div className="px-4 pb-1 pt-4 sm:px-5">
        <p className="text-lg leading-snug text-ink font-semibold tracking-tight" style={DISPLAY}>
          Schedules you follow
        </p>
      </div>
      <p className="px-4 py-3 text-sm text-ink sm:px-5">
        When a bank you follow publishes an updated fee schedule, Monitor shows each line that differs, with the page and date it came from.
      </p>
      {wire && (
        <div className="mx-4 mb-4 mt-2 rounded-lg bg-paper px-3 py-2.5 ring-1 ring-border sm:mx-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">On the Regulatory Wire</p>
          <p className="mt-1 text-sm font-semibold text-ink">{wire.title}</p>
          <p className="text-xs text-ink-muted">
            {wire.source}
            {wire.detail ? ` · ${wire.detail}` : ""}
          </p>
        </div>
      )}
      <p className="mt-auto border-t border-border/80 bg-white/50 px-4 py-2.5 text-xs leading-relaxed text-ink-muted sm:px-5">
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
      <div className="relative min-h-[19rem] flex-1 overflow-hidden bg-surface-200 sm:min-h-[21rem]">
        <Image
          src="/reports/sample-preview/page-1.webp"
          alt="Cover of the sample Competitive Fee Position report, prepared for Sample Community Bank"
          width={850}
          height={1100}
          sizes="(min-width: 1024px) 260px, 45vw"
          className="absolute left-[6%] top-6 w-[46%] -rotate-2 rounded-sm shadow-[0_10px_30px_-12px_rgba(26,24,21,0.45)] ring-1 ring-border"
        />
        <Image
          src="/reports/sample-preview/page-2.webp"
          alt="Summary of findings page from the sample report"
          width={850}
          height={1100}
          sizes="(min-width: 1024px) 280px, 50vw"
          className="absolute right-[6%] top-10 w-[50%] rotate-1 rounded-sm shadow-[0_14px_36px_-12px_rgba(26,24,21,0.5)] ring-1 ring-border"
        />
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/80 bg-white/50 px-4 py-2.5 text-xs text-ink-muted sm:px-5">
        <span>A Competitive Fee Position report, as delivered.</span>
        <Link href={SAMPLE_HREF} className="inline-flex min-h-11 items-center font-medium text-brick underline underline-offset-2">
          Open the sample report
        </Link>
      </div>
    </PreviewFrame>
  );
}
