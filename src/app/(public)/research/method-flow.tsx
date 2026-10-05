import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";
import { HAMILTON_CANONICAL } from "@/app/for-institutions/hamilton-copy";
import { SectionHeading } from "./research-hero";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

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
          <Link href="/methodology" className="rounded-full border border-[#1A1815] px-4 py-2 text-[12px] font-semibold text-[#1A1815] transition-colors hover:bg-[#1A1815] hover:text-white">
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
            <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-[#C44B2E]/30 bg-[#FAF7F2] text-[13px] font-bold tabular-nums text-[#A93D25]">
              {s.n}
            </span>
            <h3 className="mt-3 text-[16px] font-semibold text-[#1A1815]" style={SERIF}>{s.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[#6B6255]">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[#E8DFD1] bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Sources</p>
          <ul className="mt-3 space-y-2 text-[13px] text-[#5A5347]">
            {SOURCES.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C44B2E]/70" />
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] text-[#8A8072]">
            Coverage: banks and credit unions of every asset size, all 12 Federal Reserve districts, {coverageLabel}.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-[#1A1815] px-6 py-5 text-[#F5EFE6]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#E8A48F]">{SITE_NAME} Pro · Hamilton</p>
          <p className="mt-2 text-[18px] leading-snug text-white" style={SERIF}>
            Benchmark your institution against the peers you choose.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[#F5EFE6]/80">{HAMILTON_CANONICAL}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/for-institutions#report" className="rounded-full bg-[#C44B2E] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#A93D25]">
              Get a competitive fee report
            </Link>
            <Link href="/subscribe" className="rounded-full border border-white/25 px-4 py-2 text-[12px] font-semibold text-white hover:bg-white/10">
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
