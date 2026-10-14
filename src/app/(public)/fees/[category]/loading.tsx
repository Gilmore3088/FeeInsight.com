export default function CategoryLoading() {
  return (
    <div className="mx-auto max-w-page px-6 py-12">
      <div className="animate-pulse space-y-6">
        <div className="h-3 w-32 rounded bg-slate-200" />
        <div className="flex items-center gap-3">
          <div className="h-5 w-20 rounded-full bg-slate-200" />
          <div className="h-5 w-16 rounded-full bg-slate-200" />
        </div>
        <div className="h-8 w-64 rounded bg-slate-200" />
        <div className="h-4 w-80 rounded bg-slate-200" />

        {/* Stat cards */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-4 space-y-2">
              <div className="h-2.5 w-20 rounded bg-slate-200" />
              <div className="h-5 w-24 rounded bg-slate-100" />
            </div>
          ))}
        </div>

        {/* Charter table */}
        <div className="mt-4 rounded-lg border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 flex gap-12">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-3 w-20 rounded bg-slate-200" />
            ))}
          </div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <div className="h-4 w-28 rounded bg-slate-100" />
                <div className="flex gap-8">
                  <div className="h-4 w-16 rounded bg-slate-100" />
                  <div className="h-4 w-24 rounded bg-slate-100" />
                  <div className="h-4 w-12 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* District table */}
        <div className="mt-4 rounded-lg border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 flex gap-12">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-3 w-20 rounded bg-slate-200" />
            ))}
          </div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <div className="h-4 w-40 rounded bg-slate-100" />
                <div className="flex gap-8">
                  <div className="h-4 w-16 rounded bg-slate-100" />
                  <div className="h-4 w-12 rounded-full bg-slate-100" />
                  <div className="h-4 w-10 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
