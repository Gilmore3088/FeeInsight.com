import Link from "next/link";
import { InfoTip } from "@/components/public/info-tip";
import { STATE_NAMES } from "@/lib/us-states";
import type { FeeRowDetail } from "@/lib/data-store/fees";
import type { FeeEvidence } from "@/lib/data-store/fee-evidence";
import { accountName, chargedWhen, countedAs, money, type IndexInstitution } from "./index-view";

const READ = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export interface ListedPrice {
  id: number;
  amount: number;
  detail: FeeRowDetail | null;
  /** The schedule's line that prints this price and the account above it; null (or missing) is unverified. */
  evidence: FeeEvidence | null;
}

export function InstitutionRow({
  inst,
  prices,
  counted,
}: {
  inst: IndexInstitution;
  prices: ListedPrice[];
  /** How the Index counts the institution: its median published price, or the highest for overdraft. */
  counted: ReturnType<typeof countedAs>;
}) {
  // One entry per distinct price and wording; the same line read twice is one price.
  const seen = new Set<string>();
  const listed = [...prices]
    .sort((a, b) => a.amount - b.amount || a.id - b.id)
    .filter((p) => {
      const k = `${p.amount}|${p.detail?.fee_name ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const amounts = [...new Set(listed.map((p) => p.amount))];
  const lo = amounts[0] ?? inst.value;
  const hi = amounts[amounts.length - 1] ?? inst.value;
  const verified = listed.filter((p) => p.evidence).length;
  const accountOf = (p: ListedPrice) => p.evidence?.heading ?? accountName(p.detail?.account ?? null);
  const named = listed.filter((p) => accountOf(p)).length;
  // A median of an even number of prices is often none of them; say so rather than let it read as a price.
  const notAPrice = amounts.length > 1 && !amounts.includes(inst.value);
  const first = listed[0]?.detail ?? null;
  const readOn = first?.read_on ?? null;
  return (
    <li>
      <details className="px-4 py-3 sm:px-5">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4">
          <span className="min-w-0">
            <span className="font-semibold text-ink">{inst.name}</span>
            <span className="block text-[12px] text-ink-muted">
              {inst.charter === "credit_union" ? "Credit union" : "Bank"}
              {inst.state ? ` · ${STATE_NAMES[inst.state] ?? inst.state}` : ""}
              {readOn ? ` · read ${READ.format(new Date(`${readOn}T00:00:00Z`))}` : ""}
              {verified === 0 ? " · not verified" : verified === listed.length ? " · verified" : ` · ${verified} of ${listed.length} verified`}
              {inst.shared > 0 ? ` · counts once with ${inst.shared} sibling ${inst.shared === 1 ? "charter" : "charters"} on the same schedule` : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-[15px] tabular-nums text-ink">
              {amounts.length > 1 ? `${money(lo)}–${money(hi)}` : money(inst.value)}
            </span>
            {/* Distinct prices, and the schedule lines behind them when one price is printed on several. */}
            <span className="block text-[11px] text-ink-muted">
              {amounts.length} {amounts.length === 1 ? "price" : "prices"}
              {listed.length > amounts.length ? ` · ${listed.length} schedule lines` : ""}
            </span>
            {amounts.length > 1 && (
              <span className="block text-[11px] text-ink-muted">
                {counted.label} {money(inst.value)}
              </span>
            )}
          </span>
        </summary>
        <div className="mt-3 space-y-2 text-[13px] text-ink-soft">
          {amounts.length > 1 && (
            <p className="text-ink-muted">
              Counted once, at {money(inst.value)}, {counted.of} of these prices
              {notAPrice ? "; it isn't one of the published prices." : "."}
            </p>
          )}
          {named === 0 && (
            <div className="flex items-center gap-1 text-[12px] text-ink-muted">
              <span className="rounded-full border border-border px-2 py-0.5">Account mapping unavailable</span>
              <InfoTip label="About account mapping">
                The Index hasn&apos;t yet matched each price to its account in the schedule, so these prices can&apos;t be compared account by account.
              </InfoTip>
            </div>
          )}
          <ul className="divide-y divide-border rounded-xl border border-border bg-paper">
            {listed.map((p) => {
              const d = p.detail;
              const when = chargedWhen(d?.frequency ?? null);
              const account = accountOf(p);
              // The schedule's own waiver wording when it was read; otherwise the condition recorded with the fee.
              const condition = p.evidence?.condition ?? d?.conditions ?? null;
              return (
                <li key={p.id} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <p className="text-ink">
                    <span className="font-mono font-semibold tabular-nums">{money(p.amount)}</span>
                    {when ? <span className="text-ink-muted"> {when}</span> : null}
                  </p>
                  <div className="min-w-0">
                    {(account || named > 0) && (
                      <p className={account ? "font-medium text-ink" : "text-ink-muted"}>{account ?? "Account not stated"}</p>
                    )}
                    {p.evidence ? (
                      <p className="text-[12px] text-ink-muted">
                        &ldquo;{p.evidence.line.replace(/\s*\|\s*/g, " … ").replace(/\s+/g, " ").trim()}&rdquo;
                      </p>
                    ) : (
                      <p className="text-[12px] text-ink-muted" title={`The schedule's line doesn't state ${money(p.amount)}.`}>
                        <span className="font-semibold text-ink">Not verified</span>
                        {d?.fee_name ? <> · &ldquo;{d.fee_name}&rdquo;</> : null}
                      </p>
                    )}
                    {condition && <p className="text-[12px] text-ink-muted">Condition: {condition}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-ink-muted">
            {readOn ? `Read ${READ.format(new Date(`${readOn}T00:00:00Z`))}` : "Read date not recorded"}
            {first?.document_url ? (
              <>
                {" from "}
                <a href={first.document_url} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-ink">
                  its fee schedule
                </a>
              </>
            ) : null}
            {" · "}
            <Link href={`/institution/${inst.id}`} className="underline decoration-border underline-offset-2 hover:decoration-ink">
              All its fees
            </Link>
          </p>
        </div>
      </details>
    </li>
  );
}
