import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";
import { HAMILTON_CANONICAL } from "@/app/for-institutions/hamilton-copy";
import { SectionHeading } from "./research-hero";

const SERIF = { fontFamily: "var(--fi-font-sans)" };

const STEPS = [
  { n: "01", title: "Find the schedule", body: "Locate each bank's and credit union's own published fee schedule or disclosure." },
  { n: "02", title: "Read it", body: "Turn web pages and PDFs into clean text, one whole document at a time." },
  { n: "03", title: "Extract each fee", body: "Pull every fee line with its amount and conditions, linked to the source document." },
  { n: "04", title: "Verify, then publish", body: "Check each fee against its own schedule before it can be published. Only verified fees reach this page." },
];

const VERIFIED_CHECKS = [
  "The amount appears in the stored text of the institution's own published schedule.",
  "For the main fee categories, the fee's name names that fee and not a different one.",
  "The price sits inside the expected range for that category.",
  "The fee links back to its source document.",
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
          <Link href="/methodology" className="rounded-full border border-ink px-4 py-2 text-[12px] font-semibold text-ink transition-colors hover:bg-ink hover:text-white">
            Full methodology &rarr;
          </Link>
        }
      >
        Each figure starts as a line in a document the institution published itself.
      </SectionHeading>

      <ol className="relative mt-8 grid gap-4 md:grid-cols-4">
        {/* Connector line behind the steps on wide screens. */}
        <span aria-hidden="true" className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-brick/10 via-brick/40 to-brick/10 md:block" />
        {STEPS.map((s) => (
          <li key={s.n} className="relative">
            <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-brick/30 bg-paper text-[13px] font-bold tabular-nums text-brick">
              {s.n}
            </span>
            <h3 className="mt-3 text-[16px] font-bold text-ink" style={SERIF}>{s.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <div id="verified" className="mt-8 scroll-mt-28 rounded-2xl border border-border bg-white px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">What &ldquo;verified&rdquo; means</p>
        <ul className="mt-3 space-y-2 text-[13px] text-ink-soft">
          {VERIFIED_CHECKS.map((c) => (
            <li key={c} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brick/70" />
              {c}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-ink-muted">
          Not yet checked: which account each price belongs to. A schedule with several accounts can list several prices
          for one fee, so each institution counts once, at the median of its prices (overdraft: its highest).
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Sources</p>
          <ul className="mt-3 space-y-2 text-[13px] text-ink-soft">
            {SOURCES.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brick/70" />
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] text-ink-muted">
            Coverage: banks and credit unions of every asset size, all 12 Federal Reserve districts, {coverageLabel}.
            Each state and district report shows how many of its institutions have published fees so far.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-ink px-6 py-5 text-paper">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#e0716a]">{SITE_NAME} Pro · Hamilton</p>
          <p className="font-semibold mt-2 text-[18px] leading-snug text-white" style={SERIF}>
            Benchmark your institution against the peers you choose.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-paper/80">{HAMILTON_CANONICAL}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/for-institutions#report" className="rounded-full bg-brick px-4 py-2 text-[12px] font-semibold text-white hover:bg-brick-ink">
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
