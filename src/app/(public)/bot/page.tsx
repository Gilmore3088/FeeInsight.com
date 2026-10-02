import type { Metadata } from "next";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/constants";
import { CRAWLER_PRODUCT_TOKEN, crawlerUserAgent } from "@/lib/agents/crawler-identity";

export const metadata: Metadata = {
  title: "FeeInsightBot",
  description: `What the ${SITE_NAME} crawler fetches, how often, and how to contact us about it.`,
};

const headingStyle = { fontFamily: "var(--font-newsreader), Georgia, serif" };

export default function BotPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          Crawler
        </span>
      </div>

      <h1
        className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]"
        style={headingStyle}
      >
        FeeInsightBot
      </h1>
      <p className="mt-2 text-[13px] text-[#6B6255]">
        Product token: <code>{CRAWLER_PRODUCT_TOKEN}</code>
      </p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-[#5A5347]">
        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2" style={headingStyle}>
            What it does
          </h2>
          <p>
            FeeInsightBot collects the fee schedules that banks and credit unions publish
            for their customers, such as schedule-of-fees PDFs and disclosure pages. {SITE_NAME}{" "}
            uses these public documents to build the Bank Fee Index, and every published
            fee links back to the document it came from.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2" style={headingStyle}>
            How it identifies itself
          </h2>
          <p>
            Every request starts with <code>{CRAWLER_PRODUCT_TOKEN}</code>, so one rule in your
            robots.txt or allowlist covers all of them. The name in brackets says which part of
            the pipeline made the request:
          </p>
          <ul className="mt-3 list-disc pl-6 space-y-1.5">
            <li>
              <code className="break-all">{crawlerUserAgent("Magellan")}</code>: finds your fee
              schedule and checks whether it has changed.
            </li>
            <li>
              <code className="break-all">{crawlerUserAgent("Rosetta")}</code>: reads the fee
              schedule document.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2" style={headingStyle}>
            What it fetches
          </h2>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>Your public homepage, to find links to fee schedules and disclosures.</li>
            <li>The fee schedule or disclosure documents those links point to.</li>
            <li>It does not log in, submit forms, or request account or customer pages.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2" style={headingStyle}>
            How often
          </h2>
          <p>
            Requests to a site are made one at a time, not in parallel. A known fee schedule
            is checked again periodically to keep the index current, typically no more than
            once or twice a day.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2" style={headingStyle}>
            Contact
          </h2>
          <p>
            To report a problem, ask us to change how often we visit, or correct a fee we
            published, email{" "}
            <a className="text-[#A93D25] underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{" "}
            and include your domain.
          </p>
        </section>
      </div>
    </div>
  );
}
