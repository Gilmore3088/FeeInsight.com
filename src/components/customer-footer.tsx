import Link from "next/link";
import { Logo } from "@/brand/components";
import { EmailSignup } from "./public/email-signup";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, SITE_NAME, TRADEMARK_NOTICE } from "@/lib/constants";

/**
 * The footer's essential links: one short row, not a sitemap (James's review, 2026-10-15). Every
 * page the older four-column footer listed is still one click away from the header: the Product
 * menu (institutions, the index, market data, national index, the Pro workspace) and the Resources menu
 * (consumer guides, methodology, data sources, API, submit a fee source). State and district hubs are linked
 * from /research, which the Product menu carries. No link points at a gated or noindexed page.
 * The chrome carries the parent brand, Fee Insight; the Bank Fee Index and Hamilton marks belong
 * to the pages and workspace they name (James, 2026-10-15, docs/project/DECISIONS.md).
 */
export const FOOTER_LINKS: readonly { label: string; href: string }[] = [
  { label: "Product", href: "/for-institutions" },
  { label: "Reports", href: "/reports" },
  { label: "Pricing", href: "/subscribe" },
  { label: "For consumers", href: "/for-consumers" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

/** Legal links, set in the bottom line beside the trademark notice. */
export const FOOTER_LEGAL_LINKS: readonly { label: string; href: string }[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

const LINK_CLASS = "text-warm-ink-300 transition-colors hover:text-warm-ink-50";

/**
 * A navy band, so the page ends on a finished block rather than a fade (James's review of the light
 * version on a phone, 2026-10-15: "Footer just doesn't look good"). Links sit in three even columns
 * on a phone so none is left alone on a line; the signup is one framed unit. On a phone the mark,
 * the line and the links are centred, as every header is (James, Oct 16).
 */
export function CustomerFooter() {
  return (
    <footer className="fi-on-navy bg-warm-ink-900 text-warm-ink-50">
      <div className="mx-auto max-w-page px-6 pb-6 pt-10 lg:pt-12">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          <div className="min-w-0 max-sm:text-center">
            <Link href="/" className="inline-flex no-underline" aria-label={`${SITE_NAME}: home`}>
              <Logo mark="fee-insight-oneline" tone="reverse" height={24} title="" />
            </Link>
            <p className="mt-3 max-w-sm text-[13px] max-sm:mx-auto leading-snug text-warm-ink-300">
              Published fees from U.S. banks and credit unions, with a source for every figure.
            </p>
            <nav aria-label="Footer" className="mt-6">
              <ul className="grid grid-cols-3 gap-x-4 gap-y-2.5 text-[13px] font-medium max-sm:justify-items-center sm:flex sm:flex-wrap sm:gap-x-6">
                {FOOTER_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={LINK_CLASS}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="min-w-0 rounded-xl border border-warm-ink-700 bg-warm-ink-800 p-4 lg:w-[400px]">
            <EmailSignup />
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-warm-ink-700 pt-5 text-[11px] text-warm-ink-500 max-sm:items-center max-sm:text-center sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <span>
            &copy; {new Date().getFullYear()} {LEGAL_ENTITY_NAME}. {TRADEMARK_NOTICE}
          </span>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 max-sm:justify-center">
            {FOOTER_LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={LINK_CLASS}>
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`} className={LINK_CLASS}>
                {CONTACT_EMAIL}
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
