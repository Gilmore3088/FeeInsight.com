import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { FOUNDER, type AboutAction, type AboutBlock, type AboutProof } from "./about-view";

const SANS = { fontFamily: "var(--fi-font-sans)" } as const;
const MONO = { fontFamily: "var(--fi-font-mono)" } as const;

/** Dark band: what Fee Insight is in one line, with the live coverage exhibit beside it. */
export function AboutHero({ proof }: { proof: AboutProof }) {
  return (
    <section className="fi-on-navy bg-ink text-paper" aria-labelledby="about-heading">
      <div className="mx-auto grid max-w-page gap-8 px-4 pb-10 pt-10 sm:px-6 sm:pb-12 sm:pt-14 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-end">
        <div className="text-center sm:text-left">
          <p className="flex items-center justify-center gap-2 sm:justify-start text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e0716a]">
            <span aria-hidden="true" className="h-px w-8 bg-[#e0716a]/60" />
            About
          </p>
          <h1
            id="about-heading"
            className="mx-auto mt-3 max-w-2xl text-[2rem] sm:mx-0 font-extrabold leading-[1.08] tracking-[-0.015em] text-white sm:text-[3rem]"
            style={SANS}
          >
            {SITE_NAME} publishes the {PRODUCT_NAME}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-paper/80 sm:mx-0 sm:text-base">
            What U.S. banks and credit unions charge, read from each institution&apos;s own fee schedule.
          </p>
        </div>
        <ProofExhibit proof={proof} />
      </div>
    </section>
  );
}

/** The live coverage counts. Renders nothing when no count could be read. */
export function ProofExhibit({ proof }: { proof: AboutProof }) {
  if (proof.figures.length === 0) return null;
  return (
    <figure className="rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-5 sm:px-6" aria-labelledby="proof-caption">
      <figcaption id="proof-caption" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-paper/70">
        Live coverage
      </figcaption>
      <dl className="mt-3 grid grid-cols-1 gap-4 min-[420px]:grid-cols-3 lg:grid-cols-1">
        {proof.figures.map((f) => (
          <div key={f.key} className="flex min-w-0 flex-col" data-figure={f.key}>
            <dt className="order-2 mt-1 text-[12px] leading-snug text-paper/70">{f.label}</dt>
            <dd className="order-1 text-[1.6rem] font-semibold leading-none tabular-nums text-white sm:text-[1.9rem]" style={MONO}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
      {proof.publishedShare !== null && (
        <div className="mt-4">
          <span
            role="img"
            aria-label={`${proof.publishedShare}% of monitored institutions have fees in the index`}
            className="block h-1.5 w-full overflow-hidden rounded-full bg-white/10"
          >
            <span className="block h-full rounded-full bg-[#e0716a]" style={{ width: `${proof.publishedShare}%` }} />
          </span>
          <p aria-hidden="true" className="mt-1.5 text-[12px] text-paper/70">
            {proof.publishedShare}% of monitored institutions have fees in the index
          </p>
        </div>
      )}
      {proof.freshness && (
        <p className="mt-4 inline-flex items-center gap-2 text-[12px] text-paper/75">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7fb59b]" />
          {proof.freshness}
        </p>
      )}
    </figure>
  );
}

/** What Fee Insight publishes, who it is for, how it stays neutral: one short card each. */
export function AboutBlocks({ blocks }: { blocks: readonly AboutBlock[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {blocks.map((block) => (
        <section
          key={block.id}
          id={block.id}
          aria-labelledby={`${block.id}-heading`}
          className="scroll-mt-24 rounded-2xl border border-border bg-white px-4 py-5 sm:px-5"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brick">{block.eyebrow}</p>
          <h2 id={`${block.id}-heading`} className="mt-1.5 text-[1.25rem] font-bold leading-tight text-ink" style={SANS}>
            {block.title}
          </h2>
          <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-ink-soft">
            {block.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          {block.link && (
            <Link
              href={block.link.href}
              className="mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              {block.link.label}
            </Link>
          )}
        </section>
      ))}
    </div>
  );
}

/** The one next action for bank staff, the demo second, and a quiet link for consumers. */
export function AboutNextAction({ action }: { action: AboutAction }) {
  return (
    <div>
      <section
        aria-labelledby="next-heading"
        id="next"
        className="fi-on-navy scroll-mt-24 rounded-2xl bg-ink px-5 py-6 text-paper sm:px-8 sm:py-8"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#e0716a]">For banks and credit unions</p>
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

/** Who runs Fee Insight, merged with the contact line so the page has one email link. */
export function AboutContact({ email, legalLine }: { email: string; legalLine: string }) {
  return (
    <section aria-labelledby="founder-heading" className="border-t border-border pt-6">
      <h2 id="founder-heading" className="text-[1.1rem] font-bold leading-tight text-ink" style={SANS}>
        {FOUNDER.title}
      </h2>
      <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-ink-soft">{FOUNDER.line}</p>
      <p className="mt-1 text-[14px] text-ink-soft">
        <a
          href={`mailto:${email}`}
          className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {FOUNDER.linkLabel}
        </a>{" "}
        at {email}
      </p>
      <p className="mt-2 text-[12px] text-ink-muted">
        {SITE_NAME} is operated by {legalLine}.
      </p>
    </section>
  );
}
