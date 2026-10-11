import type { ReactNode } from "react";
export function EvidenceDetails({ source, period, geography, coverage, method, children }: {
  source: string; period: string; geography: string; coverage: string; method: string; children?: ReactNode;
}) {
  return <details className="intelligence-evidence"><summary>Source, coverage & method</summary>
    <dl>{Object.entries({ Source: source, Period: period, Geography: geography, Coverage: coverage, Method: method }).map(([label, value]) => <div className="contents" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {children}
  </details>;
}
