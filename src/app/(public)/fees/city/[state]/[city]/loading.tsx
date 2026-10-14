export default function Loading() {
  return (
    <div className="max-w-page mx-auto px-6 py-14 animate-pulse">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-3 w-10 rounded bg-[#E8DFD1]/60" />
        <div className="h-3 w-2 rounded bg-[#E8DFD1]/40" />
        <div className="h-3 w-16 rounded bg-[#E8DFD1]/60" />
        <div className="h-3 w-2 rounded bg-[#E8DFD1]/40" />
        <div className="h-3 w-20 rounded bg-[#E8DFD1]/60" />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="h-px w-8 bg-[#E8DFD1]" />
        <div className="h-3 w-32 rounded bg-[#E8DFD1]/60" />
      </div>

      <div className="h-10 w-80 rounded bg-[#E8DFD1]/50 mb-2" />
      <div className="h-4 w-48 rounded bg-[#E8DFD1]/40 mb-8" />

      {/* Spotlight cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-[#E8DFD1]/60 bg-white/50 px-4 py-3.5">
            <div className="h-3 w-20 rounded bg-[#E8DFD1]/50 mb-2" />
            <div className="h-7 w-16 rounded bg-[#E8DFD1]/40" />
            <div className="h-3 w-24 rounded bg-[#E8DFD1]/30 mt-1.5" />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#E8DFD1]/60 bg-white/50 overflow-hidden">
        <div className="h-10 bg-[#FAF7F2]/60 border-b border-[#E8DFD1]/40" />
        <div className="h-10 bg-[#FAF7F2]/30 border-b border-[#E8DFD1]/20" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-[#E8DFD1]/20 last:border-0">
            <div className="h-4 w-36 rounded bg-[#E8DFD1]/40" />
            <div className="h-4 w-10 rounded bg-[#E8DFD1]/30" />
            <div className="flex-1" />
            <div className="h-4 w-12 rounded bg-[#E8DFD1]/30" />
            <div className="h-4 w-12 rounded bg-[#E8DFD1]/30" />
            <div className="h-4 w-12 rounded bg-[#E8DFD1]/30" />
          </div>
        ))}
      </div>
    </div>
  );
}
