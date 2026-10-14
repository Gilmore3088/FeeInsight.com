import Link from "next/link";
import { SkipLink } from "@/components/public/skip-link";
import { SITE_NAME } from "@/lib/constants";
import { BUTTON_NAVY_COMPACT, CONTAINER } from "./look";
import { HomeMenu } from "./home-menu";

/** The four places a bank or credit union visitor goes from the homepage. */
export const HOME_NAV = [
  { label: "Fee data", href: "/fees" },
  { label: "Research", href: "/research" },
  { label: "Hamilton", href: "/for-institutions#pro" },
  { label: "Pricing", href: "/subscribe" },
] as const;

export const WALKTHROUGH_HREF = "#walkthrough";

/**
 * Homepage header in the Index look: logo, four links, sign in, one navy button.
 * Reads no session, so the page stays a plain server render; the menu on phones is a
 * client island that only toggles the links.
 */
export function HomeHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-index-line bg-white/95 backdrop-blur-sm">
      <SkipLink />
      <div className={`${CONTAINER} flex h-16 items-center justify-between gap-4`}>
        <Link href="/" className="flex shrink-0 items-center gap-2 text-index-navy no-underline" aria-label={`${SITE_NAME} home`}>
          <BrandMark className="h-5 w-5 text-index-green" />
          <span className="text-[16px] font-semibold tracking-tight">{SITE_NAME}</span>
        </Link>

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {HOME_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-[15px] text-index-navy hover:text-index-green">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/login" className="hidden text-[15px] text-index-navy hover:text-index-green sm:inline">
            Sign in
          </Link>
          <a href={WALKTHROUGH_HREF} className={BUTTON_NAVY_COMPACT}>
            Request a walkthrough
          </a>
          <HomeMenu items={HOME_NAV} />
        </div>
      </div>
    </header>
  );
}

/** Three rising bars: the same mark as the site header, in the Index colours. */
export function BrandMark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <rect x="4" y="13" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="13" rx="1" />
      <rect x="16" y="3" width="4" height="18" rx="1" />
    </svg>
  );
}
