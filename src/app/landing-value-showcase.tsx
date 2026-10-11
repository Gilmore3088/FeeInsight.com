"use client";

import { ShowcaseProvider, ShowcaseStage } from "@/app/subscribe/showcase";
import { BenchmarkPreview, type BenchmarkRow } from "@/app/subscribe/benchmark-preview";
import { AnalyzeDemo, type AnalyzeScenario } from "@/app/subscribe/analyze-demo";
import { MonitorPreview, ReportPreview, type MonitorChange } from "@/app/subscribe/example-panels";

export function LandingValueShowcase({
  rows,
  totalInstitutions,
  scenario,
  changes,
}: {
  rows: BenchmarkRow[];
  totalInstitutions: number;
  scenario: AnalyzeScenario;
  changes: MonitorChange[];
}) {
  return (
    <ShowcaseProvider autoCycle entry="homepage">
      <ShowcaseStage
        panels={[
          <BenchmarkPreview
            key="benchmark"
            institution={null}
            rows={rows}
            totalInstitutions={totalInstitutions}
          />,
          <AnalyzeDemo key="analyze" scenario={scenario} />,
          <MonitorPreview key="monitor" changes={changes} wire={null} />,
          <ReportPreview key="report" />,
        ]}
      />
    </ShowcaseProvider>
  );
}
