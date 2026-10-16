import Link from "next/link";
import { NavAccount, NavPrimaryCtaTablet } from "./nav-account";
import { NavLinks, ProBadge } from "./nav-links";
import { ConsumerMobileNav } from "./consumer-mobile-nav";
import { SearchTrigger } from "./search-trigger";
import { SkipLink } from "./public/skip-link";
import { Logo } from "@/brand/components";
import { SITE_NAME } from "@/lib/constants";

export { PUBLIC_NAV_ITEMS, PRO_NAV_ITEMS, PRO_PLANS_NAV, PRIMARY_CTA_NAV } from "./nav-items";

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
        {/* Phones: search on the left, the logo centred, the menu on the right. From `sm` up the
            wrappers below fall away (`contents`) and the row is the usual logo-left flex. */}
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center sm:flex sm:justify-between">
          <div className="contents sm:flex sm:items-center sm:gap-8">
            <Link
              href="/"
              className="col-start-2 row-start-1 flex items-center gap-2 text-ink no-underline"
              aria-label={`${SITE_NAME} home`}
            >
              <Logo mark="fee-insight-oneline" height={22} title="" />
              <ProBadge />
            </Link>
            <NavLinks />
          </div>
          <div className="contents sm:flex sm:items-center sm:gap-3">
            <div className="col-start-1 row-start-1 -ml-2.5 justify-self-start sm:contents">
              <SearchTrigger />
            </div>
            <NavPrimaryCtaTablet />
            <div className="hidden lg:block">
              <NavAccount />
            </div>
            <div className="col-start-3 row-start-1 -mr-2.5 justify-self-end sm:contents">
              <ConsumerMobileNav />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
