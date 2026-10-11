import { Search, Globe, FileText, Table2, Landmark, Presentation, ArrowRight, Check } from "lucide-react";
import { GLASS, H2 } from "@/components/public/site-look";

const STEPS = [
  { icon: Search, name: "Google your market", detail: "Find nearby banks and credit unions" },
  { icon: Globe, name: "Visit competitor sites", detail: "Search product and disclosure pages" },
  { icon: FileText, name: "Collect fee schedules", detail: "Track documents, dates, and sources" },
  { icon: Table2, name: "Reconcile a spreadsheet", detail: "Compare terms, channels, and waivers" },
  { icon: Landmark, name: "Gather the context", detail: "Read filings and economic research" },
  { icon: Presentation, name: "Prepare the review", detail: "Turn the findings into board material" },
];

export function LandingResearchStory() {
  return <section aria-labelledby="research-story-title" className="border-y border-[#E8E1D6] bg-[#F3EEE6]/60">
    <div className="mx-auto max-w-page px-6 py-12 sm:py-16">
      <div className="mb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#A93D25]">The work behind a fee review</p>
        <h2 id="research-story-title" className={`mt-3 ${H2}`}>Your research is spread across the web.</h2>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STEPS.map((step,i) => { const Icon=step.icon; return <li key={step.name} className="rounded-xl border border-[#E0D7C9] bg-white/60 p-4 sm:p-5">
            <div className="mb-5 flex items-center justify-between"><Icon size={25} strokeWidth={1.5} className="text-[#6B6255]" aria-hidden /><span className="text-xs text-[#6B6255]">0{i+1}</span></div>
            <h3 className="text-sm font-semibold text-[#1A1815]">{step.name}</h3>
            <p className="mt-2 text-xs leading-relaxed text-[#6B6255]">{step.detail}</p>
          </li>;})}
        </ol>
        <div className={`flex flex-col p-6 sm:p-8 ${GLASS}`}>
          <span className="text-xs font-semibold uppercase tracking-[.12em] text-[#A93D25]">Connected in Hamilton</span>
          <h3 className="mt-4 text-2xl font-semibold tracking-tight">One question. A sourced review.</h3>
          <div className="mt-6 rounded-xl border border-[#E0D7C9] bg-[#FAF7F2] p-4 text-sm leading-relaxed">“How do our wire and maintenance fees compare with local competitors?”</div>
          <ul className="my-6 space-y-4 text-sm">
            {["Named peers and fee comparisons", "Relevant financial and market context", "Source links and reporting dates", "Findings ready to reuse in a report"].map(text=><li key={text} className="flex items-start gap-3"><Check size={18} className="shrink-0 text-[#A93D25]" aria-hidden />{text}</li>)}
          </ul>
          <a href="#hamilton-walkthrough" className="mt-auto inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#A93D25]">Explore the walkthrough <ArrowRight size={16} aria-hidden /></a>
        </div>
      </div>
    </div>
  </section>;
}
