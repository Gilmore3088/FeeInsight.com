import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PageHero, PAGE_HERO_WRAP } from "@/components/public/page-hero";
import { SITE_URL } from "@/lib/constants";
import { InstitutionSearchBar } from "../institutions/search-bar";
import { ConsumerMarketLookup } from "@/components/public/consumer-market-lookup";
import "./consumer.css";

const TITLE = "For Consumers — Understand Bank Fees";
const DESCRIPTION = "Free consumer guides to bank and credit union fees: understand a charge, avoid unnecessary fees, and decide when a service is worth paying for.";
const PAGE_URL = `${SITE_URL}/for-consumers`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PAGE_URL, type: "website" },
};

const GUIDES = [
  { slug: "overdraft-fees", title: "Overdraft fees", description: "When a payment takes your balance below zero, and the options to review." },
  { slug: "nsf-fees", title: "NSF & returned payments", description: "What happens when a payment is returned unpaid, and what to ask next." },
  { slug: "atm-fees", title: "ATM fees", description: "Why one withdrawal can mean two fees, and how to plan your cash access." },
  { slug: "monthly-maintenance-fees", title: "Monthly account fees", description: "Understand waiver conditions and whether an account fits how you bank." },
  { slug: "wire-transfer-fees", title: "Wire transfers", description: "What you pay to send money, and the tradeoffs to check before sending." },
  { slug: "foreign-transaction-fees", title: "Foreign transactions", description: "The costs to look for when using your card abroad or paying in another currency." },
  { slug: "check-fees", title: "Checks & check services", description: "Understand cashier’s checks, stop payments and check-printing costs." },
  { slug: "digital-banking-fees", title: "Digital banking", description: "Standard and expedited services: decide whether speed is worth the price." },
  { slug: "account-closure-fees", title: "Closing or leaving an account idle", description: "What to check before switching accounts or leaving one unused." },
  { slug: "safe-deposit-fees", title: "Safe deposit boxes", description: "Consider what you need to store, access and protect before renting a box." },
] as const;

// Describe the guide collection from the same entries rendered below, and connect the
// toolkit to Fee Check without mixing a tool into the list of educational guides.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${PAGE_URL}#webpage`,
  url: PAGE_URL,
  name: TITLE,
  description: DESCRIPTION,
  inLanguage: "en",
  isAccessibleForFree: true,
  audience: { "@type": "Audience", audienceType: "Consumers" },
  relatedLink: `${SITE_URL}/check`,
  mainEntity: {
    "@type": "ItemList",
    "@id": `${PAGE_URL}#consumer-guides`,
    name: "Consumer guides",
    numberOfItems: GUIDES.length,
    itemListElement: GUIDES.map((guide, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "WebPage",
        url: `${SITE_URL}/guides/${guide.slug}`,
        name: guide.title,
        description: guide.description,
      },
    })),
  },
};

const TEXT_LINK = "inline-flex min-h-11 items-center gap-2 font-semibold text-brick underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brick";

function Arrow() {
  return <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none">→</span>;
}

