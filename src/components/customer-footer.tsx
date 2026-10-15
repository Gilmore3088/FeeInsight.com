import Link from "next/link";
import { Logo } from "@/brand/components";
import { EmailSignup } from "./public/email-signup";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, PRODUCT_NAME, SITE_NAME, TRADEMARK_NOTICE } from "@/lib/constants";

/** Footer columns (site v3 brief 05, section 3). No link points at a gated or noindexed page. */
export const FOOTER_COLUMNS: readonly { heading: string; links: readonly { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: PRODUCT_NAME, href: "/fees" },
      { label: "Find your institution", href: "/institutions" },
      { label: "Market data", href: "/research" },
      { label: "Hamilton", href: "/for-institutions" },
      { label: "Reports", href: "/reports" },
      { label: "Pricing", href: "/subscribe" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "National fee index", href: "/research/national-fee-index" },
      { label: "State reports", href: "/research#states" },
      { label: "District reports", href: "/research#districts" },
      { label: "Consumer guides", href: "/guides" },
      { label: "Methodology", href: "/methodology" },
      { label: "Data sources", href: "/research/data-sources" },
      { label: "API", href: "/api-docs" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Submit a fee source", href: "/submit-fees" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

const FOOTER_LINK_CLASS = "text-ink-muted hover:text-ink transition-colors";
const FOOTER_HEADING_CLASS = "text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted mb-3";

export function CustomerFooter() {
  return (
    <footer className="border-t border-border bg-surface-0">
      <div className="mx-auto max-w-page px-6 py-12 lg:py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:gap-x-12">
          {/* Brand + email */}
          <div className="lg:pr-8">
            <Link href="/" className="flex items-center gap-2 no-underline" aria-label={`${PRODUCT_NAME}, powered by ${SITE_NAME}: home`}>
              <Logo mark="bank-fee-index-lockup" height={40} title="" />
            </Link>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted max-w-xs">
              The {PRODUCT_NAME} reads the published fee schedules of U.S. banks and credit unions, with a source
              for every figure.
            </p>
            <div className="mt-4">
              <EmailSignup />
            </div>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className={FOOTER_HEADING_CLASS}>{column.heading}</p>
              <ul className="space-y-2 text-[13px]">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={FOOTER_LINK_CLASS}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
