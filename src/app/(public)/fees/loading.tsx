export default function FeesLoading() {
  return (
    <div className="mx-auto max-w-page px-6 py-12">
      <div className="animate-pulse space-y-6">
        <div className="h-7 w-48 rounded bg-slate-200" />
        <div className="h-4 w-80 max-w-full rounded bg-slate-200" />
        <div className="mt-8 rounded-lg border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-6 py-3 flex gap-12">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-3 w-20 rounded bg-slate-200" />
            ))}
          </div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-6 py-3.5">
                <div className="h-4 w-36 rounded bg-slate-100" />
                <div className="flex gap-8">
                  <div className="h-4 w-16 rounded bg-slate-100" />
                  <div className="hidden sm:block h-4 w-24 rounded bg-slate-100" />
                  <div className="hidden sm:block h-4 w-12 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
