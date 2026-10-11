import Link from "next/link";
import { REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { HAMILTON_CANONICAL } from "@/app/for-institutions/hamilton-copy";
import { SectionHeading } from "./research-hero";

/** Headings and figures in the page font (Plus Jakarta Sans), as on /subscribe. */
const SERIF = { fontWeight: 600, letterSpacing: "-0.015em" };

const STEPS = [
  { n: "01", title: "Find the schedule", body: "Locate each bank's and credit union's own published fee schedule or disclosure." },
  { n: "02", title: "Read it", body: "Turn web pages and PDFs into clean text, one whole document at a time." },
  { n: "03", title: "Extract each fee", body: "Pull every fee line with its amount and conditions, linked to the source document." },
  { n: "04", title: "Verify, then publish", body: "Check amounts against expected ranges. Only verified fees reach this page." },
];

const SOURCES = [
  "Published fee schedules & disclosures",
  "FDIC Call Reports (service charge income)",
  "NCUA 5300 reports (credit union data)",
  "Federal Reserve Beige Book (economic context)",
];

export function MethodFlow({ coverageLabel }: { coverageLabel: string }) {
  return (
    <section id="methodology" className="scroll-mt-28">
      <SectionHeading
        eyebrow="How it's built"
        title="From a bank's fee schedule to a benchmark"
        action={
          <Link href="/methodology" className="inline-flex min-h-11 items-center rounded-lg bg-white/70 px-4 py-2 text-[13px] font-semibold text-[#1A1815] ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:bg-white hover:text-[#A93D25] hover:ring-[#C44B2E]/40">
            Full methodology &rarr;
          </Link>
        }
      >
        Each figure starts as a line in a document the institution published itself.
      </SectionHeading>

      <ol className="relative mt-8 grid gap-4 md:grid-cols-4">
        {/* Connector line behind the steps on wide screens. */}
        <span aria-hidden="true" className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-[#C44B2E]/10 via-[#C44B2E]/40 to-[#C44B2E]/10 md:block" />
        {STEPS.map((s) => (
          <li key={s.n} className="relative">
            <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-[#C44B2E]/30 bg-[#FAF7F2] text-[13px] font-bold [font-variant-numeric:tabular-nums] text-[#A93D25]">
              {s.n}
            </span>
            <h3 className="mt-3 text-[16px] font-semibold text-[#1A1815]" style={SERIF}>{s.title}</h3>
            <p className="mt-1 text-[14px] leading-relaxed text-[#3D3830]">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl bg-white/70 ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl px-6 py-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">Sources</h3>
          <ul className="mt-3 space-y-2 text-[13px] text-[#5A5347]">
            {SOURCES.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C44B2E]/70" />
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] text-[#5A5347]">
            Coverage: banks and credit unions of every asset size, all 12 Federal Reserve districts, {coverageLabel}.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-white/75 ring-1 ring-[#E8E1D6]/80 shadow-[0_12px_40px_-12px_rgba(26,24,21,0.25),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">{SITE_NAME} Pro · Hamilton</p>
          <p className="mt-2 text-[18px] leading-snug text-[#1A1815]" style={SERIF}>
            Benchmark your institution against the peers you choose.
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-[#3D3830]">{HAMILTON_CANONICAL}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/for-institutions?report=institution#report" className="inline-flex min-h-11 items-center rounded-lg bg-[#C44B2E] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#A93D25]">
              {REPORT_OFFER.institutionCtaLabel} · {REPORT_OFFER.priceLabel.toLowerCase()}
            </Link>
            <Link href="/subscribe" className="inline-flex min-h-11 items-center rounded-lg bg-white/70 px-4 py-2 text-[13px] font-semibold text-[#1A1815] ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:bg-white">
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
