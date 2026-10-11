"use client";

import { BarChart3, Search, Activity, FileText } from "lucide-react";

import { ShowcaseProvider, ShowcaseStage, useShowcase } from "@/app/subscribe/showcase";
import { LandingReportDocument } from "./landing-report-document";
import { BenchmarkPreview, type BenchmarkRow } from "@/app/subscribe/benchmark-preview";
import { AnalyzeDemo, type AnalyzeScenario } from "@/app/subscribe/analyze-demo";
import { MonitorPreview, type MonitorChange } from "@/app/subscribe/example-panels";

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
      <ExampleTabs />
      <ShowcaseStage
        panels={[
          <BenchmarkPreview
            key="benchmark"
            institution={null}
            label="Benchmark with the Bank Fee Index"
            rows={rows}
            totalInstitutions={totalInstitutions}
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
          <LandingReportDocument key="report" compact />,
        ]}
      />
    </ShowcaseProvider>
  );
}


const CHAPTERS = [
  { label: "Benchmark", caption: "Put published fees in market context.", icon: BarChart3 },
  { label: "Analyze", caption: "Explore a question and inspect the comparison.", icon: Search },
  { label: "Monitor", caption: "Follow the institutions that matter to your team.", icon: Activity },
  { label: "Report", caption: "Bring the research into a brief you can share.", icon: FileText },
];

function ExampleTabs() {
  const { active, choose } = useShowcase();
  return <div className="mb-4">
    <p className="mb-3 text-xs font-semibold uppercase tracking-[.12em] text-[#A93D25]">Inside Hamilton</p>
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Product examples">
      {CHAPTERS.map((chapter, i) => { const Icon=chapter.icon; return <button key={chapter.label} type="button"
        aria-pressed={active===i} onClick={() => choose(i)}
        className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-semibold ${active===i ? "border-[#C44B2E] bg-[#FDF0ED] text-[#A93D25]" : "border-[#E0D7C9] bg-white/60 text-[#5A5347]"}`}>
        <Icon size={18} aria-hidden />{chapter.label}
      </button>;})}
    </div>
    <p className="mt-3 text-sm text-[#5A5347]">{CHAPTERS[active].caption}</p>
  </div>;
}
