import Link from "next/link";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, SITE_NAME, TRADEMARK_NOTICE } from "@/lib/constants";
import { BrandMark, HOME_NAV } from "./home-header";
import { CONTAINER } from "./look";

const FOOTER_LINKS = [
  ...HOME_NAV,
  { label: "Methodology", href: "/methodology" },
  { label: "Contact", href: "/contact" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
] as const;

/** Logo, the page's links, contact, legal line. */
export function HomeFooter() {
  return (
    <footer className="border-t border-index-line bg-index-cloud">
      <div className={`${CONTAINER} py-10 sm:py-12`}>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-2 text-index-navy">
            <BrandMark className="h-5 w-5 text-index-green" />
            <span className="text-[16px] font-semibold tracking-tight">{SITE_NAME}</span>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-3">
              {FOOTER_LINKS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-[14px] text-index-navy hover:text-index-green">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-[14px] text-index-navy hover:text-index-green">
                  {CONTACT_EMAIL}
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="mt-8 border-t border-index-line pt-6 text-[13px] leading-relaxed text-index-muted">
          © {new Date().getFullYear()} {LEGAL_ENTITY_NAME}. {TRADEMARK_NOTICE}
        </p>
      </div>
    </footer>
  );
}
