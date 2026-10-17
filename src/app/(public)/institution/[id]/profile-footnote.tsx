import Link from "next/link";

/** The quiet last line: where the numbers come from, and how to fix a source. */
export function ProfileFootnote({
  correctSourceHref,
  financialsAsOf,
  financialsSource = "FDIC",
}: {
  correctSourceHref: string;
  financialsAsOf: string | null;
  /** Whose call reports the financials come from. */
  financialsSource?: "FDIC" | "NCUA";
}) {
  return (
    <footer className="border-t border-border pt-6 text-[13px] text-ink-muted">
      <p>
        Fees from the institution&apos;s own published schedule
        {financialsAsOf ? `; financials from ${financialsSource} call reports, ${financialsAsOf}` : ""}.{" "}
        <Link href="/methodology" className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          Methodology
        </Link>
        {" · "}
        <Link href={correctSourceHref} className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          Correct a fee source
        </Link>
      </p>
    </footer>
  );
}
