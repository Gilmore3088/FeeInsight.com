import Link from "next/link";
import { NavAccount } from "./nav-account";
import { NavLinks, ProBadge } from "./nav-links";
import { ConsumerMobileNav } from "./consumer-mobile-nav";
import { SearchTrigger } from "./search-trigger";
import { SkipLink } from "./public/skip-link";
import { Logo } from "@/brand/components";
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
    <header className="sticky top-0 z-40 border-b border-border bg-paper/95">
      <SkipLink />
      <div className="mx-auto max-w-page px-6">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link
              href="/"
              className="flex items-center gap-2 text-ink no-underline"
              aria-label={`${SITE_NAME} home`}
            >
              <Logo mark="fee-insight-oneline" height={22} title="" />
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
