import Link from "next/link";

const LINK = "font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink";

/** The quiet last line: where the numbers come from, and how to fix a source or claim the profile. */
export function ProfileFootnote({
  correctSourceHref,
  claimHref,
  websiteUrl = null,
  financialsAsOf,
  financialsSource = "FDIC",
}: {
  correctSourceHref: string;
  claimHref?: string;
  websiteUrl?: string | null;
  financialsAsOf: string | null;
  /** Whose call reports the financials come from. */
  financialsSource?: "FDIC" | "NCUA";
}) {
  return (
    <footer className="border-t border-border pt-6 text-[13px] text-ink-muted">
      <p className="sm:mx-0 sm:text-left">
        Fees from the institution&apos;s own published schedule
        {financialsAsOf ? `; financials from ${financialsSource} call reports, ${financialsAsOf}` : ""}.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 sm:justify-start [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center">
        <Link href="/methodology" className={LINK}>
          Methodology
        </Link>
        <Link href={correctSourceHref} className={LINK}>
          Correct a fee source
        </Link>
        {claimHref && (
          <Link href={claimHref} className={LINK}>
            Work here? Claim this profile
          </Link>
        )}
        {websiteUrl && (
          <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
            Its website
          </a>
        )}
      </div>
    </footer>
  );
}
