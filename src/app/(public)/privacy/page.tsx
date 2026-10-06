import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Fee Insight privacy policy. How we collect, use, and protect your data.",
};

export default function PrivacyPage() {
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
        Privacy Policy
      </h1>
      <p className="mt-2 text-[13px] text-[#6B6255]">
        Last updated: October 6, 2026
      </p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-[#5A5347]">
        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Information We Collect
          </h2>
          <p>
            <strong>Account information.</strong> When you create an account, we collect
            your name, email address, and optionally your institution name, job role,
            state, and asset tier. This information is used to personalize your
            experience and provide relevant benchmarks.
          </p>
          <p className="mt-3">
            <strong>Usage data.</strong> We collect information about how you use
            Fee Insight, including pages visited, features used, and Hamilton analysis
            queries. This helps us improve the product and understand usage patterns.
          </p>
          <p className="mt-3">
            <strong>Payment information.</strong> Subscription payments are processed
            by Stripe. We do not store credit card numbers or full payment details
            on our servers. We retain your Stripe customer ID for subscription
            management.
          </p>
          <p className="mt-3">
            <strong>Forms and requests.</strong> When you request a report, ask to
            hear about updates, send a message through the contact page, or submit a
            fee schedule, we collect what you enter: usually your name, email address,
            and optionally your institution, role, and the details of your request.
            We use it to answer you and to deliver what you asked for.
          </p>
          <p className="mt-3">
            <strong>Email list.</strong> If you subscribe to updates, your email
            address is kept on our mailing list. Every marketing email has an
            unsubscribe link, and you can change your choices on the email
            preferences page.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            How We Use Your Information
          </h2>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>Provide and maintain the Fee Insight platform and the Bank Fee Index</li>
            <li>Personalize fee benchmarks based on your institution profile</li>
            <li>Process subscription payments and manage your account</li>
            <li>Send service-related communications (billing, security, product updates)</li>
            <li>Improve our data coverage and analytical features</li>
            <li>Respond to support requests and inquiries</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Data We Publish
          </h2>
          <p>
            Fee Insight aggregates and publishes fee schedule data from
            publicly available sources. All fee data displayed on our platform
            is derived from institutions&apos; own published disclosures and
            regulatory filings. We do not publish any data that is not already
            publicly available.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Cookies
          </h2>
          <p>
            We use one essential cookie to keep you signed in. Your light or dark
            display setting is saved in your own browser&apos;s storage, not in a
            cookie. We measure page views with Vercel Analytics, which counts visits
            in aggregate without cookies. We do not use advertising cookies or
            cross-site tracking.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Data Security
          </h2>
          <p>
            We implement industry-standard security measures to protect your
            information. Passwords are hashed using bcrypt. Database connections
            use encryption in transit. Payment processing is handled entirely
            by Stripe, a PCI DSS Level 1 certified provider.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Data Retention
          </h2>
          <p>
            Account data is retained for the duration of your account. Form
            submissions and mailing list entries are kept until you ask us to remove
            them or unsubscribe. When you ask us to delete your personal information,
            we remove it within 30 days, except records we must keep for billing or
            legal reasons. Aggregate usage analytics may be retained for product
            improvement purposes.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Third-Party Services
          </h2>
          <ul className="list-disc pl-6 space-y-1.5">
            <li><strong>Vercel</strong> for application hosting and aggregate page analytics</li>
            <li><strong>Supabase</strong> for our database</li>
            <li><strong>Stripe</strong> for payment processing</li>
            <li><strong>Resend</strong> for account and report emails</li>
            <li><strong>MailerLite</strong> for our mailing list</li>
            <li><strong>Anthropic (Claude)</strong> for Hamilton analysis features; questions you ask Hamilton are sent to Anthropic to produce an answer</li>
          </ul>
          <p className="mt-3">
            Each of these providers has their own privacy policy governing
            how they process data.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Your Rights
          </h2>
          <p>
            You may request access to, correction of, or deletion of your
            personal information at any time by contacting us at{" "}
            <a href="mailto:hello@bankfeeindex.com" className="text-[#C44B2E] hover:underline">
              hello@bankfeeindex.com
            </a>.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Children
          </h2>
          <p>
            Fee Insight is not directed at children under 13, and we do not knowingly
            collect their personal information.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] font-medium text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Changes to This Policy
          </h2>
          <p>
            We may update this privacy policy from time to time. Material
            changes will be communicated via email to registered users.
            Continued use of the platform after changes constitutes acceptance
            of the updated policy.
          </p>
        </section>

        <div className="pt-4 border-t border-[#E8DFD1]">
          <p className="text-[13px] text-[#6B6255]">
            Questions about this policy? Contact us at{" "}
            <a href="mailto:hello@bankfeeindex.com" className="text-[#C44B2E] hover:underline">
              hello@bankfeeindex.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
