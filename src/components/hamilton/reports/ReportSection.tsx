import { SERIF } from "@/components/hamilton/memo/memo";

interface ReportSectionProps {
  heading: string;
  children: React.ReactNode;
  ariaLabel?: string;
}

export function ReportSection({ heading, children, ariaLabel }: ReportSectionProps) {
  return (
    <section aria-label={ariaLabel ?? heading} className="border-b border-warm-200 py-7 last:border-b-0">
      <h3 className="mb-3 text-xl leading-snug text-warm-900" style={SERIF}>
        {heading}
      </h3>
      {children}
    </section>
  );
}
