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
            label="Benchmark with the Bank Fee Index"
          />,
          <AnalyzeDemo
            key="analyze"
            scenario={scenario}
            label="Analyze with Hamilton Intelligence"
          />,
          <MonitorPreview
            key="monitor"
            changes={changes}
            wire={null}
            label="Monitor with Fee Insight Alerts"
          />,
          <ReportPreview
            key="report"
            label="Report to your board with confidence"
          />,
        ]}
      />
    </ShowcaseProvider>
  );
}
