import { SITE_NAME } from "@/lib/constants";

const SERIF = { fontFamily: "var(--fi-font-sans)" };

// The report's last section: the same market, kept current in Hamilton (James, 6 Oct 2026).
// institutionId is the report's own bank, so /subscribe opens on its tier instead of a search.
// A reader not ready to subscribe can ask for a Hamilton demo (James, 15 Oct 2026).
export function HamiltonClose({
  competitors,
  institutionId,
  institutionName,
}: {
  competitors: number;
  institutionId?: number | null;
  /** Fills in the demo request's institution, as the report's contact links do. */
  institutionName?: string | null;
}) {
  const params = new URLSearchParams({ from: "/pro/monitor" });
  if (institutionId) params.set("inst", String(institutionId));
  const demo = new URLSearchParams({ source: "demo" });
  if (institutionName) demo.set("company", institutionName);
  return (
    <section className="mt-8 rounded-xl border border-border bg-surface-0 p-6 sm:p-8 print:hidden" aria-labelledby="hamilton-heading">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brick">Keep it current</p>
      <h2 id="hamilton-heading" className="font-bold mt-2 text-[1.35rem] leading-snug text-ink sm:text-[1.6rem]" style={SERIF}>
        Track this market in Hamilton
      </h2>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
        This report is a snapshot. Hamilton, the {SITE_NAME} workspace, keeps these {competitors} competitors on a watchlist
        and shows a competitor&apos;s change once its schedule is re-read.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <a
          href={`/subscribe?${params.toString()}#pro`}
          className="fi-btn fi-btn-primary min-h-11"
        >
          See Hamilton plans
        </a>
        <a href={`/contact?${demo.toString()}`} className="inline-flex min-h-11 items-center text-sm font-medium text-brick underline underline-offset-2">
          Or ask for a demo
        </a>
      </div>
    </section>
  );
}
