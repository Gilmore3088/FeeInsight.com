import Link from "next/link";
import { InfoTip } from "@/components/public/info-tip";
import { STATE_NAMES } from "@/lib/us-states";
import { feeScheduleUrls } from "@/lib/own-fee";
import { chargedWhen, countedAs, money, type IndexInstitution } from "./index-view";
import { listedPriceLines, type ListedPrice } from "./listed-prices";
export type { ListedPrice } from "./listed-prices";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function recordedDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:\b|T)/.test(value)) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? DATE.format(date) : null;
}
const audience = (value: string | null) => ({ consumer: "Consumer", business: "Business", both: "Consumer and business" })[value ?? ""] ?? "Audience not recorded";

function PriceSource({ price: p }: { price: ListedPrice }) {
  const urls = feeScheduleUrls([p.detail?.document_url ?? "", p.detail?.source_url ?? ""]);
  const date = recordedDate(p.detail?.read_on);
  const textDate = recordedDate(p.evidence?.text_artifact?.recordedAt);
  return (
    <li>
      <p>Record #{p.id}{date ? ` · Recorded publication ${date}` : " · Publication date unavailable"}</p>
      {urls.length ? (
        <ul>{urls.map((url, i) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noopener noreferrer" className="break-all underline decoration-border underline-offset-2 hover:decoration-ink">
              {urls.length === 1 ? "Recorded fee schedule" : `Recorded fee schedule ${i + 1}`}
            </a>
          </li>
        ))}</ul>
      ) : <p>Source link unavailable</p>}
      {p.evidence ? (
        <div>
          <p className="font-medium">Matched stored price context</p>
          <p>&ldquo;{p.evidence.line.replace(/\s*\|\s*/g, " … ").replace(/\s+/g, " ").trim()}&rdquo;</p>
          {p.evidence.basis === "traced" && p.evidence.heading && <p>Matched text heading: {p.evidence.heading}</p>}
          <p>Relationship to the recorded account and conditions is not established by this match.</p>
          {p.evidence.text_artifact ? (
            <p>Stored text version #{p.evidence.text_artifact.id}{textDate ? ` · recorded ${textDate}` : ""}</p>
          ) : <p>Stored extraction excerpt; original text version unavailable.</p>}
        </div>
      ) : <p>Stored price context unavailable</p>}
    </li>
  );
}

export function InstitutionRow({ inst, prices, counted, category }: {
  inst: IndexInstitution;
  prices: ListedPrice[];
  category: string;
  counted: ReturnType<typeof countedAs>;
}) {
  const lines = listedPriceLines(prices, { institutionId: inst.id, category });
  // The original numerical inputs stay intact. Applicability grouping affects only these notes.
  const amounts = [...new Set(prices.map(p => p.amount))].sort((a, b) => a - b);
  const lo = amounts[0] ?? inst.value, hi = amounts[amounts.length - 1] ?? inst.value;
  const notAPrice = amounts.length > 1 && !amounts.includes(inst.value);
  const matched = lines.flatMap(l => l.observations).filter(p => p.evidence).length;
  return (
    <li>
      <details className="px-4 py-3 sm:px-5">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4">
          <span className="min-w-0">
            <span className="font-semibold text-ink">{inst.name}</span>
            <span className="block text-[12px] text-ink-muted">
              {inst.charter === "credit_union" ? "Credit union" : "Bank"}{inst.state ? ` · ${STATE_NAMES[inst.state] ?? inst.state}` : ""}
              {` · ${matched} of ${prices.length} stored price contexts linked`}
              {inst.shared > 0 ? ` · counts once with ${inst.shared} sibling ${inst.shared === 1 ? "charter" : "charters"} on the same schedule` : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-[15px] tabular-nums text-ink">{amounts.length > 1 ? `${money(lo)}–${money(hi)}` : money(inst.value)}</span>
            <span className="block text-[11px] text-ink-muted">{amounts.length} {amounts.length === 1 ? "price" : "prices"}{lines.length > amounts.length ? ` · ${lines.length} applicability lines` : ""}</span>
            {amounts.length > 1 && <span className="block text-[11px] text-ink-muted">{counted.label} {money(inst.value)}</span>}
          </span>
        </summary>
        <div className="mt-3 space-y-2 text-[13px] text-ink-soft">
          {amounts.length > 1 && <p className="text-ink-muted">Counted once, at {money(inst.value)}, {counted.of} of these prices{notAPrice ? "; it isn't one of the published prices." : "."}</p>}
          <div className="text-[12px] text-ink-muted">
            Applicability is recorded with each fee.
            <InfoTip label="About recorded applicability and price context">A name and amount match in stored text does not establish which account or conditions apply, or whether a fee is current. An unassigned product is unknown.</InfoTip>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border bg-paper">
            {lines.map(line => {
              const d = line.detail, when = chargedWhen(d?.frequency ?? null);
              return <li key={line.key} className="grid gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <p className="text-ink"><span className="font-mono font-semibold tabular-nums">{money(line.amount)}</span>{when ? <span className="text-ink-muted"> {when}</span> : null}</p>
                <div className="min-w-0 space-y-1">
                  <p className={d?.account?.trim() ? "font-medium text-ink" : "text-ink-muted"}>{d ? d.account?.trim() || "Account/product not recorded" : "Recorded applicability unavailable"}</p>
                  {d?.fee_name && <p className="text-[12px] text-ink-muted">{d.fee_name}</p>}
                  {d && <p className="text-[12px] text-ink-muted">{audience(d.fee_audience)}{d.fee_treatment && d.fee_treatment !== "unknown" ? ` · ${d.fee_treatment.replaceAll("_", " ")}` : ""}{d.variant_type ? ` · ${d.variant_type.replaceAll("_", " ")}` : ""}</p>}
                  {d?.conditions && <p className="text-[12px] text-ink-muted">Condition: {d.conditions}</p>}
                  {d && !when && <p className="text-[12px] text-ink-muted">Charging unit not recorded</p>}
                  <ul className="space-y-2 text-[12px] text-ink-muted">
                    {line.observations.map(p => <PriceSource key={p.id} price={p} />)}
                  </ul>
                </div>
              </li>;
            })}
          </ul>
          <p className="text-[12px] text-ink-muted"><Link href={`/institution/${inst.id}`} className="underline decoration-border underline-offset-2 hover:decoration-ink">All its fees</Link></p>
        </div>
      </details>
    </li>
  );
}
