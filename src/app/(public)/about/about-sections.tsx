import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { PageHero } from "@/components/public/page-hero";
import { SITE_NAME } from "@/lib/constants";
import {
  ABOUT_HERO,
  ABOUT_PRODUCTS,
  COVERAGE_NOTES,
  EVIDENCE_STEPS,
  FOUNDER,
  METHODOLOGY_LINK,
  NEUTRALITY,
  type AboutAction,
  type AboutProof,
} from "./about-view";

const SANS = { fontFamily: "var(--fi-font-sans)" } as const;
const MONO = { fontFamily: "var(--fi-font-mono)" } as const;

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.14em] text-brick";
const H2 = "mt-1.5 text-[1.4rem] font-bold leading-tight text-ink sm:text-[1.6rem]";
const TEXT_LINK =
  "inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

/** The shared curved navy hero with the page's purpose (James, Oct 19). */
export function AboutHero() {
  return <PageHero id="about-heading" eyebrow={ABOUT_HERO.eyebrow} title={ABOUT_HERO.title} lede={ABOUT_HERO.lede} />;
}

/** The Bank Fee Index and Hamilton side by side, then where the neutral line sits. */
export function AboutProducts() {
  return (
    <section aria-labelledby="products-heading" id="products" className="scroll-mt-24">
      <p className={EYEBROW}>What we make</p>
      <h2 id="products-heading" className={H2} style={SANS}>
        Two products, one picture
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {ABOUT_PRODUCTS.map((p) => (
          <article
            key={p.id}
            aria-labelledby={`${p.id}-name`}
            className="flex flex-col rounded-2xl border border-border bg-white px-4 py-5 sm:px-6"
          >
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{p.kind}</p>
            <h3 id={`${p.id}-name`} className="mt-1 text-[1.25rem] font-bold leading-tight text-ink" style={SANS}>
              {p.name}
            </h3>
            <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-soft">{p.role}</p>
            <Link href={p.link.href} className={`mt-2 self-start ${TEXT_LINK}`}>
              {p.link.label}
            </Link>
          </article>
        ))}
      </div>
      <div className="mt-4 max-w-3xl space-y-1 border-l-2 border-brick pl-4 text-[15px] leading-relaxed text-ink">
        {NEUTRALITY.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </section>
  );
}

/** How the evidence works: three short steps and the methodology link. */
export function AboutEvidence() {
  return (
    <section aria-labelledby="evidence-heading" id="evidence" className="scroll-mt-24">
      <p className={EYEBROW}>Our method</p>
      <h2 id="evidence-heading" className={H2} style={SANS}>
        How the evidence works
      </h2>
      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        {EVIDENCE_STEPS.map((step, i) => (
          <li key={step.title} className="rounded-2xl border border-border bg-white px-4 py-5 sm:px-5">
            <span aria-hidden="true" className="text-[13px] font-semibold tabular-nums text-brick" style={MONO}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-1 text-[1.05rem] font-bold leading-tight text-ink" style={SANS}>
              {step.title}
            </h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{step.line}</p>
          </li>
        ))}
      </ol>
      <Link href={METHODOLOGY_LINK.href} className={`mt-2 ${TEXT_LINK}`}>
        {METHODOLOGY_LINK.label}
      </Link>
    </section>
  );
}

/** Who runs Fee Insight, with the page's one email link. */
export function AboutFounder({ email }: { email: string }) {
  return (
    <section aria-labelledby="founder-heading" id="founder" className="scroll-mt-24">
      <p className={EYEBROW}>Founder</p>
      <h2 id="founder-heading" className={H2} style={SANS}>
        {FOUNDER.title}
      </h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-soft">{FOUNDER.line}</p>
      {/*
        James's two sentences go here (feedback Oct 19, change 4): his relevant banking experience
        and the problem he saw firsthand. Specific and verifiable, supplied by James; never his
        employer or a client. Until then the line above is the only founder copy.
      */}
      <p className="mt-1 text-[14px] text-ink-soft">
        <a href={`mailto:${email}`} className={TEXT_LINK}>
          {FOUNDER.linkLabel}
        </a>{" "}
        at {email}
      </p>
    </section>
  );
}

/** Current coverage under the story: the live counts and what each one means. Nothing when no count could be read. */
export function AboutCoverage({ proof }: { proof: AboutProof }) {
  if (proof.figures.length === 0) return null;
  return (
    <section aria-labelledby="coverage-heading" id="coverage" className="scroll-mt-24">
      <p className={EYEBROW}>Current coverage</p>
      <h2 id="coverage-heading" className={H2} style={SANS}>
        What the index covers today
      </h2>
      <div className="mt-4 grid gap-6 rounded-2xl border border-border bg-white px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
        <figure aria-labelledby="proof-caption" className="min-w-0">
          <figcaption id="proof-caption" className="sr-only">
            Live coverage
          </figcaption>
          <dl className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
            {proof.figures.map((f) => (
              <div key={f.key} className="flex min-w-0 flex-col" data-figure={f.key}>
                <dt className="order-2 mt-1 text-[12px] leading-snug text-ink-muted">{f.label}</dt>
                <dd className="order-1 text-[1.6rem] font-semibold leading-none tabular-nums text-ink sm:text-[1.8rem]" style={MONO}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
          {proof.publishedShare !== null && (
            <div className="mt-5">
              <span
                role="img"
                aria-label={`${proof.publishedShare}% of monitored institutions have fees in the index`}
                className="block h-2 w-full overflow-hidden rounded-full bg-border"
              >
                <span className="block h-full rounded-full bg-brick" style={{ width: `${proof.publishedShare}%` }} />
              </span>
              <p aria-hidden="true" className="mt-1.5 text-[13px] text-ink-soft">
                <span className="font-semibold tabular-nums text-ink">{proof.publishedShare}%</span> of monitored
                institutions have fees in the index
              </p>
            </div>
          )}
          {proof.freshness && <p className="mt-4 text-[13px] text-ink-soft">{proof.freshness}</p>}
        </figure>
        <dl className="min-w-0 space-y-3 text-[14px] leading-relaxed">
          {COVERAGE_NOTES.map((note) => (
            <div key={note.term}>
              <dt className="font-semibold text-ink">{note.term}</dt>
              <dd className="text-ink-soft">{note.line}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** The closing action: the sample report for bank staff, the demo second, and a quiet link for consumers. */
export function AboutNextAction({ action }: { action: AboutAction }) {
  return (
    <div>
      <section
        aria-labelledby="next-heading"
        id="next"
        className="fi-on-navy scroll-mt-24 rounded-2xl bg-ink px-5 py-6 text-paper sm:px-8 sm:py-8"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brick-on-navy">For banks and credit unions</p>
        <h2 id="next-heading" className="mt-1.5 text-[1.4rem] font-bold leading-tight text-white sm:text-[1.75rem]" style={SANS}>
          See where one institution&apos;s fees stand
        </h2>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-paper/80">
          Each fee is set against its local market and traced to the institution&apos;s own schedule.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <TrackLink
            event={action.event}
            eventProps={{ placement: "about" }}
            href={action.href}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-brick px-6 text-[14px] font-semibold text-white hover:bg-brick-ink"
          >
            {action.label}
          </TrackLink>
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "about_demo" }}
            href={DEMO_REQUEST_NAV.href}
            className="inline-flex min-h-11 items-center justify-center text-[14px] font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
          >
            {DEMO_REQUEST_NAV.label}
          </TrackLink>
        </div>
      </section>
      <Link
        href="/institutions"
        className="mt-3 inline-flex min-h-11 items-center text-[14px] text-ink-soft underline decoration-border underline-offset-4 hover:text-ink hover:decoration-ink"
      >
        Look up your own bank
      </Link>
    </div>
  );
}

/** The operator line under everything else. */
export function AboutLegal({ legalLine }: { legalLine: string }) {
  return (
    <p className="border-t border-border pt-5 text-[12px] text-ink-muted">
      {SITE_NAME} is operated by {legalLine}.
    </p>
  );
}
