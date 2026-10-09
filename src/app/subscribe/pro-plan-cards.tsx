import type { ReactNode } from "react";
import Link from "next/link";
import {
  CONSULTANT_PRICE_NOTE,
  PRO_TIERS,
  tierAmountLabel,
  tierPriceLabel,
  type ProPlan,
} from "@/lib/pro-tiers";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
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

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

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
    <div className="rounded-2xl bg-white p-6 shadow-[0_1px_2px_rgba(26,24,21,0.06),0_12px_32px_-12px_rgba(26,24,21,0.18)] ring-1 ring-[#E8E1D6] sm:p-7">
      <h2 id="pro-heading" className="scroll-mt-24 text-xl text-[#1A1815]" style={SERIF}>
        Fee Insight Pro
      </h2>
      {!selection && (
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="text-sm text-[#3D3833]">From</span>
          <span className="text-3xl font-semibold text-[#1A1815] tabular-nums" style={SERIF}>
            {tierAmountLabel(PRO_TIERS[0].key, "monthly")}
          </span>
          <span className="text-sm text-[#3D3833]">/ month {PLAN_TEAM_LABEL}</span>
        </p>
      )}

      <div className="mt-5">{chooser}</div>

      {selection && (
        <div className="mt-5 border-t border-[#EDE6DB] pt-5">
          <PlanCheckout
            selection={selection}
            isLoggedIn={isLoggedIn}
            returnTo={returnTo}
            registerHref={{ annual: registerHrefFor("annual"), monthly: registerHrefFor("monthly") }}
            initialPlan={initialPlan}
            autoStartPlan={autoStartPlan}
            entry={entry}
          />
          <p className="mt-4 text-sm leading-relaxed text-[#3D3833]">
            {selection.otherOrganization ? `${CONSULTANT_PRICE_NOTE} ` : ""}
            Up to {WORKSPACE_SEAT_LIMIT} people, each with their own login. Cancel anytime from your account. After
            paying you go straight to{" "}
            {destination ?? "Hamilton"}.
          </p>
          <p className="mt-1 text-xs text-[#6B6255]">
            Secure checkout by Stripe. Annual plans are refundable within 14 days. If a plan is used for a larger
            institution, we&apos;ll email you before moving it to that price.{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-[#1A1815]">
              Terms
            </Link>
          </p>
        </div>
      )}

      <details className="group mt-5 border-t border-[#EDE6DB] pt-4 text-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium text-[#1A1815] marker:content-none">
          How pricing works
          <span aria-hidden className="text-[#6B6255] transition-transform group-open:rotate-45">+</span>
        </summary>
        <p className="mt-1 leading-relaxed text-[#3D3833]">
          Every plan has the same full feature set {PLAN_TEAM_LABEL}. The price follows the institution&apos;s total
          assets from its latest call report.
        </p>
        <table className="mt-3 w-full text-left">
          <caption className="sr-only">Pro price by institution size</caption>
          <tbody>
            {PRO_TIERS.map((tier) => (
              <tr key={tier.key} className="border-t border-[#EDE6DB]">
                <th scope="row" className="py-2 pr-3 font-normal text-[#3D3833]">{tier.assetsLabel}</th>
                <td className="py-2 text-right tabular-nums text-[#1A1815]">
                  {tierPriceLabel(tier.key, "monthly")} or {tierPriceLabel(tier.key, "annual")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs leading-relaxed text-[#6B6255]">{CONSULTANT_PRICE_NOTE}</p>
      </details>
    </div>
  );
}
