import Link from "next/link";
import { CONTACT_EMAIL, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";

/** Minimal chrome for pages a prospect will forward: the mark, the wordmark, who it was prepared for. */
export function ReportChrome({ preparedFor }: { preparedFor: string }) {
  return (
    <header className="border-b border-[#E0D7C9] bg-[#FDFBF8]">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-[#1A1815] no-underline" aria-label={`${SITE_NAME} home`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-[18px] w-[18px] text-[#C44B2E]"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="4" y="13" width="4" height="8" rx="1" />
            <rect x="10" y="8" width="4" height="13" rx="1" />
            <rect x="16" y="3" width="4" height="18" rx="1" />
          </svg>
          <span
            className="text-[15px] font-medium tracking-tight"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            {SITE_NAME}
          </span>
        </Link>
        <p className="text-[12px] text-[#6B6255]">Prepared for {preparedFor}</p>
      </div>
    </header>
  );
}

export function ReportChromeFooter() {
  return (
    <footer className="border-t border-[#E0D7C9] bg-[#FDFBF8]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-5 text-[12px] text-[#6B6255]">
        <span>{SITE_NAME}</span>
        <span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#5A5347] underline">
            {CONTACT_EMAIL}
          </a>{" "}
          · {SITE_DOMAIN}
        </span>
      </div>
    </footer>
  );
}
