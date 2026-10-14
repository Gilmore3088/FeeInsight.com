import Link from "next/link";
import { Logo } from "@/brand/components";
import { ProLock } from "@/components/public/pro-lock";
import { EmailSignup } from "./public/email-signup";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, PRODUCT_NAME, SITE_NAME, TRADEMARK_NOTICE } from "@/lib/constants";

const FOOTER_LINK_CLASS = "text-ink-muted hover:text-ink transition-colors";
const FOOTER_HEADING_CLASS = "text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted mb-3";

export function CustomerFooter() {
  return (
    <footer className="border-t border-border bg-surface-0">
      <div className="mx-auto max-w-page px-6 py-12 lg:py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]  lg:gap-x-16">
          {/* Brand + email */}
          <div className="lg:pr-8">
            <Link href="/" className="flex items-center gap-2 no-underline" aria-label={`${PRODUCT_NAME}, powered by ${SITE_NAME}: home`}>
              <Logo mark="bank-fee-index-lockup" height={40} title="" />
            </Link>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted max-w-xs">
              Home of the {PRODUCT_NAME} — U.S. bank and credit union fees
              by district, state, size, and type. Published-source benchmarks
              for consumers and banking teams.
            </p>
            <div className="mt-4">
              <EmailSignup />
            </div>
          </div>

          {/* Product */}
          <div>
            <p className={FOOTER_HEADING_CLASS}>
              Product
            </p>
            <ul className="space-y-2 text-[13px]">
              <li>
                <Link href="/fees" className={FOOTER_LINK_CLASS}>
                  {PRODUCT_NAME}
                </Link>
              </li>
              <li>
                <Link href="/institutions" className={FOOTER_LINK_CLASS}>
                  Find Your Institution
                </Link>
              </li>
              <li>
                <Link href="/research" className={FOOTER_LINK_CLASS}>
                  Research Hub
                </Link>
              </li>
              <li>
                <Link href="/guides" className={FOOTER_LINK_CLASS}>
                  Consumer Guides
                </Link>
              </li>
              <li>
                <Link href="/for-institutions" className={FOOTER_LINK_CLASS}>
                  For Institutions
                </Link>
              </li>
              <li>
                <Link href="/subscribe" className={FOOTER_LINK_CLASS}>
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/api-docs" className={FOOTER_LINK_CLASS}>
                  API
                </Link>
              </li>
            </ul>
          </div>

          {/* Research */}
          <div>
            <p className={FOOTER_HEADING_CLASS}>
              Research
            </p>
            <ul className="space-y-2 text-[13px]">
              <li>
                <Link href="/research/national-fee-index" className={FOOTER_LINK_CLASS}>
                  National benchmarks
                </Link>
              </li>
              <li>
                <Link href="/research/fee-revenue-analysis" className={FOOTER_LINK_CLASS}>
                  Fee-to-Revenue Analysis
                </Link>{" "}
                <ProLock className="ml-1 align-middle" />
              </li>
              <li>
                <Link href="/research" className={FOOTER_LINK_CLASS}>
                  State Reports
                </Link>
              </li>
              <li>
                <Link href="/research#districts" className={FOOTER_LINK_CLASS}>
                  District Reports
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className={FOOTER_HEADING_CLASS}>
              Company
            </p>
            <ul className="space-y-2 text-[13px]">
              <li>
                <Link href="/about" className={FOOTER_LINK_CLASS}>
                  About
                </Link>
              </li>
              <li>
                <Link href="/contact" className={FOOTER_LINK_CLASS}>
                  Contact
                </Link>
              </li>
              <li>
                <Link href="/privacy" className={FOOTER_LINK_CLASS}>
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className={FOOTER_LINK_CLASS}>
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 pt-6 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-ink-muted">
          <span>
            &copy; {new Date().getFullYear()} {LEGAL_ENTITY_NAME}. {TRADEMARK_NOTICE}
          </span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink-soft hover:text-ink hover:underline">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
