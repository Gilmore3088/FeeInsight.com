"use client";

import Link from "next/link";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";

const FEATURES = [
  {
    key: "analysis",
    label: "Analyze",
    status: "Included",
    href: "/pro/analyze",
    description: "Ask Hamilton about any institution; every figure is checked against the data it used.",
  },
  {
    key: "benchmarking",
    label: "Benchmark",
    status: "Included",
    href: "/pro/hamilton",
    description: "Where your fees sit against peer medians, with the number of institutions behind each one.",
  },
  {
    key: "scenario_modeling",
    label: "Scenario",
    status: "Included",
    href: "/pro/simulate",
    description: "Model a fee change against your peers and save it for a board summary.",
  },
  {
    key: "reports",
    label: "Report",
    status: "Included",
    href: "/pro/reports",
    description: "Board-ready reports written from your institution's verified fee evidence.",
  },
  {
    key: "market_monitor",
    label: "Monitor",
    status: "Included",
    href: "/pro/monitor",
    description: "Alerts when a watched institution's published fees change.",
  },
];

interface FeatureTogglesProps {
  selectedInstitutionId?: string | null;
}

export function FeatureToggles({ selectedInstitutionId = null }: FeatureTogglesProps) {
  return (
    <div className="space-y-3">
      {FEATURES.map((feature) => (
        <Link
          key={feature.key}
          href={hrefWithInstitutionContext(feature.href, selectedInstitutionId)}
          className="block rounded-md border px-3 py-2 no-underline transition-colors hover:bg-white"
          style={{
            borderColor: "var(--hamilton-border)",
            backgroundColor: "var(--hamilton-surface-container-lowest, #fffdf9)",
          }}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium" style={{ color: "var(--hamilton-text-primary)" }}>
                {feature.label}
              </span>
              <span className="mt-0.5 block text-xs leading-5" style={{ color: "var(--hamilton-text-tertiary)" }}>
                {feature.description}
              </span>
            </span>
            <span
              className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                borderColor: "var(--hamilton-border)",
                color: "var(--hamilton-text-secondary)",
                backgroundColor: "var(--hamilton-surface-elevated)",
              }}
            >
              {feature.status}
            </span>
          </span>
        </Link>
      ))}
      <p className="text-[10px] leading-4" style={{ color: "var(--hamilton-text-tertiary)" }}>
        Hamilton capabilities are governed by selected institution context, evidence tier, and workspace access.
      </p>
    </div>
  );
}
