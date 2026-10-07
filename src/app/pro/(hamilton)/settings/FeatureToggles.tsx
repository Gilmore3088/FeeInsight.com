"use client";

import Link from "next/link";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { SERIF } from "@/components/hamilton/memo/memo";

const FEATURES = [
  {
    key: "benchmarking",
    label: "This month",
    href: "/pro/hamilton",
    description: "Where your fees sit against peer medians, with the number of institutions behind each one.",
  },
  {
    key: "analysis",
    label: "Ask Hamilton",
    href: "/pro/analyze",
    description: "Ask about any bank or credit union; every figure is checked against the data it came from.",
  },
  {
    key: "scenario_modeling",
    label: "Try a price",
    href: "/pro/simulate",
    description: "See where a different fee would land among your peers, and save it for a board summary.",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/pro/reports",
    description: "Board-ready reports written from your bank's verified fee schedule.",
  },
  {
    key: "market_monitor",
    label: "All changes",
    href: "/pro/monitor",
    description: "Alerts when a bank you watch changes its published fees.",
  },
];

interface FeatureTogglesProps {
  selectedInstitutionId?: string | null;
}

export function FeatureToggles({ selectedInstitutionId = null }: FeatureTogglesProps) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FEATURES.map((feature) => (
        <li key={feature.key}>
          <Link
            href={hrefWithInstitutionContext(feature.href, selectedInstitutionId)}
            className="group block h-full rounded-lg border border-warm-300 bg-warm-50 px-4 py-3 no-underline transition-colors hover:border-warm-500"
          >
            <span className="block text-base text-warm-900 group-hover:text-terra-text" style={SERIF}>
              {feature.label}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-warm-700">{feature.description}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
