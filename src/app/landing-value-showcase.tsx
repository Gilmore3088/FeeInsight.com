"use client";

import { useEffect, useState } from "react";
import { Play, Pause, BarChart3, Search, Activity, FileText } from "lucide-react";

import { ShowcaseProvider, ShowcaseStage, useShowcase } from "@/app/subscribe/showcase";
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
    <ShowcaseProvider autoCycle={false} entry="homepage">
      <WalkthroughControls />
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
          <ReportPreview
            key="report"
            label="Report to your board with confidence"
          />,
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

function WalkthroughControls() {
  const { active, choose, paused } = useShowcase();
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || paused) return;
    const timer = window.setTimeout(() => choose((active + 1) % CHAPTERS.length), 6000);
    return () => window.clearTimeout(timer);
  }, [playing, paused, active, choose]);
  return <div className="mb-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-[.12em] text-[#A93D25]">Inside Hamilton</span>
      <button type="button" onClick={() => setPlaying(!playing)} aria-pressed={playing}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#E0D7C9] bg-white/70 px-3 text-xs font-semibold">
        {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
        {playing ? "Pause walkthrough" : "Play walkthrough"}
      </button>
    </div>
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Walkthrough chapters">
      {CHAPTERS.map((chapter, i) => { const Icon=chapter.icon; return <button key={chapter.label} type="button"
        aria-pressed={active===i} onClick={() => {setPlaying(false);choose(i);}}
        className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-semibold ${active===i ? "border-[#C44B2E] bg-[#FDF0ED] text-[#A93D25]" : "border-[#E0D7C9] bg-white/60 text-[#5A5347]"}`}>
        <Icon size={18} aria-hidden />{chapter.label}
      </button>;})}
    </div>
    <p className="mt-3 text-sm text-[#5A5347]">{CHAPTERS[active].caption}</p>
  </div>;
}
