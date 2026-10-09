export default function Loading() {
  return (
    <div className="mx-auto max-w-page px-6 py-10 animate-pulse">
      <div className="h-3 w-28 rounded bg-slate-200" />
      <div className="mt-2 h-7 w-80 rounded bg-slate-200" />
      <div className="mt-3 h-4 w-[30rem] rounded bg-slate-200" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border border-slate-200 bg-slate-50" />
        ))}
      </div>
      <div className="mt-8 space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="h-5 w-40 rounded bg-slate-200" />
            <div className="mt-3 h-48 rounded-lg border border-slate-200 bg-slate-50" />
          </div>
        ))}
      </div>
    </div>
  );
}
