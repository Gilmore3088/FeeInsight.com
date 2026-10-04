import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/constants";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;
const PRIMARY =
  "rounded-full bg-[#C44B2E] px-5 py-2.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#A93D25]";
const SECONDARY =
  "rounded-full border border-[#E8DFD1] bg-white/80 px-5 py-2.5 text-[13px] font-medium text-[#5A5347] no-underline transition-colors hover:border-[#C44B2E]/30 hover:text-[#A93D25]";

/** The one 404, used by the root and public not-found pages. */
export function NotFoundContent() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6B6255]">404</p>
      <h1 className="mt-2 text-[2.25rem] leading-[1.1] tracking-[-0.02em] text-[#1A1815]" style={SERIF}>
        Page not found
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[#6B6255]">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/institutions" className={PRIMARY}>
          Find your bank
        </Link>
        <Link href="/fees" className={SECONDARY}>
          Browse the {PRODUCT_NAME}
        </Link>
      </div>
      <nav aria-label="Other places to go" className="mt-10">
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px]">
          {[
            { label: "Consumer guides", href: "/guides" },
            { label: "Research", href: "/research" },
            { label: "Home", href: "/" },
          ].map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-[#6B6255] transition-colors hover:text-[#A93D25]">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
