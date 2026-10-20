import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/brand/components";
import { FOOTER_LEGAL_LINKS } from "@/components/customer-footer";
import { SkipLink } from "@/components/public/skip-link";
import { LEGAL_ENTITY_NAME, SITE_NAME } from "@/lib/constants";
import { UTILITY_H1, UTILITY_LEDE } from "./form-style";

const WIDTH = {
  narrow: "max-w-md",
  wide: "max-w-2xl",
} as const;

/**
 * The quiet chrome for utility pages: the Fee Insight logo, one column on parchment and a
 * one-line footer. No site nav, no Hamilton mark (the chrome carries the parent brand only).
 * It renders the page's one <main>.
 *
 * `aside` sits beside the column from the lg breakpoint and below it on a phone, so the form
 * always comes first.
 */
export function UtilityShell({
  children,
  width = "narrow",
  headerAction,
  aside,
}: {
  children: ReactNode;
  width?: keyof typeof WIDTH;
  /** One text link at the right of the header, such as "Sign in" on the register page. */
  headerAction?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SkipLink />
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label={`${SITE_NAME}: home`} className="inline-flex text-ink no-underline">
          <Logo mark="fee-insight-oneline" height={22} title="" />
        </Link>
        {headerAction ? <div className="text-[14px]">{headerAction}</div> : null}
      </header>

      <main id="main-content" className="flex flex-1 justify-center px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
        {aside ? (
          <div className="grid w-full max-w-4xl gap-10 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-16">
            <div className="min-w-0">{children}</div>
            <aside className="min-w-0 lg:pt-24">{aside}</aside>
          </div>
        ) : (
          <div className={`w-full ${WIDTH[width]}`}>{children}</div>
        )}
      </main>

      <footer className="px-4 pb-8 text-[12px] text-ink-muted">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span>
            &copy; {new Date().getFullYear()} {LEGAL_ENTITY_NAME}
          </span>
          {FOOTER_LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-ink-muted hover:text-ink hover:underline">
              {link.label}
            </Link>
          ))}
          <Link href="/contact" className="text-ink-muted hover:text-ink hover:underline">
            Contact
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** The page heading and an optional one-line lede, above the form card. */
export function UtilityHeading({ title, lede, center = false }: { title: ReactNode; lede?: ReactNode; center?: boolean }) {
  return (
    <div className={`mb-6 ${center ? "text-center" : ""}`}>
      <h1 className={UTILITY_H1} style={{ fontFamily: "var(--fi-font-sans)" }}>
        {title}
      </h1>
      {lede ? <p className={UTILITY_LEDE}>{lede}</p> : null}
    </div>
  );
}

/** Small centred links under the card ("Already have an account? Sign in"). */
export function UtilityFootnote({ children }: { children: ReactNode }) {
  return <p className="mt-5 text-center text-[14px] text-ink-muted">{children}</p>;
}
