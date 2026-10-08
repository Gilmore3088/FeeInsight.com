import type { Metadata } from "next";
import { CONTACT_EMAIL, LEGAL_ENTITY_LINE, LEGAL_ENTITY_STATE, REPORT_OFFER } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Fee Insight terms of service. Subscription terms, commissioned reports, data usage, and acceptable use.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          Legal
        </span>
      </div>

      <h1
        className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Terms of Service
      </h1>
      <p className="mt-2 text-[13px] text-[#6B6255]">
        Last updated: October 8, 2026
      </p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-[#5A5347]">
        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            1. Acceptance of Terms
          </h2>
          <p>
            Fee Insight is operated by {LEGAL_ENTITY_LINE} (&ldquo;Fee
            Insight&rdquo;, &ldquo;we&rdquo; or &ldquo;us&rdquo;). By accessing or
            using Fee Insight, including the Bank Fee Index and Hamilton (together,
            &ldquo;the Service&rdquo;), you agree to be bound by these Terms of
            Service. If you are using
            the Service on behalf of an organization, you represent that you
            have authority to bind that organization to these terms.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            2. Description of Service
          </h2>
          <p>
            Fee Insight provides fee schedule data, benchmarking tools, and
            analytical capabilities for US bank and credit union fees. The
            Service includes free public access to select data, premium
            subscription tiers with additional features, and one-time
            commissioned reports.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            3. Accounts and Registration
          </h2>
          <p>
            You are responsible for maintaining the confidentiality of your
            account credentials and for all activity that occurs under your
            account. You must provide accurate and complete registration
            information and keep it up to date.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            4. Subscriptions and Billing
          </h2>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>
              Subscriptions are billed in advance on a monthly or annual basis
              depending on the plan selected, and renew automatically at the end
              of each billing period until you cancel. You can cancel from your
              account&apos;s billing page at any time.
            </li>
            <li>
              Annual plans: if you cancel within 14 days of your first annual
              payment, we refund it in full. After that, an annual plan runs to
              the end of its paid year and the unused part is not refunded.
              Monthly plans are not refunded. You may cancel at any time; access
              continues until the end of the current billing period. Other fees
              are non-refundable except where required by law.
            </li>
            <li>
              We reserve the right to change subscription pricing with 30 days
              notice. Price changes take effect at the start of the next billing
              cycle.
            </li>
            <li>
              Payment processing is handled by Stripe. By subscribing, you also
              agree to Stripe&apos;s terms of service.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            5. Commissioned Reports
          </h2>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>
              A commissioned report (for example the {REPORT_OFFER.name}) is a one-time
              purchase at the price stated at the time of order.
            </li>
            <li>
              We confirm the peer set, the price and the delivery date with you before any
              work starts. The report is delivered as a PDF.
            </li>
            <li>
              If we cannot find at least 10 comparable institutions with verified fees for
              your peer set, there is no charge and we tell you.
            </li>
            <li>
              Reports are licensed to the purchasing institution for internal use, including
              board and committee materials. Redistribution or resale requires a separate
              agreement.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            6. Data Usage and Licensing
          </h2>
          <p>
            Free tier users may reference Bank Fee Index data for personal,
            non-commercial use with attribution. Premium subscribers receive
            a commercial license to use data in internal reports, presentations,
            and analysis. Redistribution, resale, or systematic downloading
            of data is prohibited without a separate data licensing agreement.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            7. API Usage
          </h2>
          <p>
            API access is subject to rate limits as specified in your
            subscription tier. API keys are non-transferable and must not be
            shared or embedded in client-side code. We reserve the right to
            revoke API access for violations of these terms or abuse of the
            Service.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            8. Data Accuracy
          </h2>
          <p>
            Fee Insight strives to provide accurate and timely fee data.
            However, fee schedules change frequently and our data reflects a
            point-in-time snapshot. We do not guarantee the accuracy,
            completeness, or currency of any data. Users should verify fee
            information directly with the relevant financial institution before
            making financial decisions.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            9. Not Financial Advice
          </h2>
          <p>
            The Service provides informational data and analytical tools. Nothing
            on Fee Insight constitutes financial, legal, or professional
            advice. We do not recommend any particular financial institution
            or product.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            10. Acceptable Use
          </h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1.5 mt-2">
            <li>Use automated scraping or data extraction beyond your API allocation</li>
            <li>Attempt to reverse-engineer, decompile, or gain unauthorized access to the Service</li>
            <li>Use the Service to harass, defame, or harm any financial institution</li>
            <li>Resell or redistribute data without authorization</li>
            <li>Violate any applicable law or regulation in your use of the Service</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            11. Limitation of Liability
          </h2>
          <p>
            To the maximum extent permitted by law, Fee Insight shall not be
            liable for any indirect, incidental, special, consequential, or
            punitive damages arising from your use of the Service. Our total
            liability shall not exceed the amount you paid for the Service in
            the 12 months preceding the claim.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            12. Termination
          </h2>
          <p>
            We may suspend or terminate your access to the Service at any time
            for violation of these terms, with or without notice. Upon
            termination, your right to use the Service ceases immediately.
            Sections regarding data licensing, liability, and governing law
            survive termination.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            13. Governing Law
          </h2>
          <p>
            These terms are governed by the laws of the State of {LEGAL_ENTITY_STATE},
            without regard to its conflict of law rules. Any dispute arising from these
            terms or the Service will be heard in the state or federal courts located in{" "}
            {LEGAL_ENTITY_STATE}, and you consent to their jurisdiction.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            14. Changes to Terms
          </h2>
          <p>
            We may modify these terms at any time. Material changes will be
            communicated to registered users via email at least 30 days before
            taking effect. Continued use of the Service after changes constitutes
            acceptance.
          </p>
        </section>

        <div className="pt-4 border-t border-[#E8DFD1]">
          <p className="text-[13px] text-[#6B6255]">
            Questions about these terms? Contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#C44B2E] hover:underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
