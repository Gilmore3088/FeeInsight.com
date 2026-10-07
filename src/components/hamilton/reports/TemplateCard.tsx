"use client";

import type { ReportTemplateType } from "@/app/pro/(hamilton)/reports/actions";
import { SERIF } from "@/components/hamilton/memo/memo";

interface TemplateCardProps {
  type: ReportTemplateType;
  title: string;
  description: string;
  isSelected: boolean;
  onClick: () => void;
}

export function TemplateCard({ title, description, isSelected, onClick }: TemplateCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={onClick}
      className={
        "flex w-full flex-col rounded-lg border p-5 text-left transition-colors " +
        (isSelected
          ? "border-terra bg-terra-soft"
          : "border-warm-300 bg-warm-50 hover:border-warm-500")
      }
    >
      <span className="text-lg leading-snug text-warm-900" style={SERIF}>
        {title}
      </span>
      <span className="mt-1.5 text-sm leading-relaxed text-pretty text-warm-700">{description}</span>
      {isSelected ? <span className="mt-3 text-xs font-medium text-terra-text">Selected</span> : null}
    </button>
  );
}
