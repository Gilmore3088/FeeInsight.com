"use client";

import Link from "next/link";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { SERIF } from "@/components/hamilton/memo/memo";
import { PRO_WORKSPACE_FEATURES } from "@/lib/hamilton/pro-features";

interface FeatureTogglesProps {
  selectedInstitutionId?: string | null;
}

export function FeatureToggles({ selectedInstitutionId = null }: FeatureTogglesProps) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {PRO_WORKSPACE_FEATURES.map((feature) => (
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
