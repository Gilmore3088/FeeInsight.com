const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

// The report's last section: the same market, kept current in Hamilton (James, 6 Oct 2026).
export function HamiltonClose({ competitors }: { competitors: number }) {
  return (
    <section className="mt-8 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 sm:p-8 print:hidden" aria-labelledby="hamilton-heading">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">Keep it current</p>
      <h2 id="hamilton-heading" className="mt-2 text-[1.35rem] leading-snug text-[#1A1815] sm:text-[1.6rem]" style={SERIF}>
        Track this market in Hamilton
      </h2>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#5A5347]">
        This report is a snapshot. Hamilton, the Pro workspace, keeps these {competitors} competitors on a watchlist
        and shows each fee change as it is published.
      </p>
      <a
        href={`/subscribe?${new URLSearchParams({ from: "/pro/monitor" }).toString()}`}
        className="mt-4 inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]"
      >
        See Hamilton plans
      </a>
    </section>
  );
}
