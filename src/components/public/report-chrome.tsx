import Link from "next/link";
import { Logo } from "@/brand/components";
import { CONTACT_EMAIL, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";

/** Minimal chrome for pages a prospect will forward: the mark, the wordmark, who it was prepared for. */
export function ReportChrome({ preparedFor }: { preparedFor: string }) {
  return (
    <header className="border-b border-border bg-surface-0">
      <div className="mx-auto flex h-14 max-w-page items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-ink no-underline" aria-label={`${SITE_NAME} home`}>
          <Logo mark="fee-insight-oneline" height={22} title="" />
        </Link>
        <p className="text-[12px] text-ink-muted">Prepared for {preparedFor}</p>
      </div>
    </header>
  );
}

export function ReportChromeFooter() {
  return (
    <footer className="border-t border-border bg-surface-0">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-2 px-6 py-5 text-[12px] text-ink-muted">
        <span>{SITE_NAME}</span>
        <span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink-soft underline">
            {CONTACT_EMAIL}
          </a>{" "}
          · {SITE_DOMAIN}
        </span>
      </div>
    </footer>
  );
}
