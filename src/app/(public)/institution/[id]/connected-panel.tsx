import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatCompactDollars } from "@/lib/format";
import { pct } from "./overview-observations";
import { aboutSame, amountText, isRange, lowerLabel, money, reference, type CompareRow } from "./profile-view";
import { SERIF } from "./profile-serif";

/**
 * The connected panel (James's brief, section 6, small version): the call-report income beside
 * three of its published fees against the state median, then the questions those numbers raise.
 * Reported facts, calculated comparisons and open questions are labelled apart; nothing here
 * concludes a cause. Its one Hamilton action opens the institution's peer sets for now.
 */

/** Everyday fees first, in the order a reader looks for them. */
const RELATED = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "foreign_atm", "stop_payment", "wire_domestic_outgoing"];

export function pickRelatedFees(rows: CompareRow[], n = 3): CompareRow[] {
  const priced = rows.filter((r) => r.amount != null && reference(r));
  const rank = (r: CompareRow) => {
    const i = RELATED.indexOf(r.key);
    return i === -1 ? RELATED.length : i;
  };
  return [...priced].sort((a, b) => rank(a) - rank(b)).slice(0, n);
}

/**
 * The small line under a fee listed at several prices: the comparison price named for what it
 * is, then the gap. "Compared at $8.45, the middle of its two prices: $0.95 above".
 */
export function comparedLine(row: CompareRow, gap: string): string | null {
  if (!isRange(row) || row.amount == null) return null;
  const which = row.highestTier ? "the highest of its prices" : `the middle of its ${row.count === 2 ? "two " : ""}prices`;
  return `Compared at ${money(row.amount)}, ${which}: ${gap}`;
}

/** "Monthly maintenance", "Non-network ATM": sentence case, acronyms kept. */
function sentenceLabel(label: string): string {
  const lower = lowerLabel(label);
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function Tag({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{children}</p>;
}

export function ConnectedPanel({
  institutionId,
  stateName,
  stateShort,
  facts,
  share,
  fees,
  incomeName,
}: {
  institutionId: number;
  /** "service-charge income" or "fee income" (feeIncomeTerms), lower case. */
  incomeName: string;
  stateName: string | null;
  stateShort: string | null;
  /** Reported: the latest quarter's income and revenue, as on the cards. */
  facts: Array<{ label: string; value: number; quarter: string }>;
  /** Calculated: its share against the cohort median. */
  share: { own: number; median: number; cohort: string } | null;
  fees: CompareRow[];
}) {
  if (facts.length === 0 && fees.length === 0) return null;
  return (
    <section aria-labelledby="connected-heading" className="rounded-xl border border-border bg-surface-0 p-4 sm:p-6">
      <h3 id="connected-heading" className="text-[22px] font-medium leading-tight text-ink sm:text-[26px]" style={SERIF}>
        Income and prices, side by side
      </h3>
      <div className="mt-5 grid gap-6 md:grid-cols-3">
        <div className="min-w-0">
          <Tag>Reported</Tag>
          <dl className="mt-2 space-y-2 [font-variant-numeric:tabular-nums]">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-[13px] text-ink-muted">
                  {f.label}, {f.quarter}
                </dt>
                <dd className="text-[18px] font-semibold text-ink">{formatCompactDollars(f.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0">
          <Tag>Compared</Tag>
          <ul className="mt-2 space-y-2 text-[14px] [font-variant-numeric:tabular-nums]">
            {share && (
              <li>
                <span className="font-semibold text-ink">{pct(share.own)}</span>
                <span className="text-ink-soft"> of revenue vs {pct(share.median)} median, {share.cohort}</span>
              </li>
            )}
            {fees.map((row) => {
              const ref = reference(row);
              if (!ref || row.amount == null) return null;
              const place = ref.level === "state" ? (stateShort ?? stateName ?? "state") : "U.S.";
              const diff = row.amount - ref.median.median;
              const gap = aboutSame(row.amount, ref.median.median)
                ? "about the same"
                : `${money(Math.abs(diff))} ${diff > 0 ? "above" : "below"}`;
              // Several prices: the headline shows them all and the small line names the comparison price.
              const compared = comparedLine(row, gap);
              return (
                <li key={row.key}>
                  <span className="font-semibold text-ink">
                    {sentenceLabel(row.label)} {amountText(row)}
                  </span>
                  <span className="text-ink-soft">
                    {" "}
                    vs {place} {money(ref.median.median)}
                    {compared ? "" : ` (${gap})`}
                  </span>
                  {compared && <span className="block text-[12px] text-ink-muted">{compared}</span>}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="min-w-0">
          <Tag>Open questions</Tag>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[14px] leading-snug text-ink-soft">
            <li>Which fees and accounts make up its {incomeName}?</li>
            <li>How much of any gap to the median comes from account volume rather than price?</li>
            <li>How often are these fees waived or refunded?</li>
          </ul>
        </div>
      </div>
      <div className="mt-6 border-t border-border pt-4">
        <Link
          href={`/pro/settings?instId=${institutionId}#peer-sets`}
          className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium text-ink underline decoration-border underline-offset-[6px] hover:decoration-ink"
        >
          Analyze the drivers of {incomeName} in Hamilton
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  );
}
