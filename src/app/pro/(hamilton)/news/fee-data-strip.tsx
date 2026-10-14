import Link from "next/link";
import { formatAmount } from "@/lib/format";
import { formatWireDate } from "@/lib/regulatory/wire";
import type { FeeDataStrip as Strip } from "@/lib/regulatory/wire-fee-links";

/**
 * "In the fee data": the published figures behind a wire item's fee type, with links into
 * the existing Pro and report pages. The figures are the index's own (published_fee_catalog
 * dollar fees, the statistics contract's median), shown as they are; a category with no
 * published fee says so and shows no number. The scenario link is always labelled as an
 * exercise, and the note says the figures describe the market, not what to charge.
 */
export function FeeDataStrip({ strip, example = false, now }: { strip: Strip; example?: boolean; now: Date }) {
  const asOf = strip.asOf ? formatWireDate(strip.asOf, now)?.absolute ?? null : null;
  return (
    <section aria-label="In the fee data" className="rounded-lg border border-warm-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-600" style={{ fontFamily: "var(--hamilton-font-sans)" }}>
        {example ? "EXAMPLE figures · " : ""}In the fee data · {strip.scope === "state" ? strip.place : "National"}
      </p>
      <dl className="mt-1.5 space-y-1.5">
        {strip.figures.map((figure) => (
          <div key={figure.category} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[10rem_1fr]">
            <dt className="text-[12px] font-semibold text-warm-900">
              <Link href={figure.href} className="no-underline hover:text-[#A93D25]">
                {figure.label}
              </Link>
            </dt>
            <dd
              className={`text-[12px] leading-snug [font-variant-numeric:tabular-nums] ${
                figure.status === "median" ? "text-warm-900" : "text-warm-600"
              }`}
            >
              {figure.status === "median" ? (
                <>
                  <strong className="font-semibold">{formatAmount(figure.median)} median</strong>
                  <span className="text-warm-600">
                    {" "}
                    · {figure.institutions.toLocaleString("en-US")} {figure.institutions === 1 ? "institution" : "institutions"} with a published fee
                  </span>
                </>
              ) : (
                figure.text
              )}
            </dd>
          </div>
        ))}
      </dl>

      <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
        {strip.links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="font-semibold text-[#A93D25] no-underline underline-offset-2 hover:underline">
              {link.label} →
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-2 border-t border-dashed border-warm-200 pt-2 text-[12px]">
        <Link href={strip.scenario.href} className="font-semibold text-warm-900 underline decoration-warm-300 underline-offset-2 hover:text-[#A93D25]">
          {strip.scenario.label} →
        </Link>
        <span className="block text-[11px] text-warm-600 sm:ml-2 sm:inline">{strip.scenario.caption}</span>
      </p>

      <p className="mt-1.5 text-[10px] leading-relaxed text-warm-600">
        {example
          ? "Preview figures labelled EXAMPLE; see the caption for where they came from."
          : `Published dollar fees from each institution's own fee schedule${asOf ? `, last published ${asOf}` : ""}. A median needs 5 institutions.`}{" "}
        These figures describe the market; they are not a view on what any institution should charge.
      </p>
    </section>
  );
}