export default function ForConsumersPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "For consumers", href: "/for-consumers" }]} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      <PageHero
        eyebrow="For consumers"
        title={<>Understand the fee.<br />Know your options.</>}
        lede="Your place to learn what bank fees mean, how to avoid unnecessary charges, and when a service may be worth paying for."
        aside={
          <div className="consumer-intro lg:pl-10">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-white/70">Before you pay, ask</p>
            <ol className="mt-4 divide-y divide-white/20 border-y border-white/20">
              {["What am I being charged for?", "Is there a way to avoid it?", "Is the service worth it to me?"].map((question, index) => (
                <li key={question} className="flex items-baseline gap-5 py-5">
                  <span className="font-mono text-[13px] text-white/60" aria-hidden="true">0{index + 1}</span>
                  <span className="text-[19px] font-medium sm:text-[23px]">{question}</span>
                </li>
              ))}
            </ol>
          </div>
        }
      >
        <div className="fi-on-navy consumer-intro flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="#consumer-guides" className="inline-flex min-h-12 items-center gap-3 rounded-md bg-white px-5 py-3 text-[15px] font-semibold text-[#132338] transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
            Explore consumer guides <Arrow />
          </Link>
          <Link href="#find-your-options" className="inline-flex min-h-12 items-center text-[15px] font-semibold text-white underline decoration-white/50 underline-offset-4 hover:decoration-white">
            Find your bank or local options
          </Link>
        </div>
        <p className="mt-4 text-[13px] text-white/70">Free to read. No account needed.</p>
      </PageHero>

      <div className={PAGE_HERO_WRAP}>
        <section aria-labelledby="toolkit-heading" className="border-b border-border pb-10 pt-12 sm:pt-16">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brick">Your consumer toolkit</p>
          <h2 id="toolkit-heading" className="mt-2 text-[28px] font-semibold tracking-tight sm:text-[34px]">Learn, check, and explore.</h2>
          <ul className="mt-8 grid gap-7 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            <li className="border-t border-control-border pt-4">
              <Link href="#consumer-guides" className={`${TEXT_LINK} group text-[18px]`}>Consumer guides <Arrow /></Link>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">Understand a charge, avoid unnecessary fees, and weigh the cost of a service.</p>
            </li>
            <li className="border-t border-control-border pt-4">
              <Link href="/check" className={`${TEXT_LINK} group text-[18px]`}>Fee Check <Arrow /></Link>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">See how your institution’s fees compare with state and national medians.</p>
            </li>
            <li className="border-t border-control-border pt-4">
              <Link href="#institution-lookup" className={`${TEXT_LINK} group text-[18px]`}>Institution lookup <Arrow /></Link>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">Find a bank or credit union and the fee information available for it.</p>
            </li>
            <li className="border-t border-control-border pt-4">
              <Link href="#local-options" className={`${TEXT_LINK} group text-[18px]`}>Local options <Arrow /></Link>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">Explore banks and credit unions with branches in your city.</p>
            </li>
          </ul>
        </section>
        <section id="find-your-options" aria-labelledby="lookup-heading" className="scroll-mt-24 border-b border-border py-12 sm:py-16">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brick">Your bank. Your market.</p>
          <h2 id="lookup-heading" className="mt-2 text-[28px] font-semibold tracking-tight sm:text-[34px]">See the options available to you.</h2>
          <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-20">
            <div id="institution-lookup" className="scroll-mt-24">
              <h3 className="text-[20px] font-semibold">Look up a bank or credit union</h3>
              <p className="mb-5 mt-3 text-[16px] leading-relaxed text-ink-soft">Search by name to open its profile and see the fee information we have collected.</p>
              <p className="mb-2 text-[14px] font-medium" aria-hidden="true">Bank or credit union name</p>
              <div role="search" aria-label="Institution lookup">
                <InstitutionSearchBar ariaLabel="Bank or credit union name" placeholder="Enter a bank or credit union name" />
              </div>
              <Link href="/institutions" className={`${TEXT_LINK} group mt-3 text-[14px]`}>Browse the institution directory <Arrow /></Link>
            </div>
            <div id="local-options" className="scroll-mt-24">
              <h3 className="text-[20px] font-semibold">What’s available in my market?</h3>
              <p className="mb-5 mt-3 text-[16px] leading-relaxed text-ink-soft">Explore institutions with branches in your city and compare their available published fees.</p>
              <ConsumerMarketLookup />
            </div>
          </div>
          <p className="mt-5 text-[13px] leading-relaxed text-ink-muted">Fee coverage varies. Confirm account terms with the institution, and check membership eligibility when considering a credit union.</p>
        </section>
        <section aria-labelledby="start-here" className="py-12 sm:py-16">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brick">Start with your situation</p>
          <h2 id="start-here" className="mt-2 text-[28px] font-semibold tracking-tight sm:text-[34px]">What brings you here?</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
            <div className="border-t border-control-border pt-5">
              <h3 className="text-[20px] font-semibold">I was charged a fee</h3>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">Find the fee’s name on your statement, check the account’s fee schedule, and ask your bank what triggered it and whether it can be reversed.</p>
              <Link href="#consumer-guides" className={`${TEXT_LINK} group mt-3 text-[14px]`}>Understand your charge <Arrow /></Link>
            </div>
            <div className="border-t border-control-border pt-5">
              <h3 className="text-[20px] font-semibold">I want to avoid the next one</h3>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">Start with the fees you pay most often. Review account waiver conditions, your ATM network, and alerts that help you track your balance.</p>
              <Link href="/guides/monthly-maintenance-fees" className={`${TEXT_LINK} group mt-3 text-[14px]`}>Review account fees <Arrow /></Link>
            </div>
            <div className="border-t border-control-border pt-5">
              <h3 className="text-[20px] font-semibold">I’m deciding what’s worth it</h3>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">A service can be useful even when it has a fee. Compare the total cost, how soon you need it, and the alternatives available to you.</p>
              <Link href="#weigh-the-cost" className={`${TEXT_LINK} group mt-3 text-[14px]`}>Weigh the cost <Arrow /></Link>
            </div>
          </div>
          <p className="mt-7 text-[13px] leading-relaxed text-ink-muted">More on avoiding charges: <a href="https://www.fdic.gov/consumer-resource-center/2021-12/overdraft-and-account-fees" className="underline underline-offset-4 hover:text-ink">FDIC’s guide to overdraft and account fees</a>.</p>
        </section>

        <section id="consumer-guides" aria-labelledby="guides-heading" className="scroll-mt-24 border-t border-border py-12 sm:py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brick">Consumer guides</p>
              <h2 id="guides-heading" className="mt-2 text-[28px] font-semibold tracking-tight sm:text-[34px]">Get to know the fees.</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">Plain-language explanations, practical questions, and ways to compare your options.</p>
            </div>
            <Link href="/guides" className={`${TEXT_LINK} group text-[14px]`}>Browse all guides <Arrow /></Link>
          </div>
          <ul className="mt-8 grid gap-x-12 md:grid-cols-2">
            {GUIDES.map((guide) => (
              <li key={guide.slug} className="border-t border-border">
                <Link href={`/guides/${guide.slug}`} className="group flex h-full items-start justify-between gap-5 py-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brick">
                  <div>
                    <h3 className="text-[18px] font-semibold transition-colors group-hover:text-brick">{guide.title}</h3>
                    <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted">{guide.description}</p>
                  </div>
                  <span className="pt-1 text-brick"><Arrow /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section id="weigh-the-cost" aria-labelledby="cost-heading" className="scroll-mt-20 bg-surface-200 py-12 sm:py-16">
        <div className={`${PAGE_HERO_WRAP} grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:gap-20`}>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brick">When a service is useful</p>
            <h2 id="cost-heading" className="mt-3 max-w-sm text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">Know what you’re getting for the fee.</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">The right choice depends on what you need. Ask these questions before choosing a service.</p>
          </div>
          <div className="divide-y divide-control-border border-y border-control-border">
            {[
              { title: "Do I need the speed?", text: "Compare standard and expedited delivery, including the arrival time and full price.", href: "/guides/digital-banking-fees", link: "Understand digital service fees" },
              { title: "Does the payment require this service?", text: "Before choosing a wire, confirm the recipient’s requirements and compare the available payment methods.", href: "/guides/wire-transfer-fees", link: "Understand wire transfers" },
              { title: "Will I use what I’m paying for?", text: "Before renting a safe deposit box, consider what you will store and when you will need access.", href: "/guides/safe-deposit-fees", link: "Understand safe deposit boxes" },
            ].map((item) => (
              <details key={item.href} className="group py-1">
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[18px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brick [&::-webkit-details-marker]:hidden">
                  {item.title}<span aria-hidden="true" className="text-brick transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">+</span>
                </summary>
                <div className="pb-5">
                  <p className="text-[16px] leading-relaxed text-ink-soft">{item.text}</p>
                  <Link href={item.href} className={`${TEXT_LINK} mt-2 text-[14px]`}>{item.link} <Arrow /></Link>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="next-step" className={`${PAGE_HERO_WRAP} grid gap-8 py-12 sm:py-16 lg:grid-cols-2 lg:gap-20`}>
        <div>
          <h2 id="next-step" className="text-[25px] font-semibold tracking-tight">Put the guide next to your bank’s fees.</h2>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">Look up your bank or credit union, then check the linked schedule for your account’s terms and waiver conditions. A published fee may apply only to certain accounts or services.</p>
          <Link href="/institutions" className={`${TEXT_LINK} group mt-4 text-[15px]`}>Find your bank or credit union <Arrow /></Link>
        </div>
        <div className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <h3 className="text-[18px] font-semibold">Education you can trace to the source</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">Our guides link to supporting sources. Our fee pages explain the evidence available; coverage varies by institution. Your bank’s current account agreement and fee schedule explain what applies to you.</p>
          <Link href="/methodology" className={`${TEXT_LINK} mt-2 text-[14px]`}>How we use sources <Arrow /></Link>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">For more help with overdrafts, see the <a className="underline underline-offset-4 hover:text-ink" href="https://www.consumerfinance.gov/consumer-tools/bank-accounts/know-your-overdraft-options/">CFPB’s guide to your overdraft options</a>.</p>
        </div>
      </section>
    </>
  );
}
