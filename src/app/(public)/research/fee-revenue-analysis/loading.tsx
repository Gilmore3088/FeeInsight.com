export default function Loading() {
  return (
    <div className="mx-auto max-w-page px-6 py-10 animate-pulse">
      <div className="h-3 w-24 rounded bg-slate-200" />
      <div className="mt-2 h-7 w-64 rounded bg-slate-200" />
      <div className="mt-3 h-4 w-[28rem] rounded bg-slate-200" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border border-slate-200 bg-slate-50" />
        ))}
      </div>
      <div className="mt-8 h-5 w-48 rounded bg-slate-200" />
      <div className="mt-3 h-40 rounded-lg border border-slate-200 bg-slate-50" />
      <div className="mt-8 h-5 w-40 rounded bg-slate-200" />
      <div className="mt-3 h-64 rounded-lg border border-slate-200 bg-slate-50" />
    </div>
  );
}
