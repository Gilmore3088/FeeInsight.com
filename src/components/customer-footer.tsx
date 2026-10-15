import Link from "next/link";
import { Logo } from "@/brand/components";
import { EmailSignup } from "./public/email-signup";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, SITE_NAME, TRADEMARK_NOTICE } from "@/lib/constants";

/**
 * The footer's essential links: one short row, not a sitemap (James's review, 2026-10-15). Every
 * page the older four-column footer listed is still one click away from the header: the Product
 * menu (institutions, the index, market data, national index, the Pro workspace) and the Resources menu
 * (guides, methodology, data sources, API, submit a fee source). State and district hubs are linked
 * from /research, which the Product menu carries. No link points at a gated or noindexed page.
 * The chrome carries the parent brand, Fee Insight; the Bank Fee Index and Hamilton marks belong
 * to the pages and workspace they name (James, 2026-10-15, docs/project/DECISIONS.md).
 */
export const FOOTER_LINKS: readonly { label: string; href: string }[] = [
  { label: "Product", href: "/for-institutions" },
  { label: "Reports", href: "/reports" },
  { label: "Pricing", href: "/subscribe" },
  { label: "Methodology", href: "/methodology" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

/** Legal links, set in the bottom line beside the trademark notice. */
export const FOOTER_LEGAL_LINKS: readonly { label: string; href: string }[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

const LINK_CLASS = "text-ink-muted transition-colors hover:text-ink";

export function CustomerFooter() {
  return (
    <footer className="border-t border-border bg-surface-0">
      <div className="mx-auto max-w-page px-6 py-8 lg:py-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
          <div className="min-w-0">
            <Link href="/" className="inline-flex no-underline" aria-label={`${SITE_NAME}: home`}>
              <Logo mark="fee-insight-oneline" height={24} title="" />
            </Link>
            <p className="mt-2 max-w-sm text-[13px] lg:max-w-xl leading-snug text-ink-muted">
              Published fees from U.S. banks and credit unions, with a source for every figure.
            </p>
          </div>

          <div className="flex flex-col gap-5 lg:items-end">
            <nav aria-label="Footer">
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium">
                {FOOTER_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={LINK_CLASS}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <EmailSignup />
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border/60 pt-5 text-[11px] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <span>
            &copy; {new Date().getFullYear()} {LEGAL_ENTITY_NAME}. {TRADEMARK_NOTICE}
          </span>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {FOOTER_LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={LINK_CLASS}>
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink-soft hover:text-ink hover:underline">
                {CONTACT_EMAIL}
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
