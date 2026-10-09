export default function PublicLoading() {
  return (
    <div className="mx-auto max-w-page px-6 py-14">
      <div className="animate-pulse space-y-6">
        <div className="flex items-center gap-2">
          <div className="h-px w-8 bg-[#E8DFD1]" />
          <div className="h-3 w-24 rounded bg-[#E8DFD1]/60" />
        </div>
        <div className="h-9 w-72 rounded bg-[#E8DFD1]/50" />
        <div className="h-4 w-96 max-w-full rounded bg-[#E8DFD1]/40" />
        <div className="mt-8 rounded-xl border border-[#E8DFD1]/60 bg-white/50 p-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex justify-between">
              <div className="h-4 w-40 rounded bg-[#E8DFD1]/30" />
              <div className="h-4 w-20 rounded bg-[#E8DFD1]/30" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
