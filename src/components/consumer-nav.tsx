import Link from "next/link";
import { NavAccount } from "./nav-account";
import { NavLinks, ProBadge } from "./nav-links";
import { ConsumerMobileNav } from "./consumer-mobile-nav";
import { SearchTrigger } from "./search-trigger";
import { SITE_NAME } from "@/lib/constants";

export { PUBLIC_NAV_ITEMS, PRO_NAV_ITEMS, REQUEST_REPORT_NAV } from "./nav-items";

/**
 * The single public site header.
 *
 * Reads no session on the server, so pages under the public layout can be prerendered:
 * a header that reads cookies would make every page beneath it dynamic and silently undo
 * the static rendering of the consumer guides. Everything that depends on who is signed
 * in — the nav items, the Pro badge, the account corner, the mobile drawer — is a client
 * island that resolves the session after hydration (see `use-session-chrome.ts`).
 */
export function ConsumerNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#E8DFD1] bg-[#FAF7F2]/95">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link
              href="/"
              className="flex items-center gap-2 text-[#1A1815] no-underline"
              aria-label={`${SITE_NAME} home`}
            >
              <BrandMark className="h-[18px] w-[18px] text-[#C44B2E]" />
              <span
                className="text-[15px] font-medium tracking-tight"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                {SITE_NAME}
              </span>
              <ProBadge />
            </Link>
            <NavLinks />
          </div>
          <div className="flex items-center gap-3">
            <SearchTrigger />
            <div className="hidden lg:block">
              <NavAccount />
            </div>
            <ConsumerMobileNav />
          </div>
        </div>
      </div>
    </header>
  );
}

function BrandMark({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="4" y="13" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="13" rx="1" />
      <rect x="16" y="3" width="4" height="18" rx="1" />
    </svg>
  );
}
