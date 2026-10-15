import Link from "next/link";

/** The quiet last line: who regulates it, where the numbers come from, and how to fix a source. */
export function ProfileFootnote({
  regulatorFacts,
  correctSourceHref,
  financialsAsOf,
}: {
  regulatorFacts: Array<{ label: string; value: string }>;
  correctSourceHref: string;
  financialsAsOf: string | null;
}) {
  return (
    <footer className="space-y-2 border-t border-border pt-6 text-[13px] text-ink-muted">
      {regulatorFacts.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1">
          {regulatorFacts.map((fact) => (
            <div key={fact.label} className="flex gap-1.5">
              <dt>{fact.label}</dt>
              <dd className="font-medium text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p>
        Fees from the institution&apos;s own published schedule
        {financialsAsOf ? `; financials from FDIC and NCUA call reports, ${financialsAsOf}` : ""}.{" "}
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
