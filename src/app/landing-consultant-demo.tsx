"use client";
import { useState } from "react";
import { ArrowRight, FileText, Search, Sparkles } from "lucide-react";
import { BenchmarkPreview, type BenchmarkRow } from "./subscribe/benchmark-preview";
import { LandingLeadAction } from "./landing-lead-action";
import { H2, GLASS, CTA_SECONDARY } from "@/components/public/site-look";

const STAGES = ["Ask a question", "Explore the answer", "Create the report"];
export function LandingConsultantDemo({ rows, totalInstitutions }: { rows: BenchmarkRow[]; totalInstitutions: number }) {
  const [stage,setStage]=useState(0);
  const choose=(n:number)=>setStage(n);
  return <section aria-labelledby="consultant-demo-title" className="mx-auto max-w-page px-6 py-14 sm:py-20">
    <div className="mb-8 text-center"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#A93D25]">Meet Hamilton</p><h2 id="consultant-demo-title" className={`mt-3 ${H2}`}>A question becomes a sourced answer.<br />Then a report you can share.</h2></div>
    <div className={`overflow-hidden ${GLASS}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E0D7C9] px-5 py-4"><strong>Hamilton</strong><span className="text-xs text-[#6B6255]">Interactive example · national benchmark figures</span></div>
      <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[.35fr_1fr]">
        <div className="flex flex-row gap-2 lg:flex-col" role="group" aria-label="Question to report example">{STAGES.map((text,i)=><button key={text} type="button" aria-pressed={stage===i} onClick={()=>choose(i)} className={`flex min-h-14 flex-1 items-center gap-3 rounded-xl border px-3 py-3 text-left text-xs sm:text-sm ${stage===i?"border-[#C44B2E] bg-[#FDF0ED] text-[#A93D25]":"border-[#E0D7C9] bg-white/60 text-[#5A5347]"}`}><span className="hidden text-xs sm:block">0{i+1}</span>{text}</button>)}</div>
        <div className="min-w-0">
          {stage===0 ? <div className="flex min-h-96 flex-col justify-center rounded-xl bg-[#FAF7F2] p-6 sm:p-10"><Search size={30} aria-hidden className="text-[#A93D25]" /><h3 className="mt-5 text-2xl font-semibold">Start with your team’s question.</h3><div className="mt-6 rounded-xl border border-[#E0D7C9] bg-white p-5 text-lg">“What do banks and credit unions charge nationally?”</div><button type="button" onClick={()=>choose(1)} className="mt-5 inline-flex min-h-11 items-center gap-2 self-start rounded-lg bg-[#C44B2E] px-5 text-sm font-semibold text-white">Show the example answer <ArrowRight size={16} aria-hidden /></button></div> : stage===1 ? <div className="min-h-96"><div className="mb-4 flex items-start gap-3"><Sparkles size={22} aria-hidden className="shrink-0 text-[#A93D25]" /><div><h3 className="text-xl font-semibold">The comparison, with context.</h3><p className="mt-1 text-sm text-[#6B6255]">Inspect the fees, account terms, and source dates before drawing a conclusion.</p></div></div><BenchmarkPreview institution={null} rows={rows} totalInstitutions={totalInstitutions} label="Supporting exhibit · national published-fee medians" /><button type="button" onClick={()=>choose(2)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#C44B2E] px-5 text-sm font-semibold text-white"><FileText size={17} aria-hidden />Create report preview</button></div> : <div className="rounded-xl bg-[#F3EEE6] p-5 sm:p-8"><div className="mx-auto max-w-xl border-t-4 border-[#C44B2E] bg-white p-6 shadow-lg sm:p-8"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#A93D25]">Hamilton · Report preview</p><h3 className="mt-4 text-3xl font-semibold tracking-tight">National fee review</h3><p className="mt-3 text-sm text-[#6B6255]">Published fee medians across the national market. Review account terms and waivers alongside each comparison.</p><div className="mt-6 grid grid-cols-3 gap-3">{rows.slice(0,3).map(row=><div key={row.category} className="rounded-lg bg-[#FAF7F2] p-3"><span className="block text-xs text-[#6B6255]">{row.label}</span><strong className="mt-2 block text-xl text-[#A93D25]">${row.median.toFixed(2)}</strong></div>)}</div><h4 className="mt-6 text-sm font-semibold">Supporting evidence</h4><table className="mt-3 w-full text-left text-xs"><thead><tr className="border-b border-[#E0D7C9]"><th className="py-2">Category</th><th>Median (USD)</th><th>Institutions</th></tr></thead><tbody>{rows.slice(0,3).map(row=><tr key={row.category} className="border-b border-[#E8E1D6]"><td className="py-3">{row.label}</td><td>${row.median.toFixed(2)}</td><td>{row.institutions.toLocaleString()}</td></tr>)}</tbody></table><p className="mt-5 text-xs text-[#6B6255]">Source: Fee Insight published-fee benchmark. National scope. The same example figures are carried into this report preview.</p></div></div>}

        </div>
      </div>
    </div>
    <div className="mt-7 flex justify-center"><LandingLeadAction offer="walkthrough" className={CTA_SECONDARY} /></div>
  </section>;
}
