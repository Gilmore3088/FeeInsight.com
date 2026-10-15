import { Calculator, FileText, Landmark, MessageCircle, Newspaper, Users } from "lucide-react";
import { AppIcon } from "@/brand/components";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";
import { ProductDemo, type DemoView } from "@/components/marketing/product-demo";
import { TrackLink } from "@/components/track-link";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { demoViews } from "@/app/landing-demo";
import type { HomeData } from "@/app/landing-shared";
import { WirePreview, type WirePreviewLead } from "./pro-overview";

const DISPLAY = { fontFamily: "var(--fi-font-sans)" };

/** What every plan includes: the workspace's own screen names (HAMILTON_WORKSPACE_NAV), one line each. */
export const PLAN_INCLUDES = [
  { icon: Landmark, label: "Your institution", line: "Each fee against your market" },
  { icon: MessageCircle, label: "Ask Hamilton", line: "Answers with a chart and a source" },
  { icon: Calculator, label: "Try a price", line: "Model a fee before committee" },
  { icon: FileText, label: "Reports", line: "Briefs for the board and committee" },
  { icon: Newspaper, label: "Regulatory Wire", line: "Fee rules and bills, beside the data" },
  { icon: Users, label: `Up to ${WORKSPACE_SEAT_LIMIT} people`, line: "Each with their own login" },
] as const;

export function PlanIncludes() {
  return (
    <section aria-labelledby="plan-includes-heading" className="mt-10">
      <h2 id="plan-includes-heading" className="text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Every plan includes
      </h2>
      <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        {PLAN_INCLUDES.map(({ icon: Icon, label, line }) => (
          <li key={label} className="flex min-w-0 flex-col items-center text-center">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-200 text-ink">
              <Icon size={18} strokeWidth={1.75} />
            </span>
            <p className="mt-2 text-sm font-semibold text-ink">{label}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{line}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The homepage's views, then the Regulatory Wire item when one was read; empty without live figures. */
export function plansExhibitViews(data: HomeData, wire: WirePreviewLead | null): DemoView[] {
  if (!data.overdraft || data.lines.length === 0) return [];
  const views = demoViews(data);
  if (wire) {
    views.push({
      key: "wire",
      label: "Regulatory Wire",
      short: "Wire",
      view: (
        <div className="p-4 sm:p-6">
          <WirePreview lead={wire} />
        </div>
      ),
    });
  }
  return views;
}

/**
 * The product beside the price: the homepage's Hamilton window (district map, the sample bank's
 * fees, Try a price, Reports) plus the Wire, every figure read live. The Pro demo request is the
 * section's one action, the page's second action after subscribing.
 */
export function PlansExhibit({ data, wire }: { data: HomeData; wire: WirePreviewLead | null }) {
  const views = plansExhibitViews(data, wire);
  if (views.length === 0) return null;
  return (
    <section aria-labelledby="plans-exhibit-heading" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Inside Hamilton</p>
          <h2 id="plans-exhibit-heading" className="mt-3 text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[2.5rem]" style={DISPLAY}>
            The workspace your plan opens
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">Live figures from published fee schedules. Open each view.</p>
        </div>
        <TrackLink
          event="contact_sales"
          eventProps={{ placement: "pricing_exhibit_demo" }}
          href={DEMO_REQUEST_NAV.href}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-ink px-5 text-sm font-semibold text-ink hover:bg-ink hover:text-on-ink"
        >
          {DEMO_REQUEST_NAV.standaloneLabel}
        </TrackLink>
      </div>
      <div className="mt-8">
        <ProductDemo
          label="Hamilton views"
          mark={
            <>
              <AppIcon brand="hamilton" size={22} title="" />
              <span className="hidden sm:inline">Hamilton</span>
            </>
          }
          views={views}
        />
      </div>
    </section>
  );
}
