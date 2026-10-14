export default function Loading() {
  return (
    <div className="mx-auto max-w-page px-6 py-14 animate-pulse">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-8">
        <div className="h-3 w-10 rounded bg-[#E8DFD1]/60" />
        <div className="h-3 w-2 rounded bg-[#E8DFD1]/40" />
        <div className="h-3 w-14 rounded bg-[#E8DFD1]/60" />
        <div className="h-3 w-2 rounded bg-[#E8DFD1]/40" />
        <div className="h-3 w-28 rounded bg-[#E8DFD1]/60" />
      </div>

      {/* Hero */}
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-px w-8 bg-[#E8DFD1]" />
          <div className="h-3 w-28 rounded bg-[#E8DFD1]/60" />
        </div>
        <div className="h-10 w-[28rem] max-w-full rounded bg-[#E8DFD1]/50" />
        <div className="mt-4 h-4 w-[36rem] max-w-full rounded bg-[#E8DFD1]/40" />
        <div className="mt-2 h-4 w-[28rem] max-w-full rounded bg-[#E8DFD1]/30" />
        <div className="mt-4 h-3 w-60 rounded bg-[#E8DFD1]/30" />
      </div>

      {/* Data cards */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-[#E8DFD1]/60 bg-white/50 px-5 py-4">
            <div className="h-3 w-20 rounded bg-[#E8DFD1]/50" />
            <div className="mt-3 h-8 w-20 rounded bg-[#E8DFD1]/40" />
            <div className="mt-2 h-3 w-32 rounded bg-[#E8DFD1]/30" />
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="mt-5 flex gap-3">
        <div className="h-8 w-32 rounded-full bg-[#E8DFD1]/40" />
        <div className="h-8 w-40 rounded-full bg-[#C44B2E]/15" />
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 xl:grid-cols-[1fr_300px]">
        <div>
          {/* Chart placeholder */}
          <div className="mb-12">
            <div className="h-5 w-52 rounded bg-[#E8DFD1]/50" />
            <div className="mt-4 h-[240px] rounded-xl border border-[#E8DFD1]/60 bg-white/50" />
          </div>
          {/* Guide sections */}
          <div className="space-y-10">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <div className="h-6 w-56 rounded bg-[#E8DFD1]/50" />
                <div className="mt-3 h-20 rounded bg-[#E8DFD1]/25" />
                {i < 2 && <div className="mt-10 h-px bg-[#E8DFD1]/40" />}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div className="h-56 rounded-xl border border-[#E8DFD1] bg-white/50" />
          <div className="h-36 rounded-xl border border-emerald-200/40 bg-emerald-50/10" />
          <div className="h-36 rounded-xl border border-red-200/40 bg-red-50/10" />
          <div className="h-28 rounded-xl border border-[#E8DFD1] bg-white/50" />
        </div>
      </div>
    </div>
  );
}
