import { Search, Globe, FileText, Table2, Landmark, Clock, Layers, ArrowDown } from "lucide-react";
import { H2 } from "@/components/public/site-look";

/** Three research burdens, shown as distinct visual layers instead of six prose cards. */
export function LandingResearchStory() {
  return <section aria-labelledby="research-story-title" className="border-y border-[#E8E1D6] bg-[#F3EEE6]/60">
    <div className="mx-auto max-w-page px-6 py-14 sm:py-20">
      <div className="mb-9 text-center"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#A93D25]">The work behind a fee review</p><h2 id="research-story-title" className={`mt-3 ${H2}`}>The research takes more than one search.</h2></div>
      <div className="grid gap-5 lg:grid-cols-3">
        <article className="rounded-2xl border border-[#E0D7C9] bg-white/70 p-6"><span className="text-xs font-semibold text-[#A93D25]">01 · MANUAL WORK</span><h3 className="mt-3 text-xl font-semibold">A browser full of research.</h3><div className="mt-6 space-y-3 rounded-xl bg-[#FAF7F2] p-4">
          {[{icon:Search,text:"Google nearby competitors"},{icon:Globe,text:"Visit their websites"},{icon:FileText,text:"Find the fee schedules"},{icon:Table2,text:"Build the comparison sheet"}].map(({icon:Icon,text})=><div key={text} className="flex items-center gap-3 rounded-lg border border-[#E8E1D6] bg-white px-3 py-3 text-sm"><Icon size={17} aria-hidden className="text-[#A93D25]" />{text}</div>)}
        </div><p className="mt-4 text-sm text-[#6B6255]">Collect. Cross-check. Reformat. Repeat.</p></article>
        <article className="rounded-2xl border border-[#E0D7C9] bg-white/70 p-6"><span className="text-xs font-semibold text-[#A93D25]">02 · CONSULTANT-LED STUDIES</span><h3 className="mt-3 text-xl font-semibold">A project for every review.</h3><div className="mt-6 rounded-xl bg-[#FAF7F2] p-5"><Landmark size={30} strokeWidth={1.5} aria-hidden className="text-[#A93D25]" /><ol className="mt-5 space-y-4 text-sm"><li className="border-b border-[#E0D7C9] pb-3">Scope the engagement</li><li className="border-b border-[#E0D7C9] pb-3">Gather surveys and periodic snapshots</li><li className="flex items-center gap-2"><Clock size={16} aria-hidden />Wait for the finished study</li></ol></div><p className="mt-4 text-sm text-[#6B6255]">Budget, scheduling, and a new cycle of work.</p></article>
        <article className="rounded-2xl border border-[#E0D7C9] bg-white/70 p-6"><span className="text-xs font-semibold text-[#A93D25]">03 · DISPARATE SYSTEMS</span><h3 className="mt-3 text-xl font-semibold">Context in different places.</h3><div className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-[#FAF7F2] p-4">{["Fee schedules","Call reports","Local economy","State benchmarks","National data","Regulatory sources"].map(text=><div key={text} className="rounded-lg border border-[#E0D7C9] bg-white p-3 text-sm"><Layers size={17} aria-hidden className="mb-3 text-[#A93D25]" />{text}</div>)}</div><p className="mt-4 text-sm text-[#6B6255]">Different names, reporting dates, and formats.</p></article>
      </div>
      <div className="mt-8 flex justify-center"><ArrowDown size={28} aria-hidden className="text-[#A93D25]" /></div>
    </div>
  </section>;
}
