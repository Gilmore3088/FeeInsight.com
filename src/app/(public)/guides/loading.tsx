export default function Loading() {
  return (
    <div className="mx-auto max-w-page px-6 py-16 animate-pulse">
      {/* Hero */}
      <div className="max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-px w-8 bg-[#E8DFD1]" />
          <div className="h-3 w-28 rounded bg-[#E8DFD1]/60" />
        </div>
        <div className="h-10 w-[24rem] max-w-full rounded bg-[#E8DFD1]/50" />
        <div className="mt-4 h-4 w-[32rem] max-w-full rounded bg-[#E8DFD1]/40" />
        <div className="mt-4 h-3 w-48 rounded bg-[#E8DFD1]/30" />
      </div>

      {/* Primary cards */}
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-[#E8DFD1]/60 bg-white/50 px-6 py-6">
            <div className="h-5 w-24 rounded-full bg-[#E8DFD1]/40" />
            <div className="mt-3 h-5 w-40 rounded bg-[#E8DFD1]/50" />
            <div className="mt-2 h-4 w-full rounded bg-[#E8DFD1]/30" />
            <div className="mt-4 rounded-lg bg-[#FAF7F2]/50 border border-[#E8DFD1]/30 p-3.5">
              <div className="h-8 w-20 rounded bg-[#E8DFD1]/40" />
              <div className="mt-2 space-y-1.5">
                <div className="h-3 w-full rounded bg-[#E8DFD1]/25" />
                <div className="h-3 w-full rounded bg-[#E8DFD1]/25" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Secondary section */}
      <div className="mt-14">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-4 w-28 rounded bg-[#E8DFD1]/50" />
          <div className="h-px flex-1 bg-[#E8DFD1]/40" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[#E8DFD1]/60 bg-white/50 px-5 py-4">
              <div className="h-4 w-28 rounded-full bg-[#E8DFD1]/40" />
              <div className="mt-2 h-4 w-36 rounded bg-[#E8DFD1]/45" />
              <div className="mt-2 h-6 w-16 rounded bg-[#E8DFD1]/35" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
