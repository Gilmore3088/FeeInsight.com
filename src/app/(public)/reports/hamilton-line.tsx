import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { SITE_NAME } from "@/lib/constants";
import { hamiltonFullName } from "@/lib/subscribe-reason";

/**
 * The one quiet line on /reports that points on to Pro (site v3 brief 03 §4, 05 §5; growth OS
 * review M1). The report stays the lead; this reuses the paid report's own close
 * (market-report/[token]/hamilton-close.tsx): a snapshot here, kept current in Hamilton.
 * `firstMention` gives Hamilton its full name; `tone="dark"` sits on the navy closing band.
 */
export function HamiltonLine({
  placement,
  firstMention = false,
  tone = "light",
  className = "",
}: {
  placement: string;
  firstMention?: boolean;
  tone?: "light" | "dark";
  className?: string;
}) {
  const dark = tone === "dark";
  const plansClass = dark
    ? "font-semibold text-white underline underline-offset-2"
    : "font-semibold text-ink underline underline-offset-2 hover:text-brick";
  const demoClass = dark
    ? "font-medium text-white underline underline-offset-2"
    : "font-medium text-brick underline underline-offset-2";
  return (
    <p className={`text-[13px] leading-relaxed ${dark ? "text-[#C9BFB1]" : "text-ink-soft"} ${className}`}>
      The report is a snapshot. {firstMention ? hamiltonFullName(SITE_NAME) : "Hamilton"}
      {firstMention ? "," : ""} keeps your market current.{" "}
      <TrackLink event="upgrade_click" eventProps={{ placement }} href={`${PRO_PLANS_NAV.href}#pro`} className={plansClass}>
        {PRO_PLANS_NAV.label}
      </TrackLink>
      <span aria-hidden="true"> · </span>
      <TrackLink
        event="contact_sales"
        eventProps={{ placement: `${placement}_demo` }}
        href={DEMO_REQUEST_NAV.href}
        className={demoClass}
      >
        {DEMO_REQUEST_NAV.label}
      </TrackLink>
    </p>
  );
}
