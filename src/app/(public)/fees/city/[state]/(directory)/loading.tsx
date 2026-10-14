export default function Loading() {
  return (
    <div className="max-w-page mx-auto px-6 py-14 animate-pulse">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-3 w-10 rounded bg-[#E8DFD1]/60" />
        <div className="h-3 w-2 rounded bg-[#E8DFD1]/40" />
        <div className="h-3 w-20 rounded bg-[#E8DFD1]/60" />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="h-px w-8 bg-[#E8DFD1]" />
        <div className="h-3 w-24 rounded bg-[#E8DFD1]/60" />
      </div>

      <div className="h-10 w-72 rounded bg-[#E8DFD1]/50 mb-2" />
      <div className="h-4 w-56 rounded bg-[#E8DFD1]/40 mb-8" />

      <div className="rounded-xl border border-[#E8DFD1]/60 bg-white/50 overflow-hidden">
        <div className="h-10 bg-[#FAF7F2]/60 border-b border-[#E8DFD1]/40" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-[#E8DFD1]/20 last:border-0">
            <div className="h-4 w-32 rounded bg-[#E8DFD1]/40" />
            <div className="flex gap-8">
              <div className="h-4 w-8 rounded bg-[#E8DFD1]/30" />
              <div className="h-4 w-8 rounded bg-[#E8DFD1]/30" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
