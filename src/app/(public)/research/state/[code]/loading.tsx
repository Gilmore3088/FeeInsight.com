export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="bg-[#1A1815]">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-16 sm:px-6">
          <div className="h-3 w-24 rounded bg-white/15" />
          <div className="mt-4 h-12 w-[36rem] max-w-full rounded bg-white/15" />
          <div className="mt-4 h-4 w-[30rem] max-w-full rounded bg-white/10" />
          <div className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-xl lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 bg-white/5" />
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="h-3 w-32 rounded bg-[#E8DFD1]" />
        <div className="mt-3 h-8 w-80 rounded bg-[#E8DFD1]" />
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-56 rounded-2xl bg-[#F1EBE1]" />
          ))}
        </div>
        <div className="mt-20 h-[28rem] rounded-2xl bg-[#F1EBE1]" />
      </div>
    </div>
  );
}
