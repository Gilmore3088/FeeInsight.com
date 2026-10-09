import type { ReactNode } from "react";
import {
  CONSULTANT_PRICE_NOTE,
  PRO_TIERS,
  tierAmountLabel,
  tierPriceLabel,
  type ProPlan,
} from "@/lib/pro-tiers";
import { PLAN_TEAM_LABEL } from "./pricing";
import { PlanCheckout, type ProTierSelection } from "./plan-checkout";

export type { ProTierSelection } from "./plan-checkout";

interface PurchaseCardProps {
  isLoggedIn: boolean;
  /** The institution search, or what was picked. */
  chooser: ReactNode;
  /** Null until a bank, credit union or "other organization" is chosen and priced. */
  selection: ProTierSelection | null;
  returnTo?: string;
  /** The Pro page checkout returns to ("Regulatory Wire"), or null for Hamilton. */
  destination: string | null;
  registerHrefFor: (plan: ProPlan) => string;
  initialPlan: ProPlan | null;
  /** When set (post-signup hand-off), the matching plan starts checkout on mount. */
  autoStartPlan?: ProPlan | null;
  /** Where the buyer came from ("Regulatory Wire", or "direct"), sent with each funnel event. */
  entry: string;
}

const DISPLAY = { fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" };

/**
 * The one place to buy Pro (James, 9 Oct 2026): find the institution, see its one price,
 * pick annual or monthly, subscribe. The tier schedule sits behind "How pricing works".
 */
export function PurchaseCard({
  isLoggedIn,
  chooser,
  selection,
  returnTo,
  destination,
  registerHrefFor,
  initialPlan,
  autoStartPlan = null,
  entry,
}: PurchaseCardProps) {
  return (
    <div className="rounded-2xl bg-white/75 p-6 backdrop-blur-xl ring-1 ring-[#E2E8F0]/80 shadow-[0_12px_40px_-12px_rgba(30,41,59,0.25),inset_0_1px_0_rgba(255,255,255,0.7)] sm:p-7">
      <h2 id="pro-heading" className="scroll-mt-24 text-xl text-[#1E293B] font-semibold tracking-tight" style={DISPLAY}>
        Fee Insight Pro
      </h2>
      {!selection && (
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="text-sm text-[#475569]">From</span>
          <span className="text-3xl font-semibold text-[#1E293B] tabular-nums" style={DISPLAY}>
            {tierAmountLabel(PRO_TIERS[0].key, "monthly")}
          </span>
          <span className="text-sm text-[#475569]">/ month {PLAN_TEAM_LABEL}</span>
        </p>
      )}
      {!selection && <p className="mt-1 text-sm font-medium text-[#1E293B]">Same features at every institution size.</p>}

      <div className="mt-5">{chooser}</div>

      {selection && (
        <div className="mt-5 border-t border-[#E2E8F0] pt-5">
          <PlanCheckout
            selection={selection}
            isLoggedIn={isLoggedIn}
            returnTo={returnTo}
            registerHref={{ annual: registerHrefFor("annual"), monthly: registerHrefFor("monthly") }}
            initialPlan={initialPlan}
            autoStartPlan={autoStartPlan}
            entry={entry}
            destination={destination}
          />
          {selection.otherOrganization && (
            <p className="mt-3 text-xs leading-relaxed text-[#556377]">{CONSULTANT_PRICE_NOTE}</p>
          )}
        </div>
      )}

      <details className="group mt-5 border-t border-[#E2E8F0] pt-4 text-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium text-[#1E293B] marker:content-none">
          How pricing works
          <span aria-hidden className="text-[#556377] transition-transform group-open:rotate-45">+</span>
        </summary>
        <p className="mt-1 leading-relaxed text-[#475569]">
          Every plan has the same full feature set {PLAN_TEAM_LABEL}. The price follows the institution&apos;s total
          assets from its latest call report.
        </p>
        <table className="mt-3 w-full text-left">
          <caption className="sr-only">Pro price by institution size</caption>
          <tbody>
            {PRO_TIERS.map((tier) => (
              <tr key={tier.key} className="border-t border-[#E2E8F0]">
                <th scope="row" className="py-2 pr-3 font-normal text-[#475569]">{tier.assetsLabel}</th>
                <td className="py-2 text-right tabular-nums text-[#1E293B]">
                  {tierPriceLabel(tier.key, "monthly")} or {tierPriceLabel(tier.key, "annual")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs leading-relaxed text-[#556377]">
          If a plan is used for a larger institution, we&apos;ll email you before moving it to that price.{" "}
          {CONSULTANT_PRICE_NOTE}
        </p>
      </details>
    </div>
  );
}
