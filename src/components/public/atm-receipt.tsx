import { ExternalLink } from "lucide-react";
import type { AtmFeeLine, AtmTwoFeeExample } from "@/lib/guides/atm-example";

/** "$4.00": a receipt prints cents. */
function cents(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SourceLink({ fee }: { fee: AtmFeeLine }) {
  if (!fee.sourceUrl) return <span>{fee.institutionName}</span>;
  return (
    <a
      href={fee.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
    >
      {fee.institutionName}&apos;s fee schedule
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

/**
 * One out-of-network withdrawal as a receipt: the cash, the machine owner's surcharge and the
 * card holder's bank fee, each from that institution's own published schedule, adding to one
 * total. Labeled "Example" with both institutions named.
 */
export function AtmReceipt({ example }: { example: AtmTwoFeeExample }) {
  const { holder, owner } = example;
  return (
    <figure className="w-full min-w-0 max-w-md rounded-xl border border-border bg-surface-0 shadow-fi-1">
      <figcaption className="border-b border-dashed border-border px-4 py-3 text-[13px] leading-snug text-ink sm:px-5">
        <span className="font-semibold">Example:</span> a {holder.institutionName} customer withdraws cash at a{" "}
        {owner.institutionName} ATM
      </figcaption>
      <dl className="space-y-2.5 px-4 py-4 text-[14px] sm:px-5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="min-w-0 text-ink-soft">Cash withdrawn</dt>
          <dd className="shrink-0 font-mono tabular-nums text-ink">{cents(example.withdrawal)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="min-w-0 text-ink-soft">
            <span aria-hidden="true" className="mr-1 text-ink-muted">+</span>
            {owner.institutionName}&apos;s surcharge for non-customers
            <span className="block text-[12px] text-ink-muted">Shown on the machine&apos;s screen</span>
          </dt>
          <dd className="shrink-0 font-mono tabular-nums text-ink">{cents(owner.amount)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="min-w-0 text-ink-soft">
            <span aria-hidden="true" className="mr-1 text-ink-muted">+</span>
            {holder.institutionName}&apos;s fee for another bank&apos;s ATM
            <span className="block text-[12px] text-ink-muted">On the monthly statement</span>
          </dt>
          <dd className="shrink-0 font-mono tabular-nums text-ink">{cents(holder.amount)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-dashed border-border pt-2.5">
          <dt className="min-w-0 font-semibold text-ink">Two fees</dt>
          <dd className="shrink-0 font-mono font-semibold tabular-nums text-brick">{cents(example.fees)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-ink pt-2.5">
          <dt className="min-w-0 font-semibold text-ink">Taken from the account</dt>
          <dd className="shrink-0 font-mono text-[16px] font-semibold tabular-nums text-ink">{cents(example.total)}</dd>
        </div>
      </dl>
      <div className="border-t border-border px-4 pb-1 pt-3 text-[12px] leading-relaxed text-ink-muted sm:px-5">
        <p>
          Each fee as its institution publishes it. The {cents(example.withdrawal)} withdrawal is an example amount, and a
          shared network or a rebate can remove either fee.
        </p>
        <p className="flex flex-wrap gap-x-4">
          <SourceLink fee={owner} />
          <SourceLink fee={holder} />
        </p>
      </div>
    </figure>
  );
}
