/** Neutral skeleton for Hamilton screens while server data loads (light theme). */
export function HamiltonPageSkeleton() {
  return (
    <div className="px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className="h-8 w-64 max-w-full rounded bg-stone-200/70 animate-pulse" />
        <div className="h-4 w-96 max-w-full rounded bg-stone-200/50 animate-pulse" />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-stone-200/50 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
      <div className="mt-8 h-96 rounded-lg bg-stone-200/40 animate-pulse" />
    </div>
  );
}
